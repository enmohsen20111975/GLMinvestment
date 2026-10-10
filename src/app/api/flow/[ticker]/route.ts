/**
 * GET /api/flow/[ticker]
 * ----------------------
 * Primary: Python /api/flow/<ticker> (order-flow analysis).
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — return the stock's basic
 *   price/volume data as a minimal flow snapshot.
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
    const r = await fetch(`${PY}/api/flow/${encodeURIComponent(tickerUpper)}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.success !== false) {
        return NextResponse.json(d);
      }
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — stocks.db basic price/volume data
  const stock = getStockByTickerFallback(tickerUpper);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    ticker: tickerUpper,
    flow: stock
      ? {
          ticker: stock.ticker,
          name: stock.name,
          current_price: stock.current_price,
          change_percent: stock.change_percent,
          volume: stock.volume,
          value_traded: stock.value_traded,
          buy_pressure: null,
          sell_pressure: null,
          net_flow: null,
        }
      : null,
    message: 'Python backend unreachable — using stocks.db data (no order-flow breakdown)',
  });
}
