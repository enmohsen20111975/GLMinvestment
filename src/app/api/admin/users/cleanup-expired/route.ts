import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getFinanceDb } from '@/lib/finance-db';
import { db } from '@/lib/db';
import { PAID_TIERS } from '@/lib/subscription-gate';

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const body = await request.json().catch(() => ({} as { userId?: string; dryRun?: boolean }));
    const { userId, dryRun = false } = body;

    const now = new Date();
    const nowIso = now.toISOString();

    let usersToDelete: Array<{ id: string; email: string }> = [];

    if (userId) {
      const u = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, subscription_tier: true, created_at: true, trial_ends_at: true },
      });
      if (!u) {
        return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 404 });
      }
      const tier = (u.subscription_tier || 'free').toLowerCase();
      const isPaid = PAID_TIERS.has(tier);
      if (!isPaid) {
        const created = new Date(u.created_at as unknown as string);
        const trialEndsAt = u.trial_ends_at ? new Date(u.trial_ends_at as unknown as string) : new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
        const warningEndsAt = new Date(trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (now >= warningEndsAt) {
          usersToDelete.push({ id: u.id, email: u.email });
        }
      }
    } else {
      const allFree = await db.user.findMany({
        where: {
          // P0-5: PAID_TIERS is the canonical set from @/lib/subscription-gate.
          // Spreading the Set gives Prisma's notIn the full paid-tier list
          // (including b2b_starter / b2b_pro / b2b_enterprise) so the cleanup
          // cron NEVER returns paying B2B users as deletion candidates.
          // Previously the inline list omitted b2b_* → paying B2B customers
          // were eligible for account deletion (Rule 50 — MONEY-AS-CUSTOMER-LIFE).
          subscription_tier: { notIn: [...PAID_TIERS] },
        },
        select: { id: true, email: true, subscription_tier: true, created_at: true, trial_ends_at: true },
      });

      for (const u of allFree) {
        const created = new Date(u.created_at as unknown as string);
        const trialEndsAt = u.trial_ends_at ? new Date(u.trial_ends_at as unknown as string) : new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
        const warningEndsAt = new Date(trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (now >= warningEndsAt) {
          usersToDelete.push({ id: u.id, email: u.email });
        }
      }
    }

    if (usersToDelete.length === 0) {
      return NextResponse.json({ success: true, message: 'لا يوجد مستخدمين مؤهلين للحذف', deleted: 0 });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        message: `سيتم حذف ${usersToDelete.length} مستخدم`,
        dryRun: true,
        users: usersToDelete,
        deleted: 0,
      });
    }

    const fdb = await getFinanceDb();
    let deletedCount = 0;
    let preservedCount = 0;

    // ─── SOFT-DELETE-FIX (Task SUBSCRIPTION-FIX-2026-10-07, Rule 50) ───────────
    // قبل كده: كان بـ hard-delete المستخدمين → عدد المستخدمين بيتذبذب (up AND down)
    // + العملاء اللي كان عندهم UserSubscription سابقاً (paymob أو promo) بـ يتعملهم
    // delete رغم إنهم دفعوا فلوس (BREACH Rule 50: MONEY-AS-CUSTOMER-LIFE).
    //
    // الحل:
    // (1) ما نحذفش أي مستخدم عنده UserSubscription row (paymob أو promo_code)
    //     — حتى لو الـ subscription انتهى، العميل ممكن يجدد.
    // (2) soft-delete بدلاً من hard-delete: set is_active=false + deleted_at=now()
    //     بدلاً من DELETE FROM users.
    // (3) المسح الفعلي ممكن يتعمل يدوياً بعد 90 يوم من soft-delete.
    for (const u of usersToDelete) {
      try {
        // (1) تحقق إن المستخدم ما عندهوش UserSubscription نشط أو سابق (paymob/promo_code)
        const hasSubHistory = await db.userSubscription.findFirst({
          where: { user_id: u.id },
          select: { id: true, status: true, expires_at: true },
        });
        if (hasSubHistory) {
          // العميل دفع فلوس في يوم ما — احتفظ ببياناته حتى لو الـ trial انتهى
          preservedCount++;
          continue;
        }

        // (2) soft-delete: عَلِّم is_active=false + deleted_at=now
        // بدلاً من حذف البيانات نهائياً
        await db.user.update({
          where: { id: u.id },
          data: {
            is_active: false,
            // ملاحظة: لو الـ schema ما فيهوش deleted_at، نكتفي بـ is_active=false
            // + نحدث last_active_at للـ tracking
          },
        });

        // امسح الـ session tokens (مش الـ portfolio/watchlist — العميل ممكن يرجع)
        fdb.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(u.id);
        // امسح analytics events القديمة (مش الـ portfolio/watchlist)
        fdb.prepare('DELETE FROM analytics_events WHERE user_id = ?').run(u.id);

        deletedCount++;
      } catch (e) {
        console.error(`[cleanup-expired] Failed to soft-delete user ${u.id}:`, e);
      }
    }

    try {
      fdb.save();
    } catch (e) {
      console.warn('[cleanup-expired] finance db save warning:', e);
    }

    return NextResponse.json({
      success: true,
      message: `تم تعطيل ${deletedCount} مستخدم (soft-delete) + الحفاظ على ${preservedCount} مستخدم سابق دفع`,
      deleted: deletedCount,
      preserved: preservedCount,
      users: userId ? undefined : usersToDelete.map(u => ({ id: u.id, email: u.email })),
    });
  } catch (error) {
    console.error('[POST /api/admin/users/cleanup-expired] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تنظيف المستخدمين', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
