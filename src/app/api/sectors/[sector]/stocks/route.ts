import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/sectors/[sector]/stocks
 *
 * Proxy to Python backend /api/sectors/<sector_name>/stocks.
 *
 * Returns stocks belonging to a specific sector (all logic in Python).
 * Node = DISPLAY ONLY (Rule 20). No logic in this file.
 *
 * Query params (passed through to Python):
 *  - market: EGX | KSA | KUWAIT | QATAR (default: EGX)
 *  - limit: max 500 (default: 100)
 *  - sort: change_percent | volume | market_cap | current_price (default: change_percent)
 *  - order: asc | desc (default: desc)
 */
export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(
  req: NextRequest,
  { params }: { params: { sector: string } }
) {
  try {
    const sectorName = decodeURIComponent(params.sector);
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/sectors/${encodeURIComponent(sectorName)}/stocks${qs ? `?${qs}` : ''}`;

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
    }, { status: isTimeout ? 504 : 502 });
  }
}
