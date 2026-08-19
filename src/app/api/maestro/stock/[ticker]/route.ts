/**
 * Maestro Single Stock Analysis API
 * واجهة تحليل سهم واحد بالمايسترو
 *
 * GET: Get Maestro analysis for specific stock
 * Run analysis and return detailed result
 *
 * Behaviour:
 *   1. Try Python `${PY}/api/maestro/stock/<ticker>` first (currently 404 — kept for future use).
 *   2. Try the existing Next.js analysis (Prisma → data_engine.db → runMaestroAnalysis).
 *   3. If the stock isn't found or has insufficient history, fall back to a maestro-style
 *      analysis composed from `/api/confluence/analyze/<ticker>` (which works in Python).
 *
 * Response: { success: true, data: {...}, analysis: {...}, message }
 *   - `data`     — original rich payload (kept for backward compatibility)
 *   - `analysis` — flatter maestro-style block matching the Flutter app's expected shape
 *                  `{ ticker, score, signals: [...], recommendation, ... }`
 *
 * @version 1.1.0
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  runMaestroAnalysis,
  type MaestroResult,
  type MaestroOptions
} from '@/lib/v2/maestro-orchestrator';
import { getTickerNewsSentiment } from '@/lib/v2/news-sentiment-engine';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

// ==================== TYPES ====================

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface StockAnalysisData {
  stock: {
    id: number;
    ticker: string;
    name: string | null;
    name_ar: string | null;
    current_price: number | null;
    previous_close: number | null;
    volume: number | null;
    sector: string | null;
  };
  maestroAnalysis: MaestroResult;
  newsSentiment: {
    ticker: string;
    recentNewsCount: number;
    avgSentimentScore: number;
    avgImpactScore: number;
    dominantSentiment: string;
    riskLevel: string;
    signals: string[];
  };
  recentSignals: Array<{
    id: number;
    signal_date: string;
    direction: string;
    maestro_score: number;
    outcome: string | null;
    profit_percent: number | null;
  }>;
  priceHistory: {
    dates: string[];
    closes: number[];
    volumes: number[];
  };
}

// ==================== GET HANDLER ====================

/**
 * GET /api/maestro/stock/[ticker]
 * Get Maestro analysis for specific stock
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const tickerUpper = ticker.toUpperCase();

    const { searchParams } = new URL(request.url);
    const personaType = searchParams.get('persona') || 'balanced';
    const forceRegime = searchParams.get('regime') as 'bull' | 'bear' | 'range' | null;
    const daysHistory = parseInt(searchParams.get('days') || '200');
    const market = searchParams.get('market') || 'EGX';

    // ----------------------------------------------------------------------
    // Path 0: Python /api/maestro/stock/<ticker> (currently 404 — kept for future use)
    // ----------------------------------------------------------------------
    try {
      const controller0 = new AbortController();
      const timeout0 = setTimeout(() => controller0.abort(), 8000);
      const pyRes = await fetch(
        `${PY}/api/maestro/stock/${encodeURIComponent(tickerUpper)}?market=${encodeURIComponent(market)}&persona=${encodeURIComponent(personaType)}`,
        { method: 'GET', headers: { Accept: 'application/json' }, signal: controller0.signal, cache: 'no-store' }
      );
      clearTimeout(timeout0);
      if (pyRes.ok) {
        const pyData = await pyRes.json();
        if (pyData && pyData.success !== false && (pyData.analysis || pyData.data || pyData.score != null)) {
          return NextResponse.json({
            success: true,
            data: pyData.data || pyData,
            analysis: pyData.analysis || pyData,
            ticker: tickerUpper,
            market,
            persona: personaType,
            source: 'python',
            message: `تم تحليل السهم ${tickerUpper} بنجاح (Python)`,
          });
        }
      }
    } catch (pyErr) {
      console.warn('[MaestroStockAPI] Python proxy failed, falling back to Next.js impl:', pyErr);
    }

    // Get stock data - try Prisma first, then fallback to data_engine.db
    let stock = null;
    try {
      stock = await db.stocks.findFirst({
        where: {
          ticker: tickerUpper
        }
      });
    } catch (prismaErr) {
      console.warn('[MaestroStockAPI] Prisma error, falling back to data_engine.db:', prismaErr);
    }

    // Fallback: data_engine.db لو Prisma فشل
    if (!stock) {
      try {
        const { getDataEngineDb } = await import('@/lib/data-engine-db');
        const deDb = getDataEngineDb();
        const row = deDb.prepare(`
          SELECT symbol as ticker, name, price as current_price,
                 change_percent, volume, market_cap, market
          FROM stocks
          WHERE symbol = ? COLLATE NOCASE AND price > 0
          LIMIT 1
        `).get(tickerUpper) as any;

        if (row) {
          stock = {
            id: 0,
            ticker: row.ticker,
            name: row.name || row.ticker,
            name_ar: row.name || row.ticker,
            current_price: Number(row.current_price || 0),
            previous_close: Number(row.current_price || 0) / (1 + (Number(row.change_percent || 0)) / 100),
            volume: parseFloat(String(row.volume || '0')) || 0,
            sector: null,
          };
        }
      } catch (deErr) {
        console.warn('[MaestroStockAPI] data_engine fallback error:', deErr);
      }
    }

    if (!stock) {
      // Fallback: compose a maestro-style analysis from /api/confluence/analyze/<ticker>
      const fallback = await composeConfluenceMaestro(tickerUpper, market, personaType);
      if (fallback) {
        return NextResponse.json({
          success: true,
          data: fallback,
          analysis: fallback,
          ticker: tickerUpper,
          market,
          persona: personaType,
          source: 'confluence-fallback',
          message: `تم تحليل السهم ${tickerUpper} عبر مجلس المستشارين (confluence) لأنه غير مخزّن في قاعدة البيانات`,
          message_en: `Stock ${tickerUpper} analyzed via confluence fallback (not present in DB).`,
        });
      }
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: `السهم ${tickerUpper} غير موجود`,
          message: `Stock ${tickerUpper} not found`
        },
        { status: 404 }
      );
    }
    
    // Get price history
    let priceHistory: Array<{
      close_price: number;
      volume: number;
      trade_date: string;
      high_price: number;
      low_price: number;
      open_price: number;
    }> = [];

    try {
      const { getDataEngineDb } = await import('@/lib/data-engine-db');
      const deDb = getDataEngineDb();
      const rows = deDb.prepare(`
        SELECT close_price, volume, trade_date, high_price, low_price, open_price
        FROM stock_prices
        WHERE stock_id = ? OR stock_id = (SELECT id FROM stocks WHERE symbol = ? COLLATE NOCASE)
        ORDER BY trade_date DESC
        LIMIT ?
      `).all(stock.id, tickerUpper, daysHistory) as any[];

      priceHistory = rows.map(r => ({
        close_price: Number(r.close_price),
        volume: Number(r.volume),
        trade_date: r.trade_date,
        high_price: Number(r.high_price),
        low_price: Number(r.low_price),
        open_price: Number(r.open_price)
      }));
    } catch (rawErr) {
      console.warn('[MaestroStockAPI] Price history fetch error:', rawErr);
    }

    // Fallback using getHistoricalData
    if (priceHistory.length < 20) {
      try {
        const { getHistoricalData } = await import('@/lib/data-engine-db');
        const historyData = getHistoricalData(tickerUpper, daysHistory);
        if (historyData && historyData.length >= 20) {
          priceHistory = historyData.map(p => ({
            close_price: p.close_price || 0,
            volume: p.volume || 0,
            trade_date: p.date,
            high_price: p.high_price || p.close_price || 0,
            low_price: p.low_price || p.close_price || 0,
            open_price: p.open_price || p.close_price || 0,
          }));
        }
      } catch (histErr) {
        console.warn('[MaestroStockAPI] getHistoricalData fallback error:', histErr);
      }
    }

    if (priceHistory.length < 20) {
      // Fallback: compose a maestro-style analysis from /api/confluence/analyze/<ticker>
      const fallback = await composeConfluenceMaestro(tickerUpper, market, personaType);
      if (fallback) {
        return NextResponse.json({
          success: true,
          data: fallback,
          analysis: fallback,
          ticker: tickerUpper,
          market,
          persona: personaType,
          source: 'confluence-fallback',
          message: `بيانات تاريخية غير كافية — تم استخدام تحليل مجلس المستشارين (confluence) كبديل`,
          message_en: 'Insufficient history — used confluence fallback for maestro-style analysis.',
        });
      }
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: 'بيانات تاريخية غير كافية للتحليل',
          message: 'Insufficient historical data for analysis (minimum 20 days required)'
        },
        { status: 400 }
      );
    }
    
    // Prepare analysis options
    const options: MaestroOptions = {
      personaType,
      forceRegime: forceRegime || undefined
    };
    
    // Run Maestro analysis
    const maestroAnalysis = await runMaestroAnalysis(
      tickerUpper,
      stock,
      priceHistory.map(p => ({
        close: p.close_price,
        close_price: p.close_price,
        volume: p.volume,
        date: p.trade_date,
        high: p.high_price,
        low: p.low_price,
        open: p.open_price
      })),
      options
    );
    
    // Get news sentiment
    const newsSentiment = await getTickerNewsSentiment(tickerUpper, 14);
    
    // Get recent signals for this stock
    let recentSignals: any[] = [];
    try {
      recentSignals = await (db as any).signal_logs.findMany({
        where: {
          ticker: tickerUpper
        },
        orderBy: { created_at: 'desc' },
        take: 10
      });
    } catch (err) {
      console.warn('[MaestroStockAPI] Failed to fetch signal_logs from Prisma:', err);
      
      // Fallback query using price_history.db
      try {
        const { getPriceHistoryDb } = await import('@/lib/data-engine-db');
        const phDb = getPriceHistoryDb();
        const tableCheck = phDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='signal_logs'").get();
        if (tableCheck) {
          recentSignals = phDb.prepare(`
            SELECT id, signal_date, direction, maestro_score, outcome, profit_percent
            FROM signal_logs
            WHERE ticker = ?
            ORDER BY created_at DESC
            LIMIT 10
          `).all(tickerUpper) as any[];
        }
      } catch (sqLiteErr) {
        console.warn('[MaestroStockAPI] SQLite signal_logs fallback error:', sqLiteErr);
      }
    }
    
    // Prepare price history for response
    const priceHistoryResponse = {
      dates: priceHistory.map(p => p.trade_date).reverse(),
      closes: priceHistory.map(p => p.close_price).reverse(),
      volumes: priceHistory.map(p => p.volume).reverse()
    };
    
    const response: StockAnalysisData = {
      stock: {
        id: stock.id,
        ticker: stock.ticker,
        name: stock.name,
        name_ar: stock.name_ar,
        current_price: stock.current_price,
        previous_close: stock.previous_close,
        volume: stock.volume,
        sector: stock.sector
      },
      maestroAnalysis,
      newsSentiment,
      recentSignals: recentSignals.map(s => ({
        id: s.id,
        signal_date: s.signal_date,
        direction: s.direction,
        maestro_score: s.maestro_score,
        outcome: s.outcome,
        profit_percent: s.profit_percent
      })),
      priceHistory: priceHistoryResponse
    };
    
    // Flatten the rich response into a maestro-style `analysis` block too,
    // so the Flutter app's getMaestroAnalysis() can read either shape.
    const analysis = {
      ticker: tickerUpper,
      market,
      persona: personaType,
      score: (maestroAnalysis as any)?.score ?? (maestroAnalysis as any)?.total_score ?? null,
      recommendation: (maestroAnalysis as any)?.recommendation
        ?? (maestroAnalysis as any)?.signal ?? null,
      signals: recentSignals.map(s => ({
        date: s.signal_date,
        direction: s.direction,
        score: s.maestro_score,
        outcome: s.outcome,
        profit_percent: s.profit_percent,
      })),
      news_sentiment: newsSentiment,
      regime: (maestroAnalysis as any)?.regime ?? null,
      price: stock.current_price,
      entry: (maestroAnalysis as any)?.entry ?? null,
      target: (maestroAnalysis as any)?.target ?? null,
      stop: (maestroAnalysis as any)?.stop ?? null,
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json<ApiResponse<StockAnalysisData>>({
      success: true,
      data: response,
      analysis,
      ticker: tickerUpper,
      market,
      persona: personaType,
      source: 'maestro-orchestrator',
      message: `تم تحليل السهم ${tickerUpper} بنجاح`
    });

  } catch (error) {
    console.error('[MaestroStockAPI] GET error:', error);
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'خطأ في تحليل السهم'
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Confluence-based fallback composer
// ---------------------------------------------------------------------------

/**
 * Compose a maestro-style analysis from Python's `/api/confluence/analyze/<ticker>`
 * endpoint (which works in this environment). Returns null if confluence fails.
 */
