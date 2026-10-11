/**
 * GET /api/screener/advanced — Rule 20 Pure Thin Proxy
 * =====================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 474 lines of Node-side computation:
 *   - Direct SQLite access via better-sqlite3 (Rule 20 violation)
 *   - 380 lines of SQLite fallback computation (PRAGMA + JOINs + filters)
 *   - Column discovery + dynamic query building (Python's job)
 *   - Placeholder fallback with success:true + source:'unavailable' (Rule 27 violation)
 *
 * Now: just forwards query params + returns Python's JSON.
 * If Python is unavailable, returns 503 with success:false (no fake empty arrays).
 *
 * Paywall Gate (KEEP in Node — auth/subscription exception per Rule 20):
 *   - applyScreenerGate stays in Node — it's auth/subscription logic.
 *   - Free users with expired trial → see ONLY first 5 results (locked:true).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

const FREE_TIER_SCREENER_LIMIT = 5;

// ─── Paywall gate: limit free users to first 5 results ────────────────
// Per PAYWALL-STRATEGY-FINAL.md §5.2 row 7 — free users with expired trial
// see only the first 5 screener results. The full list is returned with
// `{ locked: true, total: N }` so the UI can render a lock card.
function applyScreenerGate<T extends Record<string, unknown>>(
  payload: T,
  locked: boolean,
): T {
  if (!locked) return payload;
  const stocksArr = Array.isArray(payload.stocks) ? payload.stocks as unknown[] : [];
  const total = stocksArr.length;
  const visible = stocksArr.slice(0, FREE_TIER_SCREENER_LIMIT);
  return {
    ...payload,
    stocks: visible,
    count: visible.length,
    total,
    locked: true,
    locked_count: Math.max(0, total - visible.length),
    free_preview_count: FREE_TIER_SCREENER_LIMIT,
    upgradeUrl: '/pricing',
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // ── PAYWALL Phase 2 — Gate 6: resolve paywall state ────────────────
  // Per Rule 20 exception: auth + subscription logic is ALLOWED in Node.
  const { userId } = await getSessionUserId();
  let screenerLocked = false;
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) screenerLocked = true;
  }

  // Forward all query params to Python
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/screener/advanced${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(25000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر تشغيل الفلتر المتقدم — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    // Apply paywall gate (Node-side — auth exception per Rule 20)
    return NextResponse.json(applyScreenerGate(data, screenerLocked), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-screener-advanced',
      },
    });
  } catch (error) {
    console.error('[screener:advanced] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض فلاتر وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
