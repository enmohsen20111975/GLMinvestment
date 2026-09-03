import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/sectors/tracking
 *
 * Proxy to Python backend /api/sectors/tracking.
 *
 * Returns sector heatmap + rotation + stocks per sector (all logic in Python:
 * engine/flow_system.py::get_sector_heatmap + detect_sector_rotation).
 *
 * Node = DISPLAY ONLY (Rule 20). No logic in this file.
 *
 * Query params (passed through to Python):
 *  - market: EGX | KSA | KUWAIT | QATAR (default: EGX)
 *  - with_rotation: 1 to include detect_sector_rotation (slower)
 *  - with_stocks: 1 to include stocks list per sector (default: 1)
 */
export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/sectors/tracking${qs ? `?${qs}` : ''}`;

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({
      success: false,
      error: isTimeout ? 'انتهت مهلة الطلب (Python backend لا يستجيب)' : 'فشل في الاتصال بـ Python Backend',
      details: errMsg,
      hint: 'تأكد أن Python backend يعمل على ' + PY + '/api/sectors/tracking',
    }, { status: isTimeout ? 504 : 502 });
  }
}
