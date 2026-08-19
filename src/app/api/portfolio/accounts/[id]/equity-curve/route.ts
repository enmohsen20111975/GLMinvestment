import { NextRequest, NextResponse } from 'next/server';

/**
 * MULTI-PORTFOLIO-032: Proxy to Python backend for a single sub-portfolio equity curve.
 *
 * GET /api/portfolio/accounts/[id]/equity-curve?user_id=U&days=90
 *   Returns: { snapshots[], meta, count }
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

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}
