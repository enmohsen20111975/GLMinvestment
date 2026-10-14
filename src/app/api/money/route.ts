/**
 * Unified Money Management API
 * =============================
 * GET /api/money?section=overview — ملخص شامل
 * GET /api/money?section=portfolio — المحفظة
 * GET /api/money?section=watchlist — قائمة المراقبة
 * GET /api/money?section=alerts — التنبيهات
 * GET /api/money?section=journal — ذاكرة التداول
 *
 * CANONICAL money route — pure proxy to Python /api/money. NO direct SQLite
 * access (Directive P1). If Python is unreachable → honest empty state
 * (Rule 27 NO-FAKE-DATA).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): empty arrays/zero totals, no fabricated data.
 * Rule 50 (MONEY-AS-CUSTOMER-LIFE): fail closed if no session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';
export const revalidate = 10;

/** Generic row shape returned by the original SQLite queries (kept for
 *  type compatibility with legacy consumers — `data: SqlRow[]` etc.). */
type SqlRow = Record<string, unknown>;

const EMPTY_DATA = {
  portfolio: { total_assets: 0, total_invested: 0, total_current_value: 0, total_pnl: 0, total_pnl_pct: 0, assets: [] as SqlRow[] },
  watchlist: { count: 0, items: [] as SqlRow[] },
  alerts: { active: 0 },
  journal: { total: 0, open: 0, wins: 0, losses: 0, win_rate: 0 },
  obligations: { count: 0, total_remaining: 0 },
};

export async function GET(request: NextRequest) {
  // ── Rule 50: AUTHENTICATE FIRST — fail closed if no session ─────────────
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        error: 'يجب تسجيل الدخول للوصول إلى بياناتك المالية',
        error_en: 'Authentication required to access your money data',
        data: EMPTY_DATA,
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const section = searchParams.get('section') || 'overview';

  // Python canonical endpoint (path mirrors this route).
  const targetUrl = new URL(`${PYTHON_BACKEND_URL}/api/money`);
  targetUrl.searchParams.set('section', section);
  targetUrl.searchParams.set('user_id', userId);

  try {
    const res = await fetch(targetUrl.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      // Forward canonical Python response shape — accept any successful
      // Python response (overview/portfolio/watchlist/journal shapes vary).
      if (data && data.success !== false && (data.data !== undefined || data.stats !== undefined)) {
        return NextResponse.json(data);
      }
    }
  } catch {
    // Python unreachable — fall through to honest empty (Rule 27).
  }

  // Rule 27: honest empty (shape preserved per section).
  if (section === 'portfolio' || section === 'watchlist' || section === 'journal') {
    return NextResponse.json({ success: true, data: [] });
  }

  return NextResponse.json({
    success: false,
    error: 'python_money_unavailable',
    data: EMPTY_DATA,
  });
}
