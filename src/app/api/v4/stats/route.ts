/**
 * GET /api/v4/stats  (also reachable via /api/python/v4/stats)
 * ============================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder zeros, NO direct SQLite.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 250 lines with a SQLite fallback chain that:
 *   - Opened predictions.db directly (Rule 20 violation — direct SQLite)
 *   - Computed win_rate + by_persona + top_tickers in Node (computation in Node)
 *   - Used Math.round 5 times (calculation in Node)
 *   - Used 3 SQL aggregations (SUM/AVG/COUNT) (computation in Node)
 *   - Returned `source: 'sqlite_fallback'` (Rule 27 violation — fallback chain)
 *
 * Now it's a pure proxy to Python /api/v4/stats which computes the same stats
 * from the canonical predictions table.
 *
 * Exports `handleV4Stats` so the catch-all `/api/python/[...path]` route can
 * re-use the same logic when the frontend calls `/api/python/v4/stats`.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

/**
 * Pure thin proxy to Python /api/v4/stats.
 * Shared handler — used by both /api/v4/stats and /api/python/v4/stats.
 */
export async function handleV4Stats(_req: NextRequest): Promise<NextResponse> {
  const targetUrl = `${PY}/api/v4/stats`;
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
        message: 'تعذّر جلب إحصائيات v4 — Python backend أرجع خطأ',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-v4-stats',
      },
    });
  } catch (error) {
    console.error('[v4/stats] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض إحصائيات وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}

// Default export for /api/v4/stats direct callers
export async function GET(req: NextRequest) {
  return handleV4Stats(req);
}
