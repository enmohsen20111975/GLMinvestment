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
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    const userId = session.user.id as string;

    // Get the user's subscription with plan details
    const subscription = await db.userSubscription.findUnique({
      where: { user_id: userId },
      include: { plan: true },
    });

    if (!subscription) {
      // Return default free tier info
      return NextResponse.json({
        success: true,
        subscription: null,
        tier: session.subscription_tier || 'free',
        message: 'لا يوجد اشتراك نشط',
      });
    }

    // Check if subscription is expired
    const now = new Date();
    const isExpired = subscription.expires_at && new Date(subscription.expires_at) < now;
    const isTrialExpired = subscription.trial_ends_at && new Date(subscription.trial_ends_at) < now;
    const isInTrial = subscription.trial_ends_at && new Date(subscription.trial_ends_at) > now;

    const status = isExpired ? 'expired' : subscription.status;

    // Auto-update expired status
    if (isExpired && subscription.status === 'active') {
      await db.userSubscription.update({
        where: { id: subscription.id },
        data: { status: 'expired' },
      });
    }

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        plan_id: subscription.plan_id,
        plan_name: subscription.plan.name,
        plan_name_ar: subscription.plan.name_ar,
        status,
        started_at: subscription.started_at,
        expires_at: subscription.expires_at,
        trial_started_at: subscription.trial_started_at,
        trial_ends_at: subscription.trial_ends_at,
        is_in_trial: isInTrial,
        is_trial_expired: isTrialExpired,
        auto_renew: subscription.auto_renew,
        payment_method: subscription.payment_method,
        plan: {
          features: JSON.parse(subscription.plan.features || '[]'),
          max_watchlist: subscription.plan.max_watchlist,
          max_portfolio: subscription.plan.max_portfolio,
          max_alerts: subscription.plan.max_alerts,
          ai_analysis: subscription.plan.ai_analysis,
          deep_analysis: subscription.plan.deep_analysis,
          priority_support: subscription.plan.priority_support,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/subscription/current] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب الاشتراك' },
      { status: 500 }
    );
  }
}
