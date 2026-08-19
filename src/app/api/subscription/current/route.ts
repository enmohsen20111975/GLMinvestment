import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

/**
 * GET /api/subscription/current
 * Get current user's subscription (requires auth)
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      // Return default free tier for unauthenticated users
      return NextResponse.json({
        success: true,
        subscription: null,
        tier: 'free',
        message: 'لا يوجد اشتراك نشط',
      });
    }

    const userId = session.user.id as string;

    // Fetch user record for registration date & tier
    let dbUser = null;
    try {
      dbUser = await db.user.findUnique({
        where: { id: userId },
        select: { created_at: true, subscription_tier: true },
      });
    } catch (e) {
      console.warn('[GET /api/subscription/current] User error:', e);
    }

    const createdAt = dbUser?.created_at ? new Date(dbUser.created_at) : new Date();
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const daysLeft = Math.max(0, 30 - daysPassed);
    const isTrialActive = daysLeft > 0;
    const isTrialExpired = daysLeft <= 0;

    const TRIAL_DAYS = 30;
    const WARNING_DAYS = 7;
    const trialEndsAt = dbUser?.trial_ends_at ? new Date(dbUser.trial_ends_at) : new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const warningEndsAt = new Date(trialEndsAt.getTime() + WARNING_DAYS * 24 * 60 * 60 * 1000);
    const isInWarning = isTrialExpired && now < warningEndsAt;
    const isExpiredAndDeletionPending = isTrialExpired && now >= warningEndsAt;
    const warningDaysLeft = isInWarning ? Math.max(0, Math.ceil((warningEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;

    // Try to get the user's subscription with plan details
    try {
      const subscription = await db.userSubscription.findUnique({
        where: { user_id: userId },
        include: { plan: true },
      });

      if (subscription) {
        // Check if subscription is expired
        const isExpired = subscription.expires_at && new Date(subscription.expires_at) < now;
        const isInTrial = subscription.trial_ends_at ? new Date(subscription.trial_ends_at) > now : isTrialActive;

        const status = isExpired ? 'expired' : subscription.status;

        // Auto-update expired status
        if (isExpired && subscription.status === 'active') {
          try {
            await db.userSubscription.update({
              where: { id: subscription.id },
              data: { status: 'expired' },
            });
          } catch (e) {
            // Ignore update error
          }
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
            trial_ends_at: subscription.trial_ends_at || new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            is_in_trial: isInTrial,
            is_trial_expired: !isInTrial && isTrialExpired,
            days_left_in_trial: daysLeft,
            auto_renew: subscription.auto_renew,
            payment_method: subscription.payment_method,
            plan: subscription.plan ? {
              features: JSON.parse(subscription.plan.features || '[]'),
              max_watchlist: subscription.plan.max_watchlist,
              max_portfolio: subscription.plan.max_portfolio,
              max_alerts: subscription.plan.max_alerts,
              ai_analysis: subscription.plan.ai_analysis,
              deep_analysis: subscription.plan.deep_analysis,
              priority_support: subscription.plan.priority_support,
            } : null,
          },
        });
      }
    } catch (dbError) {
      console.warn('[GET /api/subscription/current] DB error:', dbError);
    }

    const tier = dbUser?.subscription_tier || session.subscription_tier || 'free';
    const isPaidUser = !['normal', 'premium', 'developer', 'admin', 'pro', 'enterprise'].includes(tier.toLowerCase());

    // Return default free tier info with calculated trial details
    return NextResponse.json({
      success: true,
      subscription: null,
      tier,
      trial: {
        is_free_user: isPaidUser ? false : true,
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
      message: isExpiredAndDeletionPending ? 'انتهت الفتره التجريبية وتم حذف بياناتك' : isTrialExpired ? 'انتهت الفتره التجريبية المجانية (30 يوماً)' : 'الفترة التجريبية نشطة',
    });
  } catch (error) {
    console.error('[GET /api/subscription/current] Error:', error);
    
    // Return default free tier on any error
    return NextResponse.json({
      success: true,
      subscription: null,
      tier: 'free',
      message: 'لا يوجد اشتراك نشط',
    });
  }
}
