/**
 * GET /api/predictions/league-report — Rule 20 Pure Thin Proxy
 * =============================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 70 lines with a SQLite fallback chain that:
 *   - Used `getPredictionsFallback` (Rule 20 violation — direct SQLite)
 *   - Sorted + sliced in Node (computation in Node)
 *   - Returned `source: 'sqlite_fallback'` (Rule 27 violation — placeholder)
 *
 * The Python endpoint `/api/predictions/league-report` already has the
 * LEAGUE-DEDUP-FIX (ROW_NUMBER() OVER PARTITION BY ticker) applied.
 * This route just forwards query params + returns Python's JSON.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const targetUrl = `${PY}/api/predictions/league-report${qs ? `?${qs}` : ''}`;
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
        message: 'تعذّر جلب تقرير الدوري — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-league-report',
      },
    });
  } catch (error) {
    console.error('[predictions:league-report] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض دوري وهمي (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
