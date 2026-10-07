import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/proxy-prod/[...path] — Generic proxy to PRODUCTION server
 * ===============================================================
 *
 * Purpose:
 *   Reads data from the production server (invist.m2y.net) so the
 *   sandbox / mobile app / dev environment can use FRESH real data
 *   instead of stale local DBs. Same API contract can be reused
 *   by the mobile app (Flutter) for production access.
 *
 * Owner directive (2026-09-02):
 *   "اعمل API يخليك تقرأ أي بيانات انت محتاجها من الموقع الإنتاجي.
 *    كدة كدة هاحتاجهم فى تطوير برنامج الموبايل. دة هايخليك حاسس ببيانات
 *    السيرفر الإنتاجى مش شغال على بيانات قديمة أو تخيليات."
 *
 * Behavior:
 *   - GET /api/proxy-prod/news-feed?limit=20
 *       → fetches https://invist.m2y.net/api/news-feed?limit=20
 *   - GET /api/proxy-prod/features
 *       → fetches https://invist.m2y.net/api/features
 *   - GET /api/proxy-prod/stocks?market=EGX&limit=10
 *       → fetches https://invist.m2y.net/api/stocks?market=EGX&limit=10
 *
 * Security:
 *   - READ-ONLY by default (only GET allowed).
 *   - POST/PUT/DELETE return 405 (Method Not Allowed).
 *   - Production URL is configurable via PRODUCTION_SERVER_URL env var
 *     (default: https://invist.m2y.net).
 *   - Only /api/* paths are proxied (no admin/auth bypass).
 *   - Rate limit: 30 requests/minute (simple in-memory counter).
 *
 * Use cases:
 *   1. Sandbox V40.2 reads fresh news from production instead of stale news.db
 *   2. Mobile app (Flutter) development against real production data
 *   3. Dashboard preview with real market data
 */

export const dynamic = 'force-dynamic';

const PRODUCTION_URL = process.env.PRODUCTION_SERVER_URL || 'https://invist.m2y.net';

// Whitelist of paths allowed to be proxied (security: no admin routes)
const ALLOWED_PATH_PREFIXES = [
  'news-feed',
  'news',
  'features',
  'stocks',
  'market-pulse',
  'market/overview',
  'market/indices',
  'market/sectors',
  'market/top-movers',
  'market/status',
  'market/morning-bell',
  'predictions/live',
  'predictions/honest-tracking/list',
  'predictions/tracking/list',
  'expert-recommendations',
  'expert-recommendations/active',
  'expert-recommendations/experts',
  'sectors',
  'sectors/tracking',
  'mobile/news',
  'mobile/dashboard',
  'mobile/summary',
  'mobile/stocks/EGX',
  'mobile/predictions',
  'mobile/recommendations',
  'mobile/market/overview',
  'mobile/market/morning-bell',
  'mobile/gold',
  'mobile/seasonality',
  'gold',
  'metals/gold',
  'currency',
  'currency/list',
  'live-monitor',
  'flow',
  'explosive',
  'unified-stocks',
  'unified-market-analysis',
  'topology',
  'health',
  'keepalive',
];

// Simple in-memory rate limiter (30 req/min per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_PER_MIN = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_PER_MIN) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { ok: true, remaining: RATE_LIMIT_PER_MIN - entry.count, resetAt: entry.resetAt };
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isPathAllowed(backendPath: string): boolean {
  // Block admin paths explicitly (defense in depth)
  if (backendPath.startsWith('admin/') || backendPath === 'admin') {
    return false;
  }
  // Allow exact match or prefix match
  return ALLOWED_PATH_PREFIXES.some(
    (p) => backendPath === p || backendPath.startsWith(p + '/') || backendPath.startsWith(p + '?')
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  // Rate limit
  const clientIp = getClientIp(request);
  const rl = checkRateLimit(clientIp);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: 'rate_limit_exceeded',
        error_ar: 'تم تجاوز الحد المسموح من الطلبات (30/دقيقة)',
        reset_at: new Date(rl.resetAt).toISOString(),
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(RATE_LIMIT_PER_MIN),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rl.resetAt / 1000)),
          'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const { path } = await params;
  const backendPath = path.join('/');

  // Security: only allow whitelisted paths
  if (!isPathAllowed(backendPath)) {
    return NextResponse.json(
      {
        error: 'path_not_allowed',
        error_ar: 'هذا المسار غير مسموح به عبر proxy الإنتاج',
        path: backendPath,
        allowed_examples: [
          '/api/proxy-prod/news-feed',
          '/api/proxy-prod/features',
          '/api/proxy-prod/stocks',
          '/api/proxy-prod/market/overview',
          '/api/proxy-prod/predictions/live',
        ],
      },
      { status: 403 }
    );
  }

  // Build production URL
  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${PRODUCTION_URL}/api/${backendPath}${searchParams ? `?${searchParams}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GLMinvestment-Proxy/1.0 (sandbox)',
      },
      cache: 'no-store',
      // 15s timeout via AbortController
      signal: AbortSignal.timeout(15000),
    });

    const body = await res.text();
    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => {
      // Don't forward hop-by-hop headers
      const lk = key.toLowerCase();
      if (!['connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(lk)) {
        responseHeaders.set(key, value);
      }
    });
    // CORS: same-origin only (like /api/proxy)
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') || '';
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost === host) {
          responseHeaders.set('Access-Control-Allow-Origin', origin);
          responseHeaders.set('Vary', 'Origin');
        }
      } catch {
        // ignore malformed origin
      }
    }
    responseHeaders.set('X-RateLimit-Limit', String(RATE_LIMIT_PER_MIN));
    responseHeaders.set('X-RateLimit-Remaining', String(rl.remaining));
    responseHeaders.set('X-Proxied-From', PRODUCTION_URL);

    return new NextResponse(body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`[proxy-prod] Error fetching ${url}:`, error?.message);
    return NextResponse.json(
      {
        error: 'production_unavailable',
        error_ar: 'تعذر الوصول للسيرفر الإنتاجي',
        detail: error?.message || String(error),
        production_url: PRODUCTION_URL,
        requested_path: backendPath,
      },
      { status: 502 }
    );
  }
}

// READ-ONLY: only GET is allowed
export async function POST() {
  return NextResponse.json(
    { error: 'method_not_allowed', error_ar: 'الـ proxy للقراءة فقط (GET)' },
    { status: 405 }
  );
}
export async function PUT() {
  return NextResponse.json(
    { error: 'method_not_allowed', error_ar: 'الـ proxy للقراءة فقط (GET)' },
    { status: 405 }
  );
}
export async function DELETE() {
  return NextResponse.json(
    { error: 'method_not_allowed', error_ar: 'الـ proxy للقراءة فقط (GET)' },
    { status: 405 }
  );
}

export async function OPTIONS() {
  const responseHeaders = new Headers();
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type');
  return new NextResponse(null, { status: 204, headers: responseHeaders });
}
