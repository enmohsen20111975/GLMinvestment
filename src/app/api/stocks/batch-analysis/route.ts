import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStocks, getPriceHistory, isHeavyDbAvailable, getHeavyDb, clearCache } from '@/lib/egx-db';
import { analyzeStockDataCoverage, type StockDataCoverageReport } from '@/lib/analysis-engine';
import { checkAndAutoSeed } from '@/lib/seed-historical-data';

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// In-memory cache — avoids repeated heavy DB loads within the TTL window
// ---------------------------------------------------------------------------

interface BatchCacheEntry {
  report: StockDataCoverageReport;
  timestamp: number;
}

let _batchCache: BatchCacheEntry | null = null;
const BATCH_CACHE_TTL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Recommendation string → { action, action_ar, confidence } mapper
// ---------------------------------------------------------------------------

const ACTION_AR_MAP: Record<string, string> = {
  strong_buy: 'شراء قوي',
  buy: 'شراء',
  accumulate: 'تجميع',
  hold: 'احتفاظ',
  sell: 'بيع',
  strong_sell: 'بيع قوي',
};

function mapRecommendation(action: string) {
  const a = (action || '').toLowerCase();
  return {
    action: a,
    action_ar: ACTION_AR_MAP[a] || a,
    confidence: 0.5, // default confidence for batch overview
  };
}

// ---------------------------------------------------------------------------
// Transform backend StockDataCoverageReport → frontend-expected shape
// ---------------------------------------------------------------------------

function transformForFrontend(report: StockDataCoverageReport) {
  // Map with_data → analyzed
  const analyzed = (report.with_data || []).map((s) => ({
    ticker: s.ticker,
    name_ar: s.name_ar || s.name || '',
    sector: s.sector || '',
    current_price: s.current_price || 0,
    composite_score: s.composite_score || 0,
    recommendation: mapRecommendation(s.recommendation),
    data_quality: s.data_quality || 'low',
    technical_score: s.all_scores?.technical,
    fundamental_score: Math.round(((s.all_scores?.value || 0) + (s.all_scores?.quality || 0)) / 2),
    risk_score: s.all_scores?.risk,
  }));

  // Map without_data
  const withoutData = (report.without_data || []).map((s) => ({
    ticker: s.ticker,
    name_ar: s.name_ar || s.name || '',
    sector: s.sector || '',
    reason: s.reason || '',
  }));

  // Build summary matching frontend expectations
  const buySignals = analyzed.filter((s) => {
    const a = s.recommendation.action;
    return a === 'strong_buy' || a === 'buy';
  }).length;
  const sellSignals = analyzed.filter((s) => {
    const a = s.recommendation.action;
    return a === 'strong_sell' || a === 'sell';
  }).length;
  const holdSignals = analyzed.filter((s) => {
    const a = s.recommendation.action;
    return a === 'hold' || a === 'accumulate';
  }).length;
  const avgScore = analyzed.length > 0
    ? analyzed.reduce((sum, s) => sum + (s.composite_score || 0), 0) / analyzed.length
    : 0;

  const summary = {
    total_stocks: report.total_stocks || 0,
    analyzed_count: analyzed.length,
    without_data_count: withoutData.length,
    average_score: Math.round(avgScore * 100) / 100,
    buy_signals: buySignals,
    sell_signals: sellSignals,
    hold_signals: holdSignals,
  };

  return {
    analyzed,
    without_data: withoutData,
    summary,
    generated_at: new Date().toISOString(),
  };
}

export async function GET(_request: NextRequest) {
  try {
    await ensureInitialized();

    // 0. فحص تلقائي للبيانات التاريخية وبذرها إذا لزم الأمر
    try {
      const seedResult = await checkAndAutoSeed();
      if (seedResult.seeded) {
        console.log(`[batch-analysis] Auto-seed completed: ${seedResult.rows} rows inserted, clearing cache`);
        // إزالة الكاش بعد البذر لأن البيانات تغيرت
        _batchCache = null;
        clearCache();
      }
    } catch (seedErr) {
      console.warn('[batch-analysis] Auto-seed check failed (non-blocking):', seedErr);
    }

    // 1. Return cached result if still fresh
    if (_batchCache && Date.now() - _batchCache.timestamp < BATCH_CACHE_TTL_MS) {
      const transformed = transformForFrontend(_batchCache.report);
      return NextResponse.json({
        success: true,
        report: _batchCache.report,
        analyzed: transformed.analyzed,
        without_data: transformed.without_data,
        summary: transformed.summary,
        generated_at: new Date(_batchCache.timestamp).toISOString(),
        cached: true,
      });
    }

    // 2. Eagerly try to load the heavy DB before checking availability
    let heavyDbAvailable = isHeavyDbAvailable();
    if (!heavyDbAvailable) {
      try {
        getHeavyDb();
        heavyDbAvailable = isHeavyDbAvailable();
        console.log('[batch-analysis] Heavy DB eagerly loaded:', heavyDbAvailable);
      } catch (err) {
        console.warn('[batch-analysis] Could not load heavy DB:', err);
      }
    }

    // 3. Fetch all active stocks
    const allStocksResult = getStocks({ page_size: 500, is_active: true });
    const allStocks = allStocksResult.stocks;

    if (!allStocks || allStocks.length === 0) {
      return NextResponse.json(
        { error: 'No stocks found', detail: 'لم يتم العثور على أي أسهم في قاعدة البيانات' },
        { status: 404 }
      );
    }

    // 4. Build the price history getter — handles heavy DB gracefully
    const getPriceHistoryFn = (stockId: number, days: number) => {
      if (!heavyDbAvailable) return [];
      try {
        return getPriceHistory(stockId, days);
      } catch {
        return [];
      }
    };

    // 5. Run the batch analysis via analysis-engine
    const report = analyzeStockDataCoverage(allStocks, getPriceHistoryFn);

    // 6. Cache the result
    _batchCache = { report, timestamp: Date.now() };

    // 7. Transform for frontend consumption
    const transformed = transformForFrontend(report);

    // 8. Return response with BOTH formats for compatibility
    const responsePayload: {
      success: boolean;
      report: StockDataCoverageReport;
      analyzed: typeof transformed.analyzed;
      without_data: typeof transformed.without_data;
      summary: typeof transformed.summary;
      generated_at: string;
      cached?: boolean;
      heavy_db_unavailable?: boolean;
      message?: string;
    } = {
      success: true,
      report,
      analyzed: transformed.analyzed,
      without_data: transformed.without_data,
      summary: transformed.summary,
      generated_at: new Date().toISOString(),
    };

    if (!heavyDbAvailable) {
      responsePayload.heavy_db_unavailable = true;
      responsePayload.message = 'التحليل يعتمد على البيانات الأساسية فقط (PE, PB, ROE, EPS). قاعدة بيانات الأسعار التاريخية غير متاحة.';
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[GET /api/stocks/batch-analysis] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate batch analysis',
        detail: 'فشل في إنشاء التحليل الدفقي',
        message: String(error),
      },
      { status: 500 }
    );
  }
}
