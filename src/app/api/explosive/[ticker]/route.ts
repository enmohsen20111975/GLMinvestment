/**
 * GET /api/explosive/[ticker]
 * ---------------------------
 * Primary: Python /api/explosive/<ticker>.
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — return the stock's basic
 *   metrics with an empty explosive_signal so the Flutter hunter screen
 *   shows "no explosive signal" instead of "connection error".
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStockByTickerFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();

  // 1. Try Python
  try {
    const r = await fetch(`${PY}/api/explosive/${encodeURIComponent(tickerUpper)}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.success !== false) {
        return NextResponse.json(d);
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — stocks.db basic data + derived explosive flag
  const stock = getStockByTickerFallback(tickerUpper);
  const changePct = Number(stock?.change_percent || 0);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    ticker: tickerUpper,
    explosive: stock
      ? {
          ticker: stock.ticker,
          name: stock.name,
          name_ar: stock.name_ar,
          current_price: stock.current_price,
          change_percent: stock.change_percent,
          volume: stock.volume,
          market_cap: stock.market_cap,
          signal:
            changePct >= 5
              ? 'explosive_up'
              : changePct <= -5
                ? 'explosive_down'
                : 'none',
          reason:
            changePct >= 5 || changePct <= -5
              ? `تغير ${changePct.toFixed(2)}%`
              : 'لا توجد إشارة انفجار',
        }
      : null,
    message: 'Python backend unreachable — using stocks.db data',
  });
}
