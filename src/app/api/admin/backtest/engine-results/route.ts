import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
const API_KEY = process.env.PROXY_API_KEY || '';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/backtest/engine-results
 * Get BacktestEngine results from DB
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const limit = url.searchParams.get('limit') || '200';
    const targetUrl = `${PY}/api/admin/backtest/engine-results?limit=${limit}`;

    const headers: Record<string, string> = {};
    if (API_KEY) headers['X-API-Key'] = API_KEY;

    const res = await fetch(targetUrl, {
      headers,
      signal: AbortSignal.timeout(30000),
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
