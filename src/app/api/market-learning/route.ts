import { NextRequest, NextResponse } from 'next/server';
import {
  fetchStockDataFromMubasher,
  parseStockPriceData,
  parseHistoricalFromHtml,
  getWritableDatabase,
  upsertPriceHistory,
  getTodayCairo,
  sleep,
  type StockCurrentData,
  type ParsedStockPrice,
} from '@/lib/data-sync';
import {
  isVpsAvailable,
  fetchStockHistory,
  fetchStockQuote,
  type VpsHistoryPoint,
  type VpsStockQuote,
} from '@/lib/vps-adapter';
import {
  initializeMarketLearningTables,
  generateHistoricalSignals,
  saveSignals,
  updateIndicatorPerformance,
  getIndicatorPerformance,
  getRecommendedWeights,
  type IndicatorType,
  type MarketPhase,
} from '@/lib/v2/market-learning-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LearningProgress {
  status: 'idle' | 'updating_data' | 'learning' | 'completed' | 'error';
  message: string;
  started_at: string | null;
  completed_at: string | null;
  total_stocks: number;
  processed_stocks: number;
  signals_generated: number;
  indicator_performance_updated: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let learningProgress: LearningProgress = {
  status: 'idle',
  message: 'لم يبدأ التعلم بعد',
  started_at: null,
  completed_at: null,
  total_stocks: 0,
  processed_stocks: 0,
  signals_generated: 0,
  indicator_performance_updated: false,
  errors: [],
};

let isLearningRunning = false;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

async function fetchFromVps(ticker: string): Promise<{
  history: VpsHistoryPoint[];
  quote: VpsStockQuote | null;
} | null> {
  try {
    const [historyResult, quoteResult] = await Promise.all([
      fetchStockHistory(ticker, 365),
      fetchStockQuote(ticker),
    ]);

    const history = historyResult?.data || [];
    const quote = quoteResult?.data || null;

    if (history.length === 0 && !quote) return null;
    return { history, quote };
  } catch {
    return null;
  }
}

function vpsHistoryToParsedStockPrice(ticker: string, points: VpsHistoryPoint[]): ParsedStockPrice[] {
  return points
    .filter((p) => p.date && p.close > 0)
    .map((p) => ({
      ticker: ticker.toUpperCase(),
      date: p.date,
      open_price: p.open || p.close,
      high_price: p.high || p.close,
      low_price: p.low || p.close,
      close_price: p.close,
      volume: p.volume || 0,
      adjusted_close: p.adjusted_close || p.close,
    }));
}

async function fetchFromMubasher(ticker: string): Promise<{
  currentData: StockCurrentData | null;
  historicalPrices: ParsedStockPrice[];
} | null> {
  try {
    const pageData = await fetchStockDataFromMubasher(ticker);
    if (!pageData) return null;

    const currentData = parseStockPriceData(pageData.html, ticker);
    const historicalPrices = parseHistoricalFromHtml(pageData.html, ticker);

    if (!currentData && historicalPrices.length === 0) return null;
    return { currentData, historicalPrices };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET - Get learning status and indicator performance
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'performance') {
    // Get indicator performance
    try {
      const indicator = searchParams.get('indicator') as IndicatorType | null;
      const phase = searchParams.get('phase') as MarketPhase | null;
      const performance = getIndicatorPerformance(indicator || undefined, phase || undefined);

      return NextResponse.json({
        success: true,
        performance,
        recommended_weights: {
          BULL: getRecommendedWeights('BULL'),
          BEAR: getRecommendedWeights('BEAR'),
          RANGE: getRecommendedWeights('RANGE'),
        },
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: String(error),
      }, { status: 500 });
    }
  }

  if (action === 'weights') {
    try {
      return NextResponse.json({
        success: true,
        weights: {
          BULL: getRecommendedWeights('BULL'),
          BEAR: getRecommendedWeights('BEAR'),
          RANGE: getRecommendedWeights('RANGE'),
        },
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: String(error),
      }, { status: 500 });
    }
  }

  // Default: return current progress
  return NextResponse.json({
    success: true,
    progress: learningProgress,
    is_running: isLearningRunning,
  });
}

