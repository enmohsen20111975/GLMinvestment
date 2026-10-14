/**
 * market-pulse-proxy.ts — canonical proxy helper for /api/market-pulse
 * ===============================================================================
 *
 * Task P1-CLEANUP (2026-10-08): توحيد 37 mislabeled proxy routes.
 * كل الـ routes دي كانت copy-paste من نفس الـ proxy code (25 LOC × 37 = 925 LOC duplicate).
 * الآن كل route يستدعي هذا الـ helper بسطر واحد.
 *
 * P1-CRIT FIX (2026-10-14): Unified error handling via apiErr() from api-response.ts.
 *   - All errors now return { success: false, error: "...", timestamp: "..." }
 *   - Status codes: 503 (Python unreachable), 502 (Python error), 504 (timeout)
 *   - Arabic-first error messages (Rule 30: CLIENT-FACING-STYLE)
 *
 * Usage in a route.ts:
 *   import { marketPulseProxy } from '@/lib/market-pulse-proxy';
 *   export async function GET(req: NextRequest) { return marketPulseProxy(req); }
 *   export async function POST(req: NextRequest) { return marketPulseProxy(req); }
 *
 * NOTE: Routes using this helper are aliases for /api/market-pulse.
 *   See AUDIT_REPORT_FULL.md Section 3.2 (CRIT-C-2) for the full list of 23 routes.
 *   Future cleanup: consolidate these into 308 redirects to /api/market-pulse.
 */

import { NextRequest } from 'next/server';
import { apiErr } from '@/lib/api-response';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

/**
 * Canonical proxy: forwards the incoming request to Python /api/market-pulse
 * and returns a unified JSON envelope on success or error.
 *
 * @param req - The incoming Next.js request
 * @returns NextResponse with unified JSON envelope
 */
export async function marketPulseProxy(req: NextRequest): Promise<Response> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;

    const options: RequestInit = { signal: AbortSignal.timeout(30000) };
    if (req.method !== 'GET') {
      options.method = req.method;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = await req.text();
    }

    const res = await fetch(targetUrl, options);
    const elapsed = Date.now() - startTime;

    // Log slow requests (>5s) for performance monitoring
    if (elapsed > 5000) {
      console.warn(`[marketPulseProxy:${requestId}] Slow response: ${elapsed}ms`);
    }

    // Parse upstream JSON. If parsing fails, return unified 502 error.
    let data: unknown;
    try {
      data = await res.json();
    } catch (parseErr) {
      console.error(`[marketPulseProxy:${requestId}] Upstream JSON parse failed:`, parseErr);
      return apiErr(
        'فشل في تحليل استجابة الخادم',
        { code: 'UPSTREAM_PARSE_ERROR', status: 502, details: { upstream_status: res.status } }
      );
    }

    // BUG 7 FIX (FIX-A-API): pass upstream status code through to client.
    // Without this, Python 5xx errors would be reported as HTTP 200 to the client.
    return Response.json(data, { status: res.status });
  } catch (e) {
    const elapsed = Date.now() - startTime;
    const err = e instanceof Error ? e : new Error(String(e));

    // Classify the error
    const isTimeout = err.name === 'AbortError' || err.message.includes('timeout');
    const isConnection = err.message.includes('ECONNREFUSED')
                      || err.message.includes('fetch failed')
                      || err.message.includes('network');

    if (isTimeout) {
      console.error(`[marketPulseProxy:${requestId}] Timeout after ${elapsed}ms:`, err.message);
      return apiErr(
        'انتهت مهلة الاتصال بالخادم (30 ثانية)',
        { code: 'UPSTREAM_TIMEOUT', status: 504, details: { elapsed_ms: elapsed } }
      );
    }

    if (isConnection) {
      console.error(`[marketPulseProxy:${requestId}] Connection failed after ${elapsed}ms:`, err.message);
      return apiErr(
        'تعذّر الاتصال بخادم التحليلات. يرجى المحاولة لاحقًا.',
        { code: 'UPSTREAM_UNREACHABLE', status: 503, details: { elapsed_ms: elapsed } }
      );
    }

    // Generic error (last resort)
    console.error(`[marketPulseProxy:${requestId}] Unexpected error after ${elapsed}ms:`, err);
    return apiErr(
      'حدث خطأ غير متوقع في الخادم',
      { code: 'INTERNAL_ERROR', status: 500, details: { elapsed_ms: elapsed } }
    );
  }
}
