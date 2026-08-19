import { NextRequest, NextResponse } from 'next/server';

/**
 * STOCK-LEAGUE-038: Proxy to Python backend for the Premier Stock League.
 *
 * GET /api/predictions/monthly-league?month=YYYY-MM
 *   Returns: { success, month, month_name, league[], count }
 *   league[] = top 10 closed trades by profit_pct in the specified month.
 */

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/predictions/monthly-league${qs ? `?${qs}` : ''}`;

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
      month: '',
      month_name: '',
      league: [],
      count: 0,
    }, { status: 503 });
  }
}
