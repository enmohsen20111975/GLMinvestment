/**
 * دليل الاستثمار — GET /api/subscription/status
 *
 * Alias for GET /api/subscription/current — returns the authenticated user's
 * subscription status. Called by the Flutter Android app. Uses Bearer-token
 * auth (mobile) via `getSessionUserId()` from @/lib/auth-helper.
 *
 * Response: {
 *   success: true,
 *   subscription: {...} | null,
 *   tier: "free"|"normal"|"premium"|"developer",
 *   is_active: boolean,
 *   days_remaining: number,
 *   message: "..."
 * }
 */
import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TRIAL_DAYS = 30;
const WARNING_DAYS = 7;

export async function GET() {
  try {
    // --- Auth --------------------------------------------------------------
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح', error_en: 'Unauthorized' },
        { status: 401 }
      );
    }

    // --- User record -------------------------------------------------------
    let dbUser: any = null;
    try {
      dbUser = await db.user.findUnique({
        where: { id: userId },
        select: {
          created_at: true,
          subscription_tier: true,
          trial_ends_at: true,
          is_active: true,
        },
      });
    } catch (dbErr) {
      console.warn('[GET /api/subscription/status] User lookup error:', dbErr);
    }

    const createdAt = dbUser?.created_at ? new Date(dbUser.created_at) : new Date();
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const daysLeft = Math.max(0, TRIAL_DAYS - daysPassed);
    const isTrialActive = daysLeft > 0;
    const isTrialExpired = daysLeft <= 0;

    const trialEndsAt = dbUser?.trial_ends_at
      ? new Date(dbUser.trial_ends_at)
      : new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const warningEndsAt = new Date(
      trialEndsAt.getTime() + WARNING_DAYS * 24 * 60 * 60 * 1000
    );
    const isInWarning = isTrialExpired && now < warningEndsAt;
    const isExpiredAndDeletionPending = isTrialExpired && now >= warningEndsAt;
    const warningDaysLeft = isInWarning
      ? Math.max(0, Math.ceil((warningEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    // --- Subscription lookup ----------------------------------------------
    let subscription: any = null;
    try {
      subscription = await db.userSubscription.findUnique({
        where: { user_id: userId },
        include: { plan: true },
      });
    } catch (dbErr) {
      console.warn('[GET /api/subscription/status] Subscription lookup error:', dbErr);
    }

    const tier = dbUser?.subscription_tier || 'free';

    if (subscription) {
      const isExpired = subscription.expires_at
        ? new Date(subscription.expires_at) < now
        : false;
      const isInTrial = subscription.trial_ends_at
        ? new Date(subscription.trial_ends_at) > now
        : isTrialActive;
      const status = isExpired ? 'expired' : subscription.status;
      const is_active = !isExpired && status === 'active';

      // Auto-update expired status
      if (isExpired && subscription.status === 'active') {
        try {
          await db.userSubscription.update({
            where: { id: subscription.id },
            data: { status: 'expired' },
          });
        } catch {
          // ignore
        }
      }

      // days_remaining — days until subscription expires
      let days_remaining = 0;
      if (subscription.expires_at) {
        days_remaining = Math.max(
          0,
          Math.ceil((new Date(subscription.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );
      } else if (isInTrial) {
        days_remaining = Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      }

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscription.id,
          plan_id: subscription.plan_id,
          plan_name: subscription.plan?.name || 'free',
          plan_name_ar: subscription.plan?.name_ar || 'مجاني',
          status,
          started_at: subscription.started_at,
          expires_at: subscription.expires_at,
          trial_started_at: subscription.trial_started_at || dbUser?.created_at,
          trial_ends_at:
            subscription.trial_ends_at ||
            new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          is_in_trial: isInTrial,
          is_trial_expired: !isInTrial && isTrialExpired,
          days_left_in_trial: daysLeft,
          auto_renew: subscription.auto_renew,
          payment_method: subscription.payment_method,
          plan: subscription.plan
            ? {
                features: JSON.parse(subscription.plan.features || '[]'),
                max_watchlist: subscription.plan.max_watchlist,
                max_portfolio: subscription.plan.max_portfolio,
                max_alerts: subscription.plan.max_alerts,
                ai_analysis: subscription.plan.ai_analysis,
                deep_analysis: subscription.plan.deep_analysis,
                priority_support: subscription.plan.priority_support,
              }
            : null,
        },
        tier,
        is_active,
        days_remaining,
        trial: {
          is_in_trial: isInTrial,
          is_trial_expired: !isInTrial && isTrialExpired,
          is_in_warning: isInWarning,
          is_expired_and_deletion_pending: isExpiredAndDeletionPending,
          days_passed: daysPassed,
          days_left: daysLeft,
          warning_days_left: warningDaysLeft,
          total_days: TRIAL_DAYS,
          warning_days: WARNING_DAYS,
          trial_ends_at: new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        },
        message: isExpired
          ? 'انتهت صلاحية الاشتراك'
          : is_active
            ? 'الاشتراك نشط'
            : 'الاشتراك غير نشط',
      });
    }

    // --- No subscription record — return free-tier/trial info --------------
    const isPaidUser = !['normal', 'premium', 'developer', 'admin', 'pro', 'enterprise'].includes(
      (tier || '').toLowerCase()
    );

    return NextResponse.json({
      success: true,
      subscription: null,
      tier,
      is_active: true, // free tier is "active" by default
      days_remaining: isPaidUser ? 0 : daysLeft,
      trial: {
        is_free_user: !isPaidUser,
        is_in_trial: isPaidUser ? false : isTrialActive,
        is_trial_expired: isPaidUser ? false : isTrialExpired,
        is_in_warning: isPaidUser ? false : isInWarning,
        is_expired_and_deletion_pending: isPaidUser ? false : isExpiredAndDeletionPending,
        days_passed: daysPassed,
        days_left: daysLeft,
        warning_days_left: warningDaysLeft,
        total_days: TRIAL_DAYS,
        warning_days: WARNING_DAYS,
        trial_ends_at: new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      },
      message: isExpiredAndDeletionPending
        ? 'انتهت الفترة التجريبية وتم حذف بياناتك'
        : isTrialExpired
          ? 'انتهت الفترة التجريبية المجانية (30 يوماً)'
          : 'الفترة التجريبية نشطة',
    });
  } catch (error) {
    console.error('[GET /api/subscription/status] Error:', error);
    // Return a safe default rather than a 500 so the client UI doesn't crash
    return NextResponse.json({
      success: true,
      subscription: null,
      tier: 'free',
      is_active: true,
      days_remaining: 0,
      message: 'لا يوجد اشتراك نشط',
    });
  }
}
