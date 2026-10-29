import { NextResponse, NextRequest } from 'next/server';
export const dynamic = "force-dynamic";

// P0-11-AUTH fix (2026-09-27): added user auth guard — was using
// getServerSession directly (web-only, no mobile Bearer support). Now
// also requires requireAuthAsync. Pre-existing getServerSession kept for
// subscription-tier / payment-token fields.
import { requireAuthAsync } from '@/lib/admin-guard';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

/**
 * POST /api/subscription/start-trial
 * Start free trial for logged-in user (requires auth)
 */
export async function POST(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard
  const auth = await requireAuthAsync(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.id) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id as string;

    // Check if user already has a subscription
    const existing = await db.userSubscription.findUnique({
      where: { user_id: userId },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'لديك اشتراك بالفعل' },
        { status: 400 }
      );
    }

    // Get the free plan (which has trial_days)
    const freePlan = await db.subscriptionPlan.findUnique({
      where: { name: 'free' },
    });

    if (!freePlan) {
      return NextResponse.json(
        { success: false, error: 'خطأ في العثور على الباقة المجانية' },
        { status: 500 }
      );
    }

    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + freePlan.trial_days);

    // Create subscription with trial
    const subscription = await db.userSubscription.create({
      data: {
        user_id: userId,
        plan_id: freePlan.id,
        status: 'active',
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: `تم تفعيل الفترة التجريبية لمدة ${freePlan.trial_days} يوم`,
      subscription: {
        id: subscription.id,
        trial_ends_at: subscription.trial_ends_at,
        plan_name_ar: freePlan.name_ar,
      },
    });
  } catch (error) {
    console.error('[POST /api/subscription/start-trial] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تفعيل الفترة التجريبية' },
      { status: 500 }
    );
  }
}
