import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getSessionUserId } from '@/lib/auth-helper';
import { PAID_TIERS } from '@/lib/subscription-gate';

/**
 * GET /api/subscription/status
 *
 * بيرجّع حالة اشتراك المستخدم الحالي:
 *   { tier, status, trialEndsAt, currentPeriodEndsAt, isExpired, daysLeft }
 *
 * بيستخدم في:
 *   - الـ frontend عشان يعرض الـ TrialExpiredModal
 *   - الـ middleware عشان يحدد الحظر
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId(req as any);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'غير مسجّل' },
        { status: 401 },
      );
    }

    let user = await authDb.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        subscription_tier: true,
        trial_ends_at: true,
        created_at: true,
      },
    });

    if (!user) {
      user = await authDb.user.findFirst({
        where: { OR: [{ id: userId }, { email: userId }] },
        select: {
          id: true,
          subscription_tier: true,
          trial_ends_at: true,
          created_at: true,
        },
      });
    }

    if (!user) {
      return NextResponse.json({
        success: true,
        tier: 'free',
        status: 'trial',
        trialEndsAt: null,
        isExpired: false,
        daysLeft: 14,
        isPaid: false,
      });
    }

    const tier = (user.subscription_tier || 'free').toLowerCase();
    const isPaid = PAID_TIERS.has(tier);

    // لو Free، نحسب حالة الـ trial
    if (!isPaid) {
      const trialEndsAt = user.trial_ends_at
        ? new Date(user.trial_ends_at)
        : user.created_at
          ? new Date(new Date(user.created_at).getTime() + 14 * 24 * 60 * 60 * 1000)
          : null;

      const now = new Date();
      const isExpired = trialEndsAt ? now > trialEndsAt : false;
      const daysLeft = trialEndsAt
        ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      return NextResponse.json({
        success: true,
        tier,
        status: isExpired ? 'expired' : 'trial',
        trialEndsAt,
        isExpired,
        daysLeft,
        isPaid: false,
      });
    }

    // لو Paid، نرجّع حالة الاشتراك
    const userSub = await authDb.userSubscription.findFirst({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
    });

    const isSubExpired = tier !== 'admin' && userSub?.expires_at ? new Date(userSub.expires_at) < new Date() : false;
    const isStatusActive = tier === 'admin' || (userSub ? (userSub.status === 'active' && !isSubExpired) : true);

    return NextResponse.json({
      success: true,
      tier,
      status: isStatusActive ? 'active' : 'expired',
      currentPeriodEndsAt: userSub?.expires_at || null,
      isExpired: !isStatusActive,
      isPaid: isStatusActive,
    });
  } catch (err: any) {
    console.error('[subscription/status] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل جلب حالة الاشتراك' },
      { status: 500 },
    );
  }
}
