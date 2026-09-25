/**
 * GET/POST /api/alerts/scheduler
 * =================================
 * MONEY-TIER2-REBUILD: محرك التنبيهات الموحّد.
 *
 * - GET  : يرجع حالة الـ engine (last_run stats من user_notifications).
 * - POST : يشغّل runAllAlerts(userId?) ويرجع ملخص النتائج.
 *
 * Query params:
 *   only_me=1   — شغّل فقط للمستخدم الحالي (من الـ session).
 *   user_id=... — شغّل لمستخدم محدد (admin/mobile).
 *
 * Auth: session-based (getSessionUserId). الـ admin يقدر يشغّل لكل المستخدمين.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { runAllAlerts } from '@/lib/schedulers/alert-engine';
import { getFinanceDb } from '@/lib/finance-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const onlyMe = url.searchParams.get('only_me') === '1';

    const { userId, isAdmin } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // لو only_me=1، فلتر على المستخدم الحالي. غير كده، admin فقط.
    const targetUserId = onlyMe ? userId : (isAdmin ? undefined : userId);

    // جلب آخر stats من user_notifications
    let stats: Record<string, number> = {};
    let lastRun: string | null = null;
    try {
      const db = await getFinanceDb();
      // التأكد من وجود الجدول
      db.prepare(`
        CREATE TABLE IF NOT EXISTS user_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL DEFAULT 'system',
          title TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          severity TEXT DEFAULT 'info',
          payload TEXT,
          ticker TEXT,
          read INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();

      const filterClause = targetUserId ? 'WHERE user_id = ?' : '';
      const params = targetUserId ? [targetUserId] : [];

      const counts = db.prepare(
        `SELECT type, COUNT(*) AS n FROM user_notifications ${filterClause} GROUP BY type`
      ).all(...params) as { type: string; n: number }[];
      for (const c of counts) stats[c.type] = c.n;

      const lastRow = db.prepare(
        `SELECT MAX(created_at) AS last_run FROM user_notifications ${filterClause}`
      ).get(...params) as { last_run: string | null } | undefined;
      lastRun = lastRow?.last_run || null;
    } catch (err) {
      console.error('[GET /api/alerts/scheduler] stats failed:', err);
    }

    return NextResponse.json({
      success: true,
      mode: targetUserId ? 'user' : 'global',
      user_id: targetUserId || null,
      stats,
      last_run: lastRun,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/alerts/scheduler] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const onlyMe = url.searchParams.get('only_me') === '1';
    const overrideUserId = url.searchParams.get('user_id');

    const { userId, isAdmin } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // تحديد المستخدم المستهدف
    let targetUserId: string | undefined;
    if (onlyMe) {
      targetUserId = userId;
    } else if (overrideUserId) {
      // admin-only: تشغيل لمستخدم محدد
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: 'Admin access required to target other users' },
          { status: 403 }
        );
      }
      targetUserId = overrideUserId;
    } else {
      // افتراضي: admin = global scan (undefined), non-admin = self
      targetUserId = isAdmin ? undefined : userId;
    }

    const result = await runAllAlerts(targetUserId);

    return NextResponse.json({
      success: true,
      mode: targetUserId ? 'user' : 'global',
      user_id: targetUserId || null,
      ...result,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[POST /api/alerts/scheduler] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        stock_alerts: 0,
        gold_alerts: 0,
        pnl_alerts: 0,
        total: 0,
        duration_ms: 0,
      },
      { status: 500 }
    );
  }
}
