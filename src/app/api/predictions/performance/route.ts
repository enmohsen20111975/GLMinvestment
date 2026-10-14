/**
 * GET /api/predictions/performance
 * =================================
 * Aggregated performance metrics for AI predictions (Flutter Android app).
 *
 * Phase 1 (P1-PREDICTIONS-CLUSTER): pure Python proxy — NO direct SQLite
 * access. This route previously opened `db/predictions.db` directly
 * (`new Database(...)`) and ran three `.prepare()` aggregates against the
 * `predictions` table. That violated Rule 4. Now it proxies to
 * `${PYTHON_BACKEND_URL}/api/predictions/performance` and passes the
 * response through verbatim. If Python is unreachable → honest empty
 * (Rule 27 NO-FAKE-DATA).
 *
 * Response shape is preserved (summary + by_ticker + by_signal).
 *
 * Auth: required. Returns 401 if no userId.
 *
 * Query params:
 *   ?market=EGX   — optional market filter
 *   ?limit=N      — by-ticker limit (default 20)
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getSessionUserId } from '@/lib/auth-helper';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'مطلوب تسجيل الدخول',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market');
    const reqTickerLimit = parseInt(searchParams.get('limit') || '20', 10);
    const tickerLimit =
      Number.isFinite(reqTickerLimit)
        ? Math.min(Math.max(reqTickerLimit, 1), 100)
        : 20;

    // Build query string for Python.
    const qs = new URLSearchParams({ limit: String(tickerLimit) });
    if (market) qs.set('market', market);

    // Python canonical endpoints (primary + direct fallback).
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/predictions/performance?${qs.toString()}`,
      `http://127.0.0.1:8010/api/predictions/performance?${qs.toString()}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.success !== false) {
          // Pass through Python response verbatim (Rule 4: mirror only).
          // Normalize the shape so consumers see a stable contract:
          //   { success, source, generated_at, filter, summary, by_ticker, by_signal }
          return NextResponse.json({
            success: true,
            source: data.source || 'python_backend',
            generated_at: data.generated_at || new Date().toISOString(),
            filter: data.filter || { market: market || null },
            summary: data.summary || {
              total: 0,
              resolved: 0,
              hit_target_count: 0,
              hit_stop_count: 0,
              pending_count: 0,
              hit_rate_pct: 0,
              avg_return: null,
            },
            by_ticker: Array.isArray(data.by_ticker) ? data.by_ticker : [],
            by_signal: Array.isArray(data.by_signal) ? data.by_signal : [],
          });
        }
      } catch {
        // Try next fallback URL (safe-by-design).
      }
    }

    // Rule 27: honest empty — no fabricated performance stats.
    return NextResponse.json({
      success: true,
      source: 'python_empty',
      generated_at: new Date().toISOString(),
      filter: { market: market || null },
      summary: {
        total: 0,
        resolved: 0,
        hit_target_count: 0,
        hit_stop_count: 0,
        pending_count: 0,
        hit_rate_pct: 0,
        avg_return: null,
      },
      by_ticker: [],
      by_signal: [],
      message: 'لا توجد بيانات',
    });
  } catch (err) {
    console.error('[predictions/performance] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}
