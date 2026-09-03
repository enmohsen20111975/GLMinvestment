import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/stocks/top-performers
 *
 * Proxy to Python backend /api/stocks/top-performers.
 * Returns top gainers/losers over a specified period.
 *
 * Node = DISPLAY ONLY (Rule 20). All logic in Python
 * (vps-service/api/top_performers_routes.py reads data_engine.db.egksco_price_history).
 *
 * Query params (passed through to Python):
 *  - period: 1d | 7d | 15d | 1m | 3m | 6m | YTD | 1y (default: 1m)
 *  - direction: gainers | losers | both (default: both)
 *  - market: EGX | KSA | Kuwait | Qatar (default: EGX)
 *  - limit: max 100 (default: 20)
 */
export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/stocks/top-performers${qs ? `?${qs}` : ''}`;

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
      hint: 'تأكد أن Python backend يعمل على ' + PY + '/api/stocks/top-performers',
    }, { status: isTimeout ? 504 : 502 });
  }
}
