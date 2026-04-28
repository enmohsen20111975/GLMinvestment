import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Auth Middleware — categorizes routes and lets client-side handle auth UI.
 *
 * Public routes (no auth required):
 *   - /api/auth/*          — NextAuth login/register callbacks
 *   - /api/health          — Health check
 *   - /api/keepalive       — Keepalive ping
 *   - /api/market/*        — Market data (stocks, gold, currency, indices)
 *   - /api/tips/*          — Smart tips
 *   - /api/v2/recommend    — Public recommendations
 *   - /api/v2/live-analysis — Public analysis
 *   - /api/v2/feedback/*   — Feedback loop (cron)
 *   - /_next/*             — Next.js static assets
 *   - /favicon.ico         — Favicon
 *   - /images/*            — Static images
 *
 * Auth is enforced client-side via SessionSync + useSession in page.tsx.
 * Protected API routes handle auth internally via getServerSession().
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // Prevent CDN (Hostinger hcdn) from caching HTML pages.
  // Static assets (_next/static) have content hashes and CAN be cached.
  // But HTML pages must always be fresh so users get the latest chunk hashes.
  const isPageRequest =
    !pathname.startsWith('/_next/') &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/favicon') &&
    !pathname.startsWith('/images/') &&
    !pathname.startsWith('/icons/') &&
    !pathname.endsWith('.js') &&
    !pathname.endsWith('.css') &&
    !pathname.endsWith('.ico') &&
    !pathname.endsWith('.png') &&
    !pathname.endsWith('.svg') &&
    !pathname.endsWith('.woff') &&
    !pathname.endsWith('.woff2');

  if (isPageRequest) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');
  }

  // Allow Next.js internals and static assets through
  const isStaticAsset =
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/icons/') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.woff2');

  if (isStaticAsset) {
    return response;
  }

  // Public API routes (no auth required)
  const publicApiPrefixes = [
    '/api/auth/',
    '/api/health',
    '/api/keepalive',
    '/api/market/',
    '/api/tips/',
    '/api/v2/recommend',
    '/api/v2/live-analysis',
    '/api/v2/feedback/',
    '/api/admin/stats',
  ];

  const isPublicApi = publicApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (isPublicApi) {
    return NextResponse.next();
  }

  // For all other routes, pass through.
  // Auth is enforced client-side via SessionSync + useSession.
  // Protected API routes handle auth internally via getServerSession().
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - public folder files
     */
    '/((?!_next/static|_next/image).*)',
  ],
};
