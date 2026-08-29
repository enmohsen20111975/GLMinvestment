import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/portfolio/equity/curve
 *
 * Pure proxy to Python backend /api/portfolio/equity/curve.
 *
 * Rule 20 (Python = brain, Node = display only): NO fake fallback.
 * Rule 27 (NO-FAKE-DATA): removed previous fake snapshots generation
 * (was generating Math.random-style equity curve — violating both rules).
 *
 * If Python backend is unavailable, returns 502 with clear hint.
 * The client (WealthCharts.tsx, MasterPortfolioSummary.tsx) must handle
 * the 502 gracefully (show "data unavailable" message).
 */
export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/portfolio/equity/curve${qs ? `?${qs}` : ''}`;

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
      error: isTimeout ? 'انتهت مهلة الطلب' : 'فشل في الاتصال بـ Python Backend',
      details: errMsg,
      hint: 'تأكد أن Python backend يعمل على ' + PY + '/api/portfolio/equity/curve — لا بيانات كاذبة (Rule 27)',
    }, { status: isTimeout ? 504 : 502 });
  }
}

