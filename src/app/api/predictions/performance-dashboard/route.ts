/**
 * GET /api/predictions/performance-dashboard — Rule 20 Pure Thin Proxy
 * =====================================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder zeros, NO direct SQLite.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 334 lines with:
 *   - Direct SQLite access via better-sqlite3 (Rule 20 violation)
 *   - WIN_STATUSES / LOSS_STATUSES / EXPIRED_STATUSES classification sets
 *   - computeStats function (Math.round 4 times)
 *   - computeByMarket / computeBySignal / computeTopTickers / computeTimeseries
 *   - Fallback to signal_type column if signal column doesn't exist
 *   - 5 Math.round calls + 4 aggregation loops (computation in Node)
 *
 * Now it's a pure proxy to Python /api/predictions/performance-dashboard
 * which implements the same logic with the same response shape.
 *
 * Response shape (mirrors legacy Node response):
 *   { success, market, days, filter, stats, by_market, by_signal,
 *     top_tickers, timeseries, generated_at }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/predictions/performance-dashboard${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر جلب لوحة أداء التوقعات — Python backend أرجع خطأ',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-performance-dashboard',
      },
    });
  } catch (error) {
    console.error('[predictions/performance-dashboard] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض لوحة أداء وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
