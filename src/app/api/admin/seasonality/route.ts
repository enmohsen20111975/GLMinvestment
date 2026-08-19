/**
 * GET /api/admin/seasonality
 * =========================
 * Phase 8: Proxy to Python backend's SeasonalityEngineV2.
 *
 * Query params (mutually exclusive modes):
 *   - ?ticker=COMI                  → ticker-level analysis (heatmap + recurring drops + analysis)
 *   - ?sector=القطاع%20المالي       → sector-level monthly seasonality
 *   - ?mode=heatmap&limit=20        → heatmap for top N active tickers by liquidity
 *
 * Optional: ?years=5 (1-10) controls how many years of price history to scan.
 *
 * Returns whatever the Python backend returns (already JSON-structured).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

/**
 * Build the Python backend URL based on the requested mode.
 * Returns null if the request is malformed (no mode + no ticker + no sector).
 */
function buildPythonUrl(searchParams: URLSearchParams): string | null {
  const ticker = searchParams.get('ticker');
  const sector = searchParams.get('sector');
  const mode = searchParams.get('mode');
  const years = searchParams.get('years') || '5';
  const limit = searchParams.get('limit') || '20';

  // Pass-through `years` for all modes (Python endpoints accept it).
  const qs = new URLSearchParams();
  qs.set('years', years);

  if (ticker) {
    return `${PYTHON_BACKEND_URL}/api/admin/seasonality/ticker/${encodeURIComponent(ticker.toUpperCase())}?${qs.toString()}`;
  }
  if (sector) {
    return `${PYTHON_BACKEND_URL}/api/admin/seasonality/sector/${encodeURIComponent(sector)}?${qs.toString()}`;
  }
  if (mode === 'heatmap') {
    qs.set('limit', limit);
    return `${PYTHON_BACKEND_URL}/api/admin/seasonality/heatmap?${qs.toString()}`;
  }
  return null;
}

export async function GET(request: NextRequest) {
  // Admin auth
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const pythonUrl = buildPythonUrl(searchParams);
    if (!pythonUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Bad request: provide one of ?ticker=, ?sector=, or ?mode=heatmap',
        },
        { status: 400 },
      );
    }

    // Forward X-Admin-Token if present (the Python backend's @require_admin uses its own auth,
    // but the route is registered under /api/admin/* which the Python side may gate independently).
    const adminToken = request.headers.get('x-admin-token');
    const headers: Record<string, string> = {};
    if (adminToken) headers['x-admin-token'] = adminToken;

    const upstream = await fetch(pythonUrl, {
      method: 'GET',
      headers,
      // Don't cache — seasonality data depends on live price history.
      cache: 'no-store',
    });

    const text = await upstream.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Python backend returned ${upstream.status}`,
          payload,
        },
        { status: upstream.status },
      );
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    console.error('[admin/seasonality GET] error:', e);
    return NextResponse.json(
      { success: false, error: e?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
