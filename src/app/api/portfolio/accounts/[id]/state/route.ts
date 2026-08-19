import { NextRequest, NextResponse } from 'next/server';

/**
 * MULTI-PORTFOLIO-032: Proxy to Python backend for a single sub-portfolio state.
 *
 * GET /api/portfolio/accounts/[id]/state?user_id=U
 *   Returns: { portfolio, positions[], latest_snapshot }
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
    const targetUrl = `${PY}/api/portfolio/accounts/${id}/state${qs ? `?${qs}` : ''}`;

    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}
