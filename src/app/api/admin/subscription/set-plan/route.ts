import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-auth';
import { db } from '@/lib/db';

/**
 * POST /api/admin/subscription/set-plan
 * Admin sets user's plan (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin access via custom header or cookie
    const authError = requireAdminRequest(request);
    if (authError) return authError;

    const body = await request.json();
    const { user_id, plan_name, activate = true } = body;

    if (!user_id || !plan_name) {
      return NextResponse.json(
        { success: false, error: 'يرجى تحديد المستخدم والباقة' },
        { status: 400 }
      );
    }

    // Validate plan
    const plan = await db.subscriptionPlan.findUnique({
      where: { name: plan_name },
    });

    if (!plan) {
      return NextResponse.json(
        { success: false, error: 'الباقة غير موجودة' },
        { status: 400 }
      );
    }

    // Validate user
    const user = await db.user.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    // Upsert subscription
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const subscription = await db.userSubscription.upsert({
      where: { user_id },
      update: {
        plan_id: plan.id,
        status: activate ? 'active' : 'cancelled',
        expires_at: expiresAt,
        auto_renew: false,
        payment_method: 'admin_assigned',
      },
      create: {
        user_id,
        plan_id: plan.id,
        status: 'active',
        expires_at: expiresAt,
        auto_renew: false,
        payment_method: 'admin_assigned',
      },
    });

    // Update user's subscription_tier field too
    await db.user.update({
      where: { id: user_id },
      data: {
        subscription_tier: plan_name,
        is_active: activate,
      },
    });

    return NextResponse.json({
      success: true,
      message: `تم تحديث اشتراك المستخدم إلى ${plan.name_ar}`,
      subscription: {
        id: subscription.id,
        plan_name: plan.name,
        plan_name_ar: plan.name_ar,
        status: subscription.status,
        expires_at: subscription.expires_at,
      },
    });
  } catch (error) {
    console.error('[POST /api/admin/subscription/set-plan] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحديث الاشتراك' },
      { status: 500 }
    );
  }
}
