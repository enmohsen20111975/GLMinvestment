/**
 * GET /api/market/exit-status?limit=20&ticker=COMI — Rule 20 Pure Thin Proxy
 * ========================================================================
 *
 * RULE20-PURE-PROXY (P2-FALLBACK-REMOVAL): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder exit_status=null
 *   arrays returned when Python is unavailable.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth for
 *   the P41 Exit Engine decisions (TAKE_PROFIT / REDUCE / EXIT / HOLD).
 *
 * The previous route had a 96-line SQLite fallback chain that:
 *   - Used `getPredictionsFallback` (Rule 20 violation — direct SQLite reads)
 *   - Mapped predictions rows into synthetic exit-status objects with
 *     `exit_status: null` + `exit_reason: null` + a fabricated
 *     `exit_note: 'حالة الخروج اللحظي غير متاحة...'` (Rule 27 violation —
 *     placeholder data masquerading as a real response)
 *   - Used `computeRiskReward` in Node (Rule 20 violation — computation
 *     in Node)
 *
 * Python endpoint `/api/market/exit-status` (stored_analysis_routes.py L3145)
 * already returns the canonical structure with the SmartExitEngine decision
 * per active prediction. This route just forwards query params + returns
 * Python's JSON.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY =
  process.env.EGXPY_SERVICE_URL ||
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const targetUrl = `${PY}/api/market/exit-status${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `python-returned-${res.status}`,
          message:
            'تعذّر جلب حالة الخروج اللحظي — Python backend أرجع خطأ',
        },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-exit-status',
      },
    });
  } catch (error) {
    console.error('[market:exit-status] Python backend unavailable:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'python-backend-unavailable',
        message:
          'Python backend غير متاح — لا يمكن عرض بيانات خروج وهمية (Rule 27)',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      },
      { status: 503 }
    );
  }
}
