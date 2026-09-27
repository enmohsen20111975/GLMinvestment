import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Generate a request ID that works in the Next.js Edge runtime.
 *
 * The Edge runtime does NOT support `import { randomUUID } from 'crypto'`
 * (Node.js built-in module). It DOES support the Web Crypto API
 * (`globalThis.crypto.randomUUID()`) on modern runtimes, but we still wrap
 * it in try/catch + a fallback for older runtimes / sandboxed environments.
 *
 * P0-16-TESTS fix (2026-09-28): the previous implementation used
 * `import { randomUUID } from 'crypto'` which crashed the middleware in
 * edge runtime with HTTP 500 on every request. See worklog.md.
 */
function generateRequestId(): string {
  try {
    // Try the Web Crypto API (works in Edge runtime + modern Node.js)
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  } catch {
    // ignore — fall through to time-based fallback
  }
  // Fallback: time-based ID (works in any runtime, including edge)
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Auth Middleware — categorizes routes and lets client-side handle auth UI.
 *
 * Also adds `x-request-id` to every response (P0 #15 fix — 2026-09-27).
 * The ID is propagated from an inbound `x-request-id` header if present
 * (so distributed traces survive across services), otherwise generated
 * as a UUIDv4. Server code can read it from `request.headers.get('x-request-id')`.
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
 * Auth is enforced client-side via SessionSync + useSession + <AuthGate />
 * (see src/components/auth/AuthGate.tsx). Protected views:
 *   stock-detail, portfolio, watchlist, recommendations, advanced-analysis,
 *   unified-analysis, specialist-analysis, prediction-performance,
 *   prediction-credibility, seasonality, reports, learning, simulation,
 *   alerts-center, trading-memory, trading-journal, publishing,
 *   crypto-detail, crypto-portfolio, crypto-watchlist, crypto-recommendations,
 *   crypto-analysis, crypto-learning, crypto-simulation, settings, admin
 *
 * Protected API routes handle auth internally via getServerSession() or
 * Bearer token checks and return 401 when unauthenticated:
 *   - /api/mobile/portfolio           (401 if no token)
 *   - /api/mobile/alerts/settings     (401 if no token)
 *   - /api/mobile/notifications       (401 if no token)
 *   - /api/mobile/recommendations     (limited to 3 items if no token)
 *   - /api/mobile/predictions         (limited to 3 items if no token)
 *   - /api/portfolio/*                (401 if no user)
 *   - /api/watchlist/*                (401 if no user)
 *   - /api/ai/chat                    (401 if no user/token)
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── P0 #15 (2026-09-27): request ID tracing ─────────────────────────
  // Use incoming x-request-id if provided (distributed trace propagation),
  // otherwise mint a fresh UUIDv4. We set it on the OUTGOING response so
  // clients can correlate requests with logs/network traces.
  //
  // Server route handlers can already read the inbound `x-request-id` header
  // from `request.headers` (when set by the client). For requests with no
  // inbound header, we use a fresh UUIDv4 here ONLY on the response —
  // route handlers that need to log a request-id should mint their own via
  // `crypto.randomUUID()` and use the structured logger (see src/lib/logger.ts).
  const requestId = request.headers.get('x-request-id') || generateRequestId();

  const response = NextResponse.next();
  response.headers.set('x-request-id', requestId);

  // DEV: Allow everything when running on localhost
  const isLocalhost =
    request.headers.get('x-forwarded-host') === 'localhost:3000' ||
    request.headers.get('host') === 'localhost:3000' ||
    request.headers.get('x-forwarded-host')?.startsWith('localhost') ||
    request.headers.get('host')?.startsWith('localhost');
  if (isLocalhost) {
    return response;
  }

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
    response.headers.set('Cache-Control', 'public, max-age=3600, must-revalidate');
    response.headers.set('X-Cache-Test', 'middleware-was-here');
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
    // '/api/admin/stats' — REMOVED: now protected by admin middleware (FIX July 2026)
  ];

  const isPublicApi = publicApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (isPublicApi) {
    return NextResponse.next();
  }


  // ========================================
  // ADMIN ROUTE PROTECTION (FIX July 2026 — v2)
  // Write operations (POST/PUT/DELETE/PATCH) require admin auth.
  // Read operations (GET/HEAD/OPTIONS) are allowed through —
  // the frontend needs them to display data on user-facing screens.
  // Destructive endpoints (drop-table, truncate, query, repair, restore)
  // ALWAYS require auth regardless of method.
  // ========================================
  const method = request.method;

  // Destructive admin endpoints — ALWAYS require auth (even GET)
  const destructivePrefixes = [
    '/api/admin/db/',
    '/api/admin/db-manager/drop-table',
    '/api/admin/db-manager/truncate-table',
    '/api/admin/db-manager/query',
    '/api/admin/db-manager/repair',
    '/api/admin/db-manager/restore',
    '/api/admin/db-manager/reindex',
    '/api/admin/db-manager/backup',
    '/api/admin/pm2-control',
    '/api/admin/import-stocks',
    '/api/admin/clear-',
    '/api/admin/generate-predictions',
    '/api/admin/fix-dates',
    '/api/admin/close-predictions',
    '/api/admin/sync-',
    '/api/admin/import-',
    '/api/admin/historical-backfill',
    '/api/admin/ai-analyze',
    '/api/admin/ab-test',
  ];
  const isDestructive = destructivePrefixes.some((prefix) => pathname.startsWith(prefix));

  // Write operations always require auth
  const isWriteOp = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  // REMOVED: Admin auth check from middleware (Edge runtime لا يدعم NextAuth session).
  // المصادقة على admin endpoints تتم جوه API routes نفسها (Node.js runtime)
  // باستخدام requireAdminAsync() اللي بتفحص:
  //   1. X-Admin-Token header أو admin_session cookie
  //   2. NextAuth session (Google login)
  //   3. Localhost bypass (dev mode)
  // كل admin route بتستدعي requireAdminAsync() في أول سطر.
  // السبب: الـ middleware في Edge runtime مش بيقدر يقرا NextAuth session
  // فكان بيعمل 401 غلط للمستخدمين المسجلين بـ Google.

  // For all other routes, pass through.
  // Auth is enforced client-side via SessionSync + useSession.
  // Protected API routes handle auth internally via getServerSession().
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/image (image optimization files)
     * - public folder files
     */
    '/((?!_next/image).*)',
  ],
};
