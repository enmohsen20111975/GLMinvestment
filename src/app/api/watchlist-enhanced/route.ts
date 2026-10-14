/**
 * GET /api/watchlist-enhanced — DELEGATES to canonical /api/watchlist
 * ============================================================================
 * P2-ARCH-A2 FIX (2026-10-14): This route previously had its own copy of the
 * watchlist SQL (duplicate of /api/watchlist). Now it delegates to the
 * canonical route with ?enrich=live to preserve the "enhanced" behavior.
 *
 * Frontend callers (EnhancedWatchlistView) continue to work unchanged.
 * Future Phase: replace this route with a 308 redirect to /api/watchlist?enrich=live.
 */
import { NextRequest } from 'next/server';
import { marketPulseProxy } from '@/lib/market-pulse-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Delegate to canonical /api/watchlist with enrich=live flag
  const url = new URL(request.url);
  url.pathname = '/api/watchlist';
  url.searchParams.set('enrich', 'live');

  // Forward the request internally
  const forwarded = new NextRequest(url, {
    method: request.method,
    headers: request.headers,
  });
  // Dynamic import to avoid circular dependency
  const { GET: canonicalGet } = await import('@/app/api/watchlist/route');
  return canonicalGet(forwarded);
}
