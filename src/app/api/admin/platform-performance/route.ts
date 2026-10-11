/**
 * GET /api/admin/platform-performance — Rule 20 Pure Thin Proxy
 * =============================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder zeros.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 646 lines of:
 *   - Direct SQLite access via openDb (Rule 20 violation)
 *   - Win Rate + Profit Factor + Expectancy + Max Loss computation in Node
 *   - TP1/Stop hit rates computation
 *   - HARD cap (Rule 7) + MAX_RETURN_RATIO suspicious-flag logic
 *   - Trade validation + dedup (3-rule filter)
 *   - computeKPIs / computeByChannel / computeByMarket / computeReadiness
 *
 * Now it's a pure proxy to Python /api/admin/platform-performance which
 * implements the same logic with the same response shape.
 *
 * Rule 20 exception: Admin auth gate (requireAdminAsync) is preserved in Node —
 * this is the ONLY logic that stays in Node (auth is allowed).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  // Rule 20 exception: admin auth gate stays in Node (auth is allowed)
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/admin/platform-performance${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر جلب بيانات كفاءة المنصة — Python backend أرجع خطأ',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-platform-performance',
      },
    });
  } catch (error) {
    console.error('[admin/platform-performance] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض KPIs وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
