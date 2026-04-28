import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStocks } from '@/lib/egx-db';
import { batchRefreshStocks, generateDataHealthReport } from '@/lib/egx-data-sources';
import { validateStockData, detectFakeData, isDataFresh } from '@/lib/data-validator';
import { getWritableDatabase } from '@/lib/egx-db';
import type { StockDataPoint } from '@/lib/data-validator';

export const maxDuration = 60;

/**
 * GET /api/market/refresh-data
 * Returns a health report of the current data quality.
 */
export async function GET(_request: NextRequest) {
  try {
    await ensureInitialized();
    const { stocks } = getStocks({ page: 1, page_size: 500 });

    const report = generateDataHealthReport(
      stocks.map((s) => ({
        ticker: s.ticker as string,
        current_price: Number(s.current_price) || 0,
        previous_close: Number(s.previous_close) || undefined,
        sector: s.sector as string | undefined,
        name: s.name as string | undefined,
        name_ar: s.name_ar as string | undefined,
        last_update: s.last_update as string | undefined,
        volume: Number(s.volume) || undefined,
      }))
    );

    return NextResponse.json({
      success: true,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/market/refresh-data] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate data health report', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/market/refresh-data
 * Refresh stock data from verified sources with rate limiting.
 * Body: { tickers?: string[], maxStocks?: number }
 */
export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();

    const body = await request.json().catch(() => ({}));
    const maxStocks = Math.min(body.maxStocks || 10, 30); // Cap at 30
    let tickers: string[] = body.tickers || [];

    // If no specific tickers, pick stocks that need refreshing most
    if (tickers.length === 0) {
      const { stocks } = getStocks({ page: 1, page_size: 500 });

      // Filter out fake stocks and sort by staleness
      const scored = stocks
        .filter((s) => {
          const price = Number(s.current_price);
          return price > 0 && !detectFakeData({
            ticker: s.ticker as string,
            current_price: price,
            name: s.name as string | undefined,
            name_ar: s.name_ar as string | undefined,
          }).is_suspicious;
        })
        .map((s) => ({
          ticker: s.ticker as string,
          volume: Number(s.volume) || 0,
          stale_hours: isDataFresh(s.last_update as string | undefined, 24).fresh ? 0 :
            isDataFresh(s.last_update as string | undefined).age_hours,
        }))
        .sort((a, b) => b.stale_hours - a.stale_hours || b.volume - a.volume);

      tickers = scored.slice(0, maxStocks).map((s) => s.ticker);
    }

    if (tickers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No stocks to refresh',
        results: [],
        refreshed: 0,
        failed: 0,
        elapsed_ms: 0,
      });
    }

    const startTime = Date.now();

    // Fetch fresh data for each stock with rate limiting
    const results = await batchRefreshStocks(tickers, {
      maxStocks: tickers.length,
    });

    const elapsedMs = Date.now() - startTime;
    const successResults = results.filter((r) => r.success);
    const failedResults = results.filter((r) => !r.success);

    return NextResponse.json({
      success: true,
      message: `Refreshed ${successResults.length}/${tickers.length} stocks in ${Math.round(elapsedMs / 1000)}s`,
      results,
      refreshed: successResults.length,
      failed: failedResults.length,
      elapsed_ms: elapsedMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[POST /api/market/refresh-data] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to refresh data', detail: String(error) },
      { status: 500 }
    );
  }
}
