import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
const API_KEY = process.env.PROXY_API_KEY || '';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/backtest/run-engine
 * Run BacktestEngine (MasterAnalyzer) from arbitrary start_date
 * Body: { ticker_count, start_date, end_date, horizon_days, persona_filter, disable_lessons }
 */
export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const targetUrl = `${PY}/api/admin/backtest/run-engine`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-API-Key'] = API_KEY;

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000), // 5 min timeout for long backtests
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
