/**
 * GET /api/news-feed — DELEGATES to canonical /api/news
 * ============================================================================
 * P2-ARCH-A3 FIX (2026-10-14): Previously had its own multi-source fallback
 * logic (duplicate of /api/news). Now delegates to the canonical route with
 * ?shape=feed to preserve the multi-source enrichment behavior.
 *
 * Frontend callers (NewsFeedView) continue to work unchanged.
 * Future Phase: replace with 308 redirect to /api/news?shape=feed.
 */
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = '/api/news';
  url.searchParams.set('shape', 'feed');

  const forwarded = new NextRequest(url, {
    method: request.method,
    headers: request.headers,
  });
  const { GET: canonicalGet } = await import('@/app/api/news/route');
  return canonicalGet(forwarded);
}
