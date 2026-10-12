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
// ─── PKG3-ROUND2 (Rule 67: SSOT — canonical-price) ─────────────────────
// Before: route read `current_price` from the lib wrapper
//         `getStockByTickerFallback()` (which opens stocks.db directly).
//         That bypassed the canonical resolution chain (stocks.db →
//         data_engine → vps_api) and gave no source-stamping or cache.
// After: the price field is overridden by `getCanonicalPrice()` wrapped
//        in `cache.getOrCompute()` (TTL=60s, LRU=512). The metadata
//        (name, sector, volume, market_cap) still comes from the lib
//        wrapper — those are NOT price reads so they don't fall under
//        Rule 67's canonical-price SSOT.
//        Rule 27 (NO-FAKE-DATA): if canonical price is null (e.g. ticker
//        not in stocks.db AND not in data_engine AND vps_api unreachable)
//        → `current_price: null` → the UI renders "—".
import { getCanonicalPrice } from '@/lib/canonical-price';
import { cache } from '@/lib/cache-manager';

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
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — stocks.db basic data + derived explosive flag
  const stock = getStockByTickerFallback(tickerUpper);
  // PKG3-ROUND2: override current_price with the canonical value (Rule 67
  // SSOT). The lib wrapper returns the stocks.db.current_price directly,
  // which bypasses the canonical resolution chain. We override it here so
  // the canonical adapter (stocks.db → data_engine → vps_api) is the
  // single source of truth for the price field.
  let canonicalPrice: number | null = null;
  if (stock) {
    try {
      const canonical = await cache.getOrCompute(
        `canonical_price:${tickerUpper}`,
        () => getCanonicalPrice(tickerUpper, { allowLive: false }),
        60_000,
      );
      if (canonical && Number.isFinite(canonical.value) && canonical.value > 0) {
        canonicalPrice = canonical.value;
      } else {
        // Rule 27 (NO-FAKE-DATA): if canonical adapter returned null, do NOT
        // fabricate a price from a stale lib row — return null and let the
        // UI render "—".
        canonicalPrice = null;
      }
    } catch {
      canonicalPrice = null;
    }
  }
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
          current_price: canonicalPrice,
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
