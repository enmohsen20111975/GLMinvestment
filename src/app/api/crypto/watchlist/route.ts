/**
 * GET /api/crypto/watchlist — DELEGATES to canonical /api/watchlist
 * ============================================================================
 * P2-ARCH-A2 FIX (2026-10-14): This route previously had its own copy of the
 * watchlist SQL. Now it delegates to the canonical route with ?market=CRYPTO.
 *
 * Frontend callers (EnhancedWatchlistView with CRYPTO market) continue to work.
 * Future Phase: replace this route with a 308 redirect.
 */
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = '/api/watchlist';
  url.searchParams.set('market', 'CRYPTO');

  const forwarded = new NextRequest(url, {
    method: request.method,
    headers: request.headers,
  });
  const { GET: canonicalGet } = await import('@/app/api/watchlist/route');
  return canonicalGet(forwarded);
}
