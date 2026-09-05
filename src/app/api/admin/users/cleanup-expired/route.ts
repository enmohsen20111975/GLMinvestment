import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getFinanceDb } from '@/lib/finance-db';
import { db } from '@/lib/db';

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
      const isPaid = ['normal', 'premium', 'developer', 'admin', 'pro', 'enterprise'].includes(tier);
      if (!isPaid) {
        const created = new Date(u.created_at as string);
        const trialEndsAt = u.trial_ends_at ? new Date(u.trial_ends_at as string) : new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
        const warningEndsAt = new Date(trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (now >= warningEndsAt) {
          usersToDelete.push({ id: u.id, email: u.email });
        }
      }
    } else {
      const allFree = await db.user.findMany({
        where: {
          subscription_tier: { notIn: ['normal', 'premium', 'developer', 'admin', 'pro', 'enterprise'] },
        },
        select: { id: true, email: true, subscription_tier: true, created_at: true, trial_ends_at: true },
      });

      for (const u of allFree) {
        const created = new Date(u.created_at as string);
        const trialEndsAt = u.trial_ends_at ? new Date(u.trial_ends_at as string) : new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
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

    for (const u of usersToDelete) {
      try {
        // Delete from stocks.db
        fdb.prepare('DELETE FROM portfolio_assets WHERE user_id = ?').run(u.id);
        fdb.prepare('DELETE FROM user_stock_watchlists WHERE user_id = ?').run(u.id);

        // Delete from analytics.db (stocks.db also has analytics_events)
        fdb.prepare('DELETE FROM analytics_events WHERE user_id = ?').run(u.id);
        fdb.prepare('DELETE FROM page_views WHERE user_id = ?').run(u.id);
        fdb.prepare('DELETE FROM feature_usage WHERE user_id = ?').run(u.id);
        fdb.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(u.id);

        // Delete from auth.db (Prisma handles cascade: Account, Session, ApiToken, Watchlist, PortfolioItem, PortfolioHistory)
        await db.user.delete({ where: { id: u.id } });

        deletedCount++;
      } catch (e) {
        console.error(`[cleanup-expired] Failed to delete user ${u.id}:`, e);
      }
    }

    try {
      fdb.save();
    } catch (e) {
      console.warn('[cleanup-expired] finance db save warning:', e);
    }

    return NextResponse.json({
      success: true,
      message: `تم حذف ${deletedCount} مستخدم وكل بياناتهم`,
      deleted: deletedCount,
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
