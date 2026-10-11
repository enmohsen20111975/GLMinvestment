/**
 * GET /api/market/liquidity-flow — Rule 20 Pure Thin Proxy
 * =========================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder zeros.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 472 lines of Node-side computation:
 *   - Direct SQLite access via better-sqlite3 (Rule 20 violation)
 *   - sector_flow aggregation + flow_direction classification
 *   - institutional_pct calculation
 *   - top_inflow/outflow filtering + sorting
 *   - 22 Math.round calls
 *   - 3 placeholder fallbacks (Rule 27 violation)
 *
 * Now: just forwards query params + returns Python's JSON.
 * If Python is unavailable, returns 503 with success:false (no fake zeros).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const targetUrl = `${PY}/api/market/liquidity-flow${qs ? `?${qs}` : ''}`;
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
        message: 'تعذّر حساب حركة السيولة — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-liquidity-flow',
      },
    });
  } catch (error) {
    console.error('[market:liquidity-flow] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض سيولة وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
