/**
 * GET /api/radar/accuracy — Rule 20 Pure Thin Proxy
 * ===================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO placeholder zeros, NO fallback chain.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 740 lines of Node-side computation:
 *   - Direct SQLite access via better-sqlite3 (4 sites — Rule 20 violation)
 *   - classifyRadarPath (5 radar paths classification — Rule 67 violation)
 *   - computeWinRate (Rule 67 #7 — canonical: backtest_stats.py::compute_win_rate)
 *   - buildFromPredictionsTable + buildFromRadarTrackingTable (Rule 20 violation)
 *   - 2 placeholder fallbacks with zeros + success:true (Rule 27 violation)
 *
 * Now: just forwards query params + returns Python's JSON.
 *
 * Paywall Gate (KEEP in Node — auth/subscription exception per Rule 20):
 *   - applyAccuracyGate stays in Node — it's auth/subscription logic which
 *     is allowed in Node per Rule 20 (auth + paywall + subscription are exempt).
 *   - Free users with expired trial → see ONLY headline summary (locked:true).
 *   - Paid users / trial users / anonymous → see full breakdown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

// ─── Paywall gate: hide per-signal-type / per-market / monthly detail ───
// When `locked` is true, the caller is an authenticated free user whose
// 14-day trial has expired. Per PAYWALL-STRATEGY-FINAL.md §5.2 row 4 they
// see only the headline summary.
function applyAccuracyGate<T extends Record<string, unknown>>(data: T, locked: boolean): T {
  if (!locked) return data;
  return {
    ...data,
    by_signal_type: [{ locked: true }],
    by_market: [{ locked: true }],
    monthly_trend: [{ locked: true }],
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || '';
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 90, 7), 365);

  // PAYWALL Phase 2 — Gate 3 (auth + subscription check)
  // Per Rule 20 exception: auth + subscription logic is ALLOWED in Node.
  const { userId } = await getSessionUserId();
  let accuracyLocked = false;
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) accuracyLocked = true;
  }

  // Build Python query params
  const pyParams = new URLSearchParams();
  if (market) pyParams.set('market', market);
  pyParams.set('days', String(days));

  const targetUrl = `${PY}/api/radar/accuracy?${pyParams.toString()}`;
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
        message: 'تعذّر حساب دقة الرادار — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    // Apply paywall gate (Node-side — auth exception per Rule 20)
    return NextResponse.json(applyAccuracyGate(data, accuracyLocked), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-radar-accuracy',
      },
    });
  } catch (error) {
    console.error('[radar/accuracy] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض دقة وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