async function composeConfluenceMaestro(
  ticker: string,
  market: string,
  persona: string
): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(
      `${PY}/api/confluence/analyze/${encodeURIComponent(ticker)}`,
      { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();

    const board = data?.board_consensus || data?.consensus || data;
    if (!board) return null;

    const opinions = board.opinions || {};
    const signals = Object.entries(opinions).map(([engine, op]: [string, any]) => ({
      engine,
      name: op?.name || engine,
      name_en: engine,
      signal: op?.signal || null,
      signal_ar: op?.signal_ar || op?.signal || null,
      confidence: typeof op?.confidence === 'number' ? op.confidence : 0,
      reason: op?.reason_ar || op?.reason || null,
    }));

    const score = typeof board.master_score === 'number' ? board.master_score : 50;
    const rec =
      score >= 80 ? { recommendation: 'STRONG_BUY', recommendation_ar: 'شراء قوي' } :
      score >= 70 ? { recommendation: 'BUY',         recommendation_ar: 'شراء'      } :
      score >= 60 ? { recommendation: 'HOLD',        recommendation_ar: 'انتظار'    } :
      score >= 50 ? { recommendation: 'REDUCE',      recommendation_ar: 'تقليل'     } :
                   { recommendation: 'AVOID',       recommendation_ar: 'تجنب'      };

    return {
      ticker,
      market: board.market || market,
      persona,
      price: board.entry_price ?? null,
      score,
      confidence: Math.round(score),
      recommendation: rec.recommendation,
      recommendation_ar: rec.recommendation_ar,
      signals,
      opinions,
      entry:  board.entry_price ?? null,
      target: null,
      stop:   null,
      regime: data?.market_regime?.regime || null,
      generated_at: new Date().toISOString(),
      source: 'confluence',
    };
  } catch (err) {
    console.warn('[MaestroStockAPI] confluence fallback failed:', err);
    return null;
  }
}
