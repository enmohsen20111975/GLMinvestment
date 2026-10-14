/**
 * GET /api/news/latest — DELEGATES to canonical /api/news
 * ============================================================================
 * P2-ARCH-A3 FIX (2026-10-14): Previously had its own proxy logic (duplicate
 * of /api/news). Now delegates to the canonical route with ?shape=latest.
 *
 * Frontend callers continue to work unchanged.
 * Future Phase: replace with 308 redirect to /api/news?shape=latest.
 */
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = '/api/news';
  url.searchParams.set('shape', 'latest');

  const forwarded = new NextRequest(url, {
    method: request.method,
    headers: request.headers,
  });
  const { GET: canonicalGet } = await import('@/app/api/news/route');
  return canonicalGet(forwarded);
}
