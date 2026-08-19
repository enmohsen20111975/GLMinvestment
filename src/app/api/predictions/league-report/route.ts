import { NextRequest, NextResponse } from 'next/server';

/**
 * REPORTS-HUB-039: Proxy to Python backend for the Trading Reports Hub.
 *
 * GET /api/predictions/league-report?period=monthly
 *   period: daily | weekly | monthly | quarterly | semi_annual | yearly
 *   Returns: { success, period, period_name, start_date, end_date,
 *              period_label, league[], count }
 */

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/predictions/league-report${qs ? `?${qs}` : ''}`;

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
      period: '',
      period_name: '',
      start_date: '',
      end_date: '',
      period_label: '',
      league: [],
      count: 0,
    }, { status: 503 });
  }
}
