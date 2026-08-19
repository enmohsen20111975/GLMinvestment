import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

/**
 * POST /api/subscription/activate
 * Activates a subscription plan for the currently logged-in user after successful payment.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    const userId = session.user.id as string;
    const body = await request.json();
    const { plan, billing_period = 'monthly', payment_gateway = 'paymob' } = body;

    if (!plan || !['normal', 'premium', 'developer'].includes(plan)) {
      return NextResponse.json(
        { success: false, error: 'الباقة المطلوبة غير صالحة' },
        { status: 400 }
      );
    }

    // Update user subscription tier in DB
    const updatedUser = await db.user.update({
      where: { id: userId },
      data: {
        subscription_tier: plan,
      },
    });

    // Calculate expiration date (1 month or 1 year)
    const months = billing_period === 'yearly' ? 12 : 1;
    const expiresAt = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString();

    // Upsert UserSubscription record
    await db.userSubscription.upsert({
      where: { user_id: userId },
      update: {
        plan_id: plan,
        status: 'active',
        payment_method: payment_gateway,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      create: {
        id: `sub_${userId}_${Date.now()}`,
        user_id: userId,
        plan_id: plan,
        status: 'active',
        payment_method: payment_gateway,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'تم تفعيل الاشتراك بنجاح',
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          username: updatedUser.username,
          subscription_tier: updatedUser.subscription_tier,
          default_risk_tolerance: updatedUser.default_risk_tolerance,
          is_active: updatedUser.is_active,
        },
      },
    });
  } catch (error) {
    console.error('[POST /api/subscription/activate] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تفعيل الاشتراك' },
      { status: 500 }
    );
  }
}
