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

// ---------------------------------------------------------------------------
// STABILITY (Phase 0): خنق تشغيل المحرك على مستوى السيرفر.
// كل تبويب مفتوح بيعمل POST هنا. من غير الخنق ده، 100 زائر = 100 تشغيل للمحرك
// كل دقيقة. دلوقتي: تشغيل واحد بالكتير كل دقيقتين لكل هدف (system أو مستخدم)،
// والطلبات المتزامنة بتستنى نفس التشغيل بدل ما تبدأ تشغيل جديد.
// ---------------------------------------------------------------------------
const MIN_RUN_INTERVAL_MS = 120_000;
type EngineResult = Awaited<ReturnType<typeof runAllAlerts>>;
const lastRunAt = new Map<string, number>();
const inFlight = new Map<string, Promise<EngineResult>>();

async function runThrottled(
  targetUserId: string | undefined
): Promise<{ result: EngineResult | null; throttled: boolean }> {
  const key = targetUserId ?? '__global__';
  const running = inFlight.get(key);
  if (running) return { result: await running, throttled: true };

  const last = lastRunAt.get(key) ?? 0;
  if (Date.now() - last < MIN_RUN_INTERVAL_MS) {
    return { result: null, throttled: true };
  }

  lastRunAt.set(key, Date.now());
  const p = runAllAlerts(targetUserId).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return { result: await p, throttled: false };
}

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
      { success: false, error: 'internal_error' },
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
      // الزائر: بيحدّث تنبيهات السوق العامة (system) — مخنوق لتشغيل واحد كل دقيقتين
      const { result, throttled } = await runThrottled('system');
      return NextResponse.json({
        success: true,
        mode: 'guest',
        user_id: 'system',
        throttled,
        ...(result ?? {}),
        generated_at: new Date().toISOString(),
      });
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

    // الأدمن لما يطلب تشغيل يدوي صريح (من غير only_me) مايتخنقش
    const manualAdminRun = isAdmin && !onlyMe;
    const { result, throttled } = manualAdminRun
      ? { result: await runAllAlerts(targetUserId), throttled: false }
      : await runThrottled(targetUserId);

    return NextResponse.json({
      success: true,
      mode: targetUserId ? 'user' : 'global',
      user_id: targetUserId || null,
      throttled,
      ...(result ?? {}),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[POST /api/alerts/scheduler] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
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
