/**
 * دليل الاستثمار — POST /api/subscription/trial
 *
 * Alias for POST /api/subscription/start-trial — starts the free trial for the
 * authenticated user. Called by the Flutter Android app. Uses Bearer-token auth
 * (mobile) via `getSessionUserId()` from @/lib/auth-helper.
 *
 * Body: none required
 * Response: { success: true, trial_ends_at: "...", message: "..." }
 */
import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // --- Auth --------------------------------------------------------------
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح', error_en: 'Unauthorized' },
        { status: 401 }
      );
    }

    // --- Check for existing subscription -----------------------------------
    let existing: any = null;
    try {
      existing = await db.userSubscription.findUnique({
        where: { user_id: userId },
      });
    } catch (dbErr) {
      console.error('[POST /api/subscription/trial] Existing lookup error:', dbErr);
      return NextResponse.json(
        {
          success: false,
          error: 'خطأ في قاعدة البيانات',
          error_en: 'Database error while looking up existing subscription',
        },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'لديك اشتراك بالفعل',
          error_en: 'You already have a subscription',
        },
        { status: 400 }
      );
    }

    // --- Resolve the free plan (which carries trial_days) ------------------
    let freePlan: any = null;
    try {
      freePlan = await db.subscriptionPlan.findUnique({ where: { name: 'free' } });
    } catch (dbErr) {
      console.error('[POST /api/subscription/trial] Free plan lookup error:', dbErr);
    }

    if (!freePlan) {
      return NextResponse.json(
        {
          success: false,
          error: 'خطأ في العثور على الباقة المجانية',
          error_en: 'Free plan not configured',
        },
        { status: 500 }
      );
    }

    const now = new Date();
    const trialDays = freePlan.trial_days || 30;
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    // --- Create subscription with trial ------------------------------------
    let subscription: any = null;
    try {
      subscription = await db.userSubscription.create({
        data: {
          id: `sub_${userId}_${Date.now()}`,
          user_id: userId,
          plan_id: freePlan.id,
          status: 'active',
          started_at: now.toISOString(),
          trial_started_at: now.toISOString(),
          trial_ends_at: trialEndsAt.toISOString(),
        },
      });
    } catch (dbErr) {
      console.error('[POST /api/subscription/trial] Create subscription error:', dbErr);
      return NextResponse.json(
        {
          success: false,
          error: 'تعذر إنشاء الاشتراك التجريبي',
          error_en: 'Failed to create trial subscription',
        },
        { status: 500 }
      );
    }

    // --- Mirror trial info onto User row (used by /current) ---------------
    try {
      await db.user.update({
        where: { id: userId },
        data: {
          trial_ends_at: trialEndsAt,
          subscription_tier: 'free',
        },
      });
    } catch (dbErr) {
      console.warn('[POST /api/subscription/trial] User update warning:', dbErr);
      // Non-fatal
    }

    // --- Response ----------------------------------------------------------
    return NextResponse.json({
      success: true,
      message: `تم تفعيل الفترة التجريبية لمدة ${trialDays} يوم`,
      message_en: `Free trial activated for ${trialDays} days`,
      trial_ends_at: trialEndsAt.toISOString(),
      trial_days: trialDays,
      subscription: {
        id: subscription.id,
        plan_id: freePlan.id,
        plan_name: freePlan.name,
        plan_name_ar: freePlan.name_ar,
        status: 'active',
        trial_started_at: subscription.trial_started_at,
        trial_ends_at: subscription.trial_ends_at,
      },
    });
  } catch (error) {
    console.error('[POST /api/subscription/trial] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء تفعيل الفترة التجريبية',
        error_en: 'Failed to start free trial',
      },
      { status: 500 }
    );
  }
}
