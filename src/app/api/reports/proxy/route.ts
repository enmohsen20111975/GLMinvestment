/**
 * Reports Proxy Route (Task 42 — Rule 67 / Rule 20 fix)
 * =========================================================================
 *
 * Owner's directive (EXACT):
 *   "النود هى بس للعرض والاساس فى البيانات هو محرك البيانات أو القلب
 *    و التفكير كلة من محرك التوقعات او التحليلات ودة العقل وان كل التفكير
 *    من البيثون فقط"
 *   → Node.js is display-only. Python is the brain. All thinking must
 *     come from Python (vps-service/api/reports_routes.py).
 *
 * Rule 67 root cause:
 *   ReportsView + DailyMarketReport + StockAnalysisReport fetched from
 *   10+ different APIs (stored-analysis/results, stored-analysis/live-tracking,
 *   apiClient.getAiInsights, apiClient.getMarketOverview,
 *   apiClient.getProfessionalAnalysis, predictions/honest-tracking/list,
 *   predictions/honest-tracking/missed-opportunities,
 *   market/recommendations/ai-insights, market/overview, stocks, export).
 *   Same data (predictions / market overview) was fetched from 3-4 different
 *   APIs → data conflicts.
 *
 * Rule 67 fix:
 *   This is the SINGLE source of truth for reports on the frontend.
 *   GET  /api/reports/proxy?type=daily|weekly|monthly&market=EGX&force=false
 *   →  proxies to ${PYTHON_BACKEND_URL}/api/reports/${type}/summary
 *      with the same query string.
 *
 *   The proxy does ZERO processing — it forwards the request to Python,
 *   returns Python's response as-is. Node.js remains display-only
 *   (Rule 20 — Python=Brain).
 *
 * Endpoints proxied (see vps-service/api/reports_routes.py):
 *   - daily   → /api/reports/daily/summary
 *   - weekly  → /api/reports/weekly/summary
 *   - monthly → /api/reports/monthly/summary
 *
 * Resilience:
 *   Python may be down (sandbox, dev, cold-start). When that happens
 *   we return a 502 with a clear Arabic error so the UI can show its
 *   fallback state instead of crashing.
 *
 * Auth:
 *   Public reports — no admin token required. The Python reports
 *   endpoints are public read-only summaries.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

const ALLOWED_TYPES = new Set(['daily', 'weekly', 'monthly']);
const PYTHON_TIMEOUT_MS = 30_000; // Python reports may take ~20s on cold start

/**
 * Map the frontend `type` query param to the Python reports_routes.py path
 * segment. The Python blueprint uses:
 *   /api/reports/daily/summary
 *   /api/reports/weekly/summary
 *   /api/reports/monthly/summary
 */
function buildPythonUrl(
  type: string,
  market: string,
  force: boolean,
): string {
  const path = `/api/reports/${type}/summary`;
  const params = new URLSearchParams();
  params.set('market', market);
  if (force) params.set('force', 'true');
  return `${PYTHON_BACKEND_URL}${path}?${params.toString()}`;
}

interface CacheEntry {
  body: ArrayBuffer;
  headers: [string, string][];
  status: number;
  statusText: string;
  expires: number;
}

const reportsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const typeRaw = (sp.get('type') || 'daily').toLowerCase().trim();
  const market = (sp.get('market') || 'EGX').toUpperCase().trim();
  const force = sp.get('force') === '1' || sp.get('force') === 'true';

  if (!ALLOWED_TYPES.has(typeRaw)) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Invalid type. Must be one of: daily, weekly, monthly (Rule 67 — unified reports proxy).',
        received_type: typeRaw,
      },
      { status: 400 },
    );
  }

  const cacheKey = `${typeRaw}:${market}`;
  if (!force) {
    const cached = reportsCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      const responseHeaders = new Headers(cached.headers);
      responseHeaders.set('X-Reports-Cache', 'HIT');
      return new NextResponse(cached.body.slice(0), {
        status: cached.status,
        statusText: cached.statusText,
        headers: responseHeaders,
      });
    }
  }

  const upstream = buildPythonUrl(typeRaw, market, force);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);

  try {
    const backendRes = await fetch(upstream, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    // Build response headers — copy content-type, drop hop-by-hop.
    const responseHeaders = new Headers();
    const headerEntries: [string, string][] = [];
    backendRes.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (
        lk === 'connection' ||
        lk === 'keep-alive' ||
        lk === 'transfer-encoding' ||
        lk === 'upgrade' ||
        lk === 'host'
      ) {
        return;
      }
      responseHeaders.set(key, value);
      headerEntries.push([key, value]);
    });

    // Same-origin CORS hardening (mirror /api/proxy/* behavior).
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') || '';
    const xForwardedHost = request.headers.get('x-forwarded-host') || '';
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost === host || originHost === xForwardedHost) {
          responseHeaders.set('Access-Control-Allow-Origin', origin);
          responseHeaders.set('Vary', 'Origin');
        }
      } catch { // silent fallback (safe-by-design)
        // malformed origin — ignore
      }
    }
    responseHeaders.set(
      'Access-Control-Allow-Methods',
      'GET, OPTIONS',
    );
    responseHeaders.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );

    const body = await backendRes.arrayBuffer();

    // Cache successful responses for 3 minutes
    if (backendRes.status === 200) {
      reportsCache.set(cacheKey, {
        body,
        headers: headerEntries,
        status: backendRes.status,
        statusText: backendRes.statusText,
        expires: Date.now() + CACHE_TTL_MS,
      });
    }

    return new NextResponse(body, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const aborted =
      err instanceof Error && err.name === 'AbortError';
    console.error(
      `[reports/proxy] ${typeRaw} failed:`,
      aborted ? 'timeout' : err,
    );
    return NextResponse.json(
      {
        success: false,
        error: aborted
          ? 'استغرق تحميل بيانات السوق وقتاً أطول من المعتاد. يرجى إعادة المحاولة.'
          : 'جاري تحديث بيانات السوق حالياً. يرجى إعادة المحاولة بعد لحظات.',
        error_code: aborted ? 'timeout' : 'backend_updating',
        type: typeRaw,
        market,
        // Empty payload so the UI can show its "no data" state instead of crashing.
        data: null,
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function OPTIONS() {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return new NextResponse(null, { status: 204, headers });
}
