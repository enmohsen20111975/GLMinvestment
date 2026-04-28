import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStocks, getPriceHistory, isHeavyDbAvailable } from '@/lib/egx-db';

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// In-memory cache — lightweight overview, cached for 120 seconds
// ---------------------------------------------------------------------------

interface CoverageCacheEntry {
  data: DataCoverageResponse;
  timestamp: number;
}

interface DataCoverageResponse {
  total_stocks: number;
  stocks_with_data: number;
  stocks_without_data: number;
  coverage_percent: number;
  by_sector: Record<string, { with_data: number; without_data: number }>;
  no_data_stocks: Array<{ ticker: string; name: string; name_ar: string; sector: string }>;
}

let _coverageCache: CoverageCacheEntry | null = null;
const COVERAGE_CACHE_TTL_MS = 120_000; // 120 seconds

export async function GET(_request: NextRequest) {
  try {
    await ensureInitialized();

    // 1. Return cached result if still fresh
    if (_coverageCache && Date.now() - _coverageCache.timestamp < COVERAGE_CACHE_TTL_MS) {
      const cached = _coverageCache.data;
      return NextResponse.json({
        success: true,
        total_stocks: cached.total_stocks || 0,
        stocks_with_data: cached.stocks_with_data || 0,
        stocks_without_data: cached.stocks_without_data || 0,
        coverage_percent: cached.coverage_percent || 0,
        by_sector: cached.by_sector || {},
        no_data_stocks: Array.isArray(cached.no_data_stocks) ? cached.no_data_stocks : [],
        generated_at: new Date(_coverageCache.timestamp).toISOString(),
        last_updated: new Date(_coverageCache.timestamp).toISOString(),
        cached: true,
      });
    }

    // 2. Check heavy DB availability
    const heavyDbAvailable = isHeavyDbAvailable();

    // 3. Fetch all active stocks
    const allStocksResult = getStocks({ page_size: 500, is_active: true });
    const allStocks = allStocksResult.stocks;

    if (!allStocks || allStocks.length === 0) {
      return NextResponse.json(
        { error: 'No stocks found', detail: 'لم يتم العثور على أي أسهم في قاعدة البيانات' },
        { status: 404 }
      );
    }

    // 4. Initialize counters
    const bySector: Record<string, { with_data: number; without_data: number }> = {};
    const noDataStocks: Array<{ ticker: string; name: string; name_ar: string; sector: string }> = [];
    let stocksWithData = 0;
    let stocksWithoutData = 0;

    for (const stock of allStocks) {
      const ticker = String(stock.ticker ?? '');
      const name = String(stock.name ?? '');
      const nameAr = String(stock.name_ar ?? '');
      const sector = String(stock.sector ?? 'غير محدد');

      // Initialize sector bucket
      if (!bySector[sector]) {
        bySector[sector] = { with_data: 0, without_data: 0 };
      }

      if (!heavyDbAvailable) {
        // Heavy DB not available — all stocks counted as no-data
        stocksWithoutData++;
        bySector[sector].without_data++;
        noDataStocks.push({ ticker, name, name_ar: nameAr, sector });
        continue;
      }

      // Try to get price history for this stock
      const stockId = Number(stock.id);
      let hasData = false;

      try {
        const history = getPriceHistory(stockId, 30); // request 30 days for quick check
        hasData = history && history.length > 0;
      } catch {
        // If fetching fails for this stock, treat as no-data
        hasData = false;
      }

      if (hasData) {
        stocksWithData++;
        bySector[sector].with_data++;
      } else {
        stocksWithoutData++;
        bySector[sector].without_data++;
        noDataStocks.push({ ticker, name, name_ar: nameAr, sector });
      }
    }

    const totalStocks = allStocks.length;
    const coveragePercent = totalStocks > 0
      ? Number(((stocksWithData / totalStocks) * 100).toFixed(1))
      : 0;

    const coverageData: DataCoverageResponse = {
      total_stocks: totalStocks,
      stocks_with_data: stocksWithData,
      stocks_without_data: stocksWithoutData,
      coverage_percent: coveragePercent,
      by_sector: bySector,
      no_data_stocks: noDataStocks,
    };

    // 5. Cache the result
    _coverageCache = { data: coverageData, timestamp: Date.now() };

    // 6. Return response — always guarantee no_data_stocks is an array and numeric fields are safe
    const responsePayload: {
      success: boolean;
      total_stocks: number;
      stocks_with_data: number;
      stocks_without_data: number;
      coverage_percent: number;
      by_sector: Record<string, { with_data: number; without_data: number }>;
      no_data_stocks: Array<{ ticker: string; name: string; name_ar: string; sector: string }>;
      generated_at: string;
      last_updated: string;
      cached?: boolean;
      heavy_db_unavailable?: boolean;
      message?: string;
    } = {
      success: true,
      total_stocks: coverageData.total_stocks || 0,
      stocks_with_data: coverageData.stocks_with_data || 0,
      stocks_without_data: coverageData.stocks_without_data || 0,
      coverage_percent: coverageData.coverage_percent || 0,
      by_sector: coverageData.by_sector || {},
      no_data_stocks: Array.isArray(coverageData.no_data_stocks) ? coverageData.no_data_stocks : [],
      generated_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };

    if (!heavyDbAvailable) {
      responsePayload.heavy_db_unavailable = true;
      responsePayload.message = 'قاعدة البيانات الثقيلة غير متاحة حالياً. لا يمكن التحقق من توفر البيانات التاريخية.';
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[GET /api/stocks/data-coverage] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate data coverage report',
        detail: 'فشل في إنشاء تقرير تغطية البيانات',
        message: String(error),
        // Always return safe defaults so the frontend never crashes
        total_stocks: 0,
        stocks_with_data: 0,
        stocks_without_data: 0,
        coverage_percent: 0,
        by_sector: {},
        no_data_stocks: [],
        generated_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
