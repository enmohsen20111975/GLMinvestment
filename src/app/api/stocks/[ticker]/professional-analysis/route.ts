/**
 * DEPRECATED (Phase 4 — canonical_signal migration, API-AUDIT-2):
 * ===============================================================
 * This route duplicates /api/stocks/[ticker]/recommendation:
 *   - Same Python upstream  : /api/professional-analysis/<ticker>
 *   - Same SQLite fallback  : getStockByTickerFallback() from
 *                             flutter-sqlite-fallback.ts (stocks.db)
 *   - Same response shape   : { success, source, ticker, data }
 *
 * The canonical route is /api/stocks/[ticker]/recommendation. Old
 * callers of this route should switch their request URL.
 *
 * Rule 4 (NO-NEW-FILES / NO-DELETION): file intentionally kept so
 * existing callers (Flutter app, old dashboards) don't 404.
 * Rule 27 (NO-FAKE-DATA): returns a proper HTTP 410 Gone with a clear
 * `deprecated: true` flag — no mock data, no silent pass-through.
 *
 * Migration: replace
 *   /api/stocks/{ticker}/professional-analysis
 * with
 *   /api/stocks/{ticker}/recommendation
 * (same query params, same response shape — the canonical route
 * proxies the same Python endpoint and falls back to the same
 * SQLite predictions.db recommendation record).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();
  const url = new URL(request.url);
  const canonicalUrl = `/api/stocks/${tickerUpper}/recommendation${url.search ? `?${url.searchParams.toString()}` : ''}`;
  return NextResponse.json(
    {
      success: false,
      deprecated: true,
      error: 'endpoint_deprecated',
      error_ar:
        'تم إيقاف هذا الـ endpoint — استخدم /api/stocks/' +
        tickerUpper +
        '/recommendation بدلاً منه.',
      deprecated_at: '2026-10-15',
      canonical_route: `/api/stocks/${tickerUpper}/recommendation`,
      canonical_url: canonicalUrl,
      ticker: tickerUpper,
      message: `Use /api/stocks/${tickerUpper}/recommendation instead`,
    },
    { status: 410 }
  );
}
