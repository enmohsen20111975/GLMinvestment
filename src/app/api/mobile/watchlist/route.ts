/**
 * GET /api/mobile/watchlist — DELEGATES to canonical /api/watchlist
 * ============================================================================
 * P2-ARCH-A2 FIX (2026-10-14): This route previously had its own copy of the
 * watchlist SQL (duplicate of /api/watchlist). Now it delegates to the
 * canonical route with ?shape=mobile to preserve the mobile response format.
 *
 * Frontend callers (Flutter app) continue to work unchanged.
 * Future Phase: replace this route with a 308 redirect to /api/watchlist?shape=mobile.
 */
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

export async function GET(request: NextRequest) {
  // Delegate to canonical /api/watchlist with shape=mobile flag
  const url = new URL(request.url);
  url.pathname = '/api/watchlist';
  url.searchParams.set('shape', 'mobile');

  const forwarded = new NextRequest(url, {
    method: request.method,
    headers: request.headers,
  });
  const { GET: canonicalGet } = await import('@/app/api/watchlist/route');
  return canonicalGet(forwarded);
}
