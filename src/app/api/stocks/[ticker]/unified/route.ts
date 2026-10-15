/**
 * unified/route.ts — CANONICAL unified stock API (SINGLE SOURCE OF TRUTH)
 * ===============================================================================
 *
 * Route:  GET /api/stocks/[ticker]/unified
 *
 * Problem it solves:
 *   5 different UI screens showed 5 different signals for ETEL/CANA because each
 *   screen read from a different DB / API / calculation. This route is the
 *   ONE place that merges every data source and returns a canonical signal.
 *
 * Implementation:
 *   The actual computation logic lives in `src/lib/unified-stock-data.ts`.
 *   This route is a thin wrapper — same logic shared by all stock API routes.
 *   All other routes (/comprehensive, /publish-data, /recommendation, etc.)
 *   import from the same shared module so they return identical values.
 *
 * Rule 67 (CALCULATION-CANONICAL) + Rule 72 (UNIFIED-DATA-CONTRACT).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedStockData } from '@/lib/unified-stock-data';
// PHASE3-MARKET-SEGREGATION: validate the optional `market` query param so the
// canonical unified data is consistent with the user's selected market. The
// param is NOT used to filter — `getUnifiedStockData` reads `stock.market`
// directly from stocks.db (single source of truth). We only validate that
// the supplied alias is recognised, so the frontend can pass either 'TADAWUL'
// or 'KSA' without breaking the route.
import { normalizeMarket } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  // PHASE3-MARKET-SEGREGATION: read & validate the market query param.
  // We accept it gracefully but DON'T let an invalid value 404 the route —
  // the stock's market is the source of truth (read from stocks.db inside
  // getUnifiedStockData). This is purely for client-side consistency checks.
  const url = new URL(req.url);
  const marketParam = url.searchParams.get('market');
  if (marketParam) {
    const canonical = normalizeMarket(marketParam);
    // Log mismatches for diagnostics — do NOT block the request. A mismatch
    // typically means the user switched markets but is viewing an old stock.
    if (canonical === null && marketParam.toLowerCase() !== 'all') {
      console.warn(`[unified] unknown market alias "${marketParam}" for ticker ${ticker} — ignoring`);
    }
  }

  const data = getUnifiedStockData(ticker);
  if (!data) {
    return NextResponse.json(
      { success: false, error: 'stock_not_found', ticker },
      { status: 404 }
    );
  }

  // PULL FROM PYTHON BACKEND (SINGLE SOURCE OF TRUTH FOR STATE MACHINE)
  const pyBase = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');
  try {
    const pyRes = await fetch(`${pyBase}/api/stocks/${ticker}/unified`, {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    if (pyRes.ok) {
      const pyJson = await pyRes.json();
      if (pyJson && pyJson.data) {
        return NextResponse.json({
          ...data,
          ...pyJson.data,
          has_active_trade: pyJson.data.has_active_trade,
          trade_setup: pyJson.data.trade_setup,
          observation_status: pyJson.data.observation_status,
          observation_reason: pyJson.data.observation_reason,
          stock_info: pyJson.data.stock_info,
          liquidity_bucket: pyJson.data.liquidity_bucket,
          liquidity_reason: pyJson.data.liquidity_reason,
        });
      }
    }
  } catch (pyErr) {
    console.warn(`[unified route] Python backend offline for ${ticker}, using local fallback:`, pyErr);
  }

  return NextResponse.json(data);
}
