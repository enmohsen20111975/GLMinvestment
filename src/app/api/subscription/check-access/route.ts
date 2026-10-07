import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

/**
 * POST /api/subscription/check-access
 * Check if user has access to a specific feature
 * Used by mobile app to check subscription access
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { feature, ticker } = body;

    // Get session if available
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch (e) {
      // Session not available, continue as anonymous
    }

    const userId = session?.user?.id as string | undefined;

    // Default free tier access
    const defaultAccess = {
      hasAccess: false,
      tier: 'free',
      feature: feature || 'unknown',
      message: 'هذه الميزة متاحة للمشتركين فقط',
      message_en: 'This feature is available for subscribers only',
    };

    // If no user, return free tier
    if (!userId) {
      return NextResponse.json({
        success: true,
        ...defaultAccess,
        requiresAuth: true,
      });
    }

    // Try to get user data for registration date check
    let userRecord = null;
    try {
      userRecord = await db.user.findUnique({
        where: { id: userId },
        select: { created_at: true, subscription_tier: true, trial_ends_at: true },
      });
    } catch (e) {
      console.warn('[check-access] Error fetching user:', e);
    }

    // Try to get user subscription
    let subscription = null;
    try {
      subscription = await db.userSubscription.findUnique({
        where: { user_id: userId },
        include: { plan: true },
      });
    } catch (dbError) {
      console.warn('[check-access] DB error:', dbError);
    }

    // Determine tier & trial status
    let tier = userRecord?.subscription_tier || 'free';
    let hasActiveSubscription = false;

    if (subscription) {
      const now = new Date();
      const isExpired = subscription.expires_at && new Date(subscription.expires_at) < now;
      const isInTrial = subscription.trial_ends_at && new Date(subscription.trial_ends_at) > now;

      if (!isExpired || isInTrial) {
        hasActiveSubscription = true;
        tier = subscription.plan?.name || subscription.plan_id || 'basic';
      }
    }

    // ─── CANONICAL-CALCULATIONS (Task SUBSCRIPTION-FIX-2026-10-07, Rule 67) ─────
    // قبل كده: كان فيه hardcoded inline list مش متطابق مع PAID_TIERS →
    // b2b_starter/b2b_pro/b2b_enterprise/vip_pass كانوا بـ يتعاملوا معاهم كـ free
    // → العملاء اللي دفعوا فلوس بـ يتعملهم lock out!
    // الحل: استيراد PAID_TIERS من subscription-gate.ts (مصدر واحد).
    import { PAID_TIERS, TRIAL_DAYS as CANONICAL_TRIAL_DAYS } from '@/lib/subscription-gate';

    const TRIAL_DAYS = CANONICAL_TRIAL_DAYS;
    const WARNING_DAYS = 0;

    const createdAt = userRecord?.created_at ? new Date(userRecord.created_at) : new Date();
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const daysLeft = Math.max(0, TRIAL_DAYS - daysPassed);
    const isTrialActive = daysLeft > 0;
    const isTrialExpired = daysLeft <= 0;

    const trialEndsAt = userRecord?.trial_ends_at ? new Date(userRecord.trial_ends_at) : new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const warningEndsAt = new Date(trialEndsAt.getTime() + WARNING_DAYS * 24 * 60 * 60 * 1000);
    const isInWarning = isTrialExpired && now < warningEndsAt;
    const isExpiredAndDeletionPending = isTrialExpired && now >= warningEndsAt;
    const warningDaysLeft = isInWarning ? Math.max(0, Math.ceil((warningEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;

    // P0-5: use canonical PAID_TIERS Set (لا hardcoded inline list)
    const isFreeUser = !PAID_TIERS.has(tier.toLowerCase()) && !hasActiveSubscription;

    const featureAccess: Record<string, string[]> = {
      'pro_analysis': ['pro', 'premium', 'enterprise'],
      'ai_analysis': ['basic', 'pro', 'premium', 'enterprise'],
      'deep_analysis': ['pro', 'premium', 'enterprise'],
      'real_time_alerts': ['basic', 'pro', 'premium', 'enterprise'],
      'advanced_charts': ['basic', 'pro', 'premium', 'enterprise'],
      'portfolio_tracking': ['free', 'basic', 'pro', 'premium', 'enterprise'],
      'watchlist': ['free', 'basic', 'pro', 'premium', 'enterprise'],
      'market_overview': ['free', 'basic', 'pro', 'premium', 'enterprise'],
      'stock_analysis': ['free', 'basic', 'pro', 'premium', 'enterprise'],
      'expert_recommendations': ['pro', 'premium', 'enterprise'],
      'morning_recommendations': ['basic', 'pro', 'premium', 'enterprise'],
      'live_analysis': ['basic', 'pro', 'premium', 'enterprise'],
    };

    const allowedTiers = featureAccess[feature] || ['pro', 'premium', 'enterprise'];

    let hasAccess = false;
    if (hasActiveSubscription || !isFreeUser) {
      hasAccess = allowedTiers.includes(tier.toLowerCase()) || hasActiveSubscription;
    } else if (isTrialActive) {
      hasAccess = allowedTiers.includes('free');
    } else if (isInWarning) {
      hasAccess = allowedTiers.includes('free');
    } else if (isExpiredAndDeletionPending) {
      hasAccess = false;
    }

    let message = 'يمكنك الوصول إلى هذه الميزة';
    let message_en = 'You have access to this feature';

    if (isExpiredAndDeletionPending) {
      message = 'انتهت فترتك التجريبية وتم حذف بياناتك. يرجى الاشتراك مرة أخرى';
      message_en = 'Your trial has expired and your data has been deleted. Please subscribe again.';
    } else if (isInWarning) {
      message = `انتهت فترتك التجريبية. ستتم حذف بياناتك بعد ${warningDaysLeft} أيام. يرجى الاشتراك الآن.`;
      message_en = `Your trial has expired. Your data will be deleted in ${warningDaysLeft} days. Please subscribe now.`;
    } else if (isTrialExpired) {
      message = 'انتهت فترتك التجريبية المجانية (30 يوماً). يرجى الاشتراك في إحدى الخطط لمتابعة استخدام الخدمات';
      message_en = 'Your 30-day free trial has expired. Please subscribe to a plan to continue';
    } else if (!hasAccess) {
      message = 'هذه الميزة متاحة للمشتركين فقط';
      message_en = 'This feature is available for subscribers only';
    }

    return NextResponse.json({
      success: true,
      hasAccess,
      tier,
      feature,
      ticker,
      trial: {
        is_in_trial: isTrialActive,
        is_expired: isTrialExpired || isExpiredAndDeletionPending,
        is_in_warning: isInWarning,
        is_expired_and_deletion_pending: isExpiredAndDeletionPending,
        days_left: daysLeft,
        warning_days_left: warningDaysLeft,
        total_days: TRIAL_DAYS,
        warning_days: WARNING_DAYS,
      },
      subscription: subscription ? {
        plan_name: subscription.plan?.name || subscription.plan_id,
        status: subscription.status,
        expires_at: subscription.expires_at,
        is_in_trial: subscription.trial_ends_at && new Date(subscription.trial_ends_at) > new Date(),
      } : null,
      message,
      message_en,
    });

  } catch (error) {
    console.error('[check-access] Error:', error);

    return NextResponse.json({
      success: true,
      hasAccess: false,
      tier: 'free',
      feature: 'unknown',
      message: 'خطأ في التحقق من الصلاحية',
      message_en: 'Error checking access',
      error: 'internal_error',
    });
  }
}

/**
 * GET /api/subscription/check-access
 * Simple GET version for basic access check
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const feature = searchParams.get('feature') || 'unknown';

  return POST(new NextRequest(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ feature }),
  }));
}
