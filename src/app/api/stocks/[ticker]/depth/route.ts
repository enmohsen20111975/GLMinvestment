/**
 * GET /api/stocks/[ticker]/depth
 * ==============================
 * CANONICAL market-depth route — pure proxy to Python engine.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `intraday.db` directly (`new Database(...)`) and read `stock_intraday` ticks,
 * then ran local bucketing/imbalance computation. That bypassed the canonical
 * Python engine AND violated Rule 4 (Python = brain). Now it calls Python
 * `/api/stocks/{ticker}/depth` and passes the response through verbatim.
 *
 * The canonical current_price still comes from `getCanonicalPrice()` (Rule 67
 * SSOT) which is the centralized adapter — NOT a direct DB open in this route.
 *
 * If Python is unreachable → honest empty (Rule 27 NO-FAKE-DATA). The empty
 * response preserves the DepthResponse contract so MarketDepthLiquidityWidget
 * renders the "لا توجد بيانات" state without crashing.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 * Rule 67 (CALCULATION-CANONICAL — current_price via canonical adapter).
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getCanonicalPrice } from '@/lib/canonical-price';
import { cache } from '@/lib/cache-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DepthLevel {
  price: number;
  volume: number;
  orders: number;
  distance_pct: number;
}

interface DepthResponse {
  success: boolean;
  ticker: string;
  current_price?: number;
  bids?: DepthLevel[];
  asks?: DepthLevel[];
  spread?: number;
  total_bid_volume?: number;
  total_ask_volume?: number;
  imbalance?: number;
  interpretation?: 'buy_pressure' | 'sell_pressure' | 'balanced';
  source?: string;
  generated_at?: string;
  note?: string;
  error?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker?: string }> }
) {
  const resolved = await params;
  const rawTicker = (resolved.ticker || '').toUpperCase().trim();

  if (!rawTicker) {
    return NextResponse.json(
      { success: false, error: 'ticker is required', ticker: '' } satisfies DepthResponse,
      { status: 400 },
    );
  }

  // Parse ?levels=5 (default 5, max 10, min 1)
  const url = new URL(_req.url);
  let levels = Number(url.searchParams.get('levels') ?? '5');
  if (!Number.isFinite(levels) || levels < 1) levels = 5;
  if (levels > 10) levels = 10;
  levels = Math.floor(levels);

  const generated_at = new Date().toISOString();

  // Honest empty fallback (preserves DepthResponse contract).
  const empty: DepthResponse = {
    success: true,
    ticker: rawTicker,
    current_price: 0,
    bids: [],
    asks: [],
    spread: 0,
    total_bid_volume: 0,
    total_ask_volume: 0,
    imbalance: 0,
    interpretation: 'balanced',
    source: 'python_depth_empty',
    generated_at,
    note: 'لا توجد بيانات لحظية لهذا السهم',
  };

  try {
    // ---------- 1. Canonical current_price (Rule 67 SSOT) ----------
    let currentPrice = 0;
    try {
      const canonical = await cache.getOrCompute(
        `canonical_price:${rawTicker}`,
        () => getCanonicalPrice(rawTicker, { allowLive: false }),
        60_000,
      );
      if (canonical && Number.isFinite(canonical.value) && canonical.value > 0) {
        currentPrice = canonical.value;
      }
    } catch (e) {
      console.warn(
        `[depth] canonical-price lookup failed for ${rawTicker}:`,
        e instanceof Error ? e.message : e,
      );
    }

    // ---------- 2. Python canonical depth endpoint ----------
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/stocks/${rawTicker}/depth?levels=${levels}`,
      `http://127.0.0.1:8010/api/stocks/${rawTicker}/depth?levels=${levels}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(6000),
          cache: 'no-store',
        });
        if (!res.ok) continue;
        const json = await res.json();
        if (json && (json.success === true || (Array.isArray(json.bids) && Array.isArray(json.asks)))) {
          // Pass through Python response; inject canonical current_price if missing.
          const pyCurrent = Number(json.current_price);
          const mergedCurrent =
            Number.isFinite(pyCurrent) && pyCurrent > 0
              ? pyCurrent
              : currentPrice;
          return NextResponse.json({
            success: true,
            ticker: rawTicker,
            current_price: mergedCurrent,
            bids: Array.isArray(json.bids) ? json.bids : [],
            asks: Array.isArray(json.asks) ? json.asks : [],
            spread: Number(json.spread) || 0,
            total_bid_volume: Number(json.total_bid_volume) || 0,
            total_ask_volume: Number(json.total_ask_volume) || 0,
            imbalance: Number(json.imbalance) || 0,
            interpretation: json.interpretation || 'balanced',
            source: 'python_depth',
            generated_at,
          } satisfies DepthResponse);
        }
      } catch {
        // try next URL (safe-by-design)
      }
    }

    // ---------- 3. Honest empty (Rule 27) ----------
    return NextResponse.json({
      ...empty,
      current_price: currentPrice,
    } satisfies DepthResponse);
  } catch (e) {
    console.error(`[GET /api/stocks/${rawTicker}/depth] Error:`, e);
    return NextResponse.json(
      {
        success: false,
        ticker: rawTicker,
        current_price: 0,
        bids: [],
        asks: [],
        spread: 0,
        total_bid_volume: 0,
        total_ask_volume: 0,
        imbalance: 0,
        interpretation: 'balanced',
        source: 'python_depth_error',
        generated_at,
        error: 'internal_error',
      } satisfies DepthResponse,
      { status: 500 },
    );
  }
}
