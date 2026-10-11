/**
 * Honest Prediction Tracking — Stats
 * ==================================
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder zeros.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The Python endpoint /api/stored-analysis/honest-stats computes:
 *   - stats (total, wins, losses, winRate, avgWinPct, avgLossPct, profitFactor)
 *   - by_market
 *   - by_channel (from statsByPersona — each persona = a channel)
 *   - cumulative_returns (time-series)
 *   - monthly_breakdown
 *
 * This route just forwards query params + returns Python's JSON.
 * If Python is unavailable, returns 503 with success:false (no fake zeros).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';

  const pyParams = new URLSearchParams();
  pyParams.set('market', market);
  pyParams.set('days', searchParams.get('days') || '999');
  pyParams.set('limit', searchParams.get('limit') || '2000');

  const targetUrl = `${PY}/api/stored-analysis/honest-stats?${pyParams.toString()}`;
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
        message: 'تعذّر حساب الإحصائيات — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-honest-stats',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:stats] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض إحصائيات وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
