import { NextRequest, NextResponse } from 'next/server';

/**
 * MULTI-PORTFOLIO-032: Proxy to Python backend for a single sub-portfolio equity curve.
 *
 * GET /api/portfolio/accounts/[id]/equity-curve?user_id=U&days=90
 *   Returns: { snapshots[], meta, count }
 *
 * FIX-DB-RESTORE (Android engineer issue): previously this route could return
 * a Next.js HTML error page to the Flutter client if the Python backend
 * responded with non-JSON (HTML 404 / 502 from Nginx) because `res.json()`
 * would throw an uncaught SyntaxError outside any try/catch. The handler is
 * now fully wrapped and we explicitly:
 *   1. await `params` (Next.js 16 async dynamic API) inside try.
 *   2. Verify `res.ok` AND content-type is JSON before parsing — if Python
 *      returned HTML or a non-2xx status, we forward a clean JSON 502.
 *   3. Surface any unhandled exception as a JSON 503 (never HTML).
 */

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/portfolio/accounts/${id}/equity-curve${qs ? `?${qs}` : ''}`;

    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

    // If Python returned a non-2xx status OR returned HTML instead of JSON,
    // do NOT call res.json() — it would throw a SyntaxError. Forward a clean
    // JSON 502 so the Flutter client always sees JSON.
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      console.warn('[portfolio:accounts:[id]:equity-curve] upstream non-JSON or non-2xx:', {
        status: res.status,
        contentType,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'upstream_unavailable',
          snapshots: [],
          meta: { source: 'python', account_id: id, count: 0 },
          count: 0,
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error('[portfolio:accounts:[id]:equity-curve]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        snapshots: [],
        meta: { source: 'python', count: 0 },
        count: 0,
      },
      { status: 503 }
    );
  }
}