// ---------------------------------------------------------------------------
// POST - Start learning process
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (isLearningRunning) {
    return NextResponse.json({
      success: false,
      message: 'يوجد عملية تعلم جارية. يرجى الانتظار.',
      progress: learningProgress,
    }, { status: 429 });
  }

  let body: { update_data?: boolean; tickers?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  isLearningRunning = true;
  learningProgress = {
    status: 'updating_data',
    message: 'جارٍ تحديث بيانات الأسهم...',
    started_at: new Date().toISOString(),
    completed_at: null,
    total_stocks: 0,
    processed_stocks: 0,
    signals_generated: 0,
    indicator_performance_updated: false,
    errors: [],
  };

  // Run learning in background
  (async () => {
    try {
      // Initialize tables
      console.log('[MarketLearning] Initializing tables...');
      initializeMarketLearningTables();

      const db = getWritableDatabase();
      let stocks: Array<{ ticker: string; id: number }>;

      try {
        if (body.tickers && body.tickers.length > 0) {
          const placeholders = body.tickers.map(() => '?').join(',');
          stocks = db.prepare(
            `SELECT ticker, id FROM stocks WHERE ticker IN (${placeholders}) AND is_active = 1`
          ).all(...body.tickers) as Array<{ ticker: string; id: number }>;
        } else {
          stocks = db.prepare(
            'SELECT ticker, id FROM stocks WHERE is_active = 1 ORDER BY ticker'
          ).all() as Array<{ ticker: string; id: number }>;
        }
      } finally {
        db.close();
      }

      learningProgress.total_stocks = stocks.length;
      console.log(`[MarketLearning] Processing ${stocks.length} stocks...`);

      // Check VPS availability
      let vpsOnline = false;
      try {
        vpsOnline = await isVpsAvailable();
      } catch {
        vpsOnline = false;
      }
      console.log(`[MarketLearning] VPS: ${vpsOnline ? 'ONLINE' : 'OFFLINE'}`);

      const stockHistories = new Map<string, Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>();

      // Update data for each stock
      for (let i = 0; i < stocks.length; i++) {
        const { ticker, id: stockId } = stocks[i];

        try {
          let historicalPrices: ParsedStockPrice[] = [];

          // Strategy 1: VPS
          if (vpsOnline) {
            const vpsData = await fetchFromVps(ticker);
            if (vpsData && vpsData.history.length > 0) {
              historicalPrices = vpsHistoryToParsedStockPrice(ticker, vpsData.history);
            }
          }

          // Strategy 2: Mubasher
          if (historicalPrices.length === 0) {
            const mubasherData = await fetchFromMubasher(ticker);
            if (mubasherData && mubasherData.historicalPrices.length > 0) {
              historicalPrices = mubasherData.historicalPrices;
            }
          }

          // Strategy 3: Database
          if (historicalPrices.length === 0) {
            const readDb = getWritableDatabase();
            try {
              const rows = readDb.prepare(
                'SELECT date, open_price, high_price, low_price, close_price, volume FROM stock_price_history WHERE stock_id = ? ORDER BY date DESC LIMIT 365'
              ).all(stockId) as Array<{ date: string; open_price: number; high_price: number; low_price: number; close_price: number; volume: number }>;

              historicalPrices = rows.reverse().map(row => ({
                ticker,
                date: row.date,
                open_price: row.open_price || 0,
                high_price: row.high_price || 0,
                low_price: row.low_price || 0,
                close_price: row.close_price || 0,
                volume: row.volume || 0,
                adjusted_close: row.close_price || 0,
              }));
            } finally {
              readDb.close();
            }
          }

          // Save to map for learning
          if (historicalPrices.length > 50) {
            stockHistories.set(ticker, historicalPrices.map(p => ({
              date: p.date,
              open: p.open_price,
              high: p.high_price,
              low: p.low_price,
              close: p.close_price,
              volume: p.volume,
            })));
          }

          // Update database if requested
          if (body.update_data !== false && historicalPrices.length > 0) {
            const writeDb = getWritableDatabase();
            try {
              const today = getTodayCairo();
              for (const price of historicalPrices) {
                upsertPriceHistory(writeDb, stockId, price.date, {
                  open_price: price.open_price,
                  high_price: price.high_price,
                  low_price: price.low_price,
                  close_price: price.close_price,
                  volume: price.volume,
                });
              }
            } finally {
              writeDb.close();
            }
          }

          learningProgress.processed_stocks = i + 1;
          learningProgress.message = `جارٍ معالجة ${ticker}... (${i + 1}/${stocks.length})`;

          // Rate limit
          if (i < stocks.length - 1) {
            await sleep(500);
          }
        } catch (err) {
          learningProgress.errors.push(`${ticker}: ${String(err)}`);
        }
      }

      // Phase 2: Learning
      learningProgress.status = 'learning';
      learningProgress.message = 'جارٍ توليد الإشارات وتحليل الأنماط...';

      let totalSignals = 0;
      for (const [ticker, data] of stockHistories) {
        try {
          const signals = generateHistoricalSignals(ticker, data);
          if (signals.length > 0) {
            const saved = saveSignals(signals);
            totalSignals += saved;
          }
        } catch (err) {
          learningProgress.errors.push(`Learning ${ticker}: ${String(err)}`);
        }
      }

      learningProgress.signals_generated = totalSignals;
      learningProgress.message = `تم توليد ${totalSignals} إشارة. جارٍ تحديث أداء المؤشرات...`;

      // Update indicator performance
      updateIndicatorPerformance();
      learningProgress.indicator_performance_updated = true;

      learningProgress.status = 'completed';
      learningProgress.message = `اكتمل التعلم! تم توليد ${totalSignals} إشارة من ${stockHistories.size} سهم.`;
      learningProgress.completed_at = new Date().toISOString();

      console.log(`[MarketLearning] Completed: ${totalSignals} signals from ${stockHistories.size} stocks`);
    } catch (error) {
      learningProgress.status = 'error';
      learningProgress.message = `خطأ: ${String(error)}`;
      learningProgress.completed_at = new Date().toISOString();
      learningProgress.errors.push(String(error));
      console.error('[MarketLearning] Error:', error);
    } finally {
      isLearningRunning = false;
    }
  })();

  return NextResponse.json({
    success: true,
    message: 'بدأت عملية التعلم من البيانات التاريخية...',
    progress: learningProgress,
  });
}
