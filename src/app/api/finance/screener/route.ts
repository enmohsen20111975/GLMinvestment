/**
 * GET /api/finance/screener — Rule 20 Pure Thin Proxy
 * ====================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 306 lines of Node-side computation:
 *   - Direct SQLite access via better-sqlite3 (Rule 20 violation)
 *   - 5-table JOIN (stocks + stock_daily_prices + fundamentals + sectors)
 *   - Post-filter by sector/market_cap/pe_ratio/dividend_yield/volume
 *   - Sort by multiple fields + pagination
 *   - 100% Node-side (no Python endpoint existed)
 *
 * Now: just forwards query params + returns Python's JSON.
 * If Python is unavailable, returns 503 with success:false (no fake empty arrays).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const targetUrl = `${PY}/api/finance/screener${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر تشغيل الفلتر المالي — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-finance-screener',
      },
    });
  } catch (error) {
    console.error('[finance:screener] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض فلاتر وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
