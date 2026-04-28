import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

/**
 * POST /api/subscription/upgrade
 * Upgrade plan (requires auth, placeholder for payment)
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
    const { plan_id, billing_period = 'monthly' } = body;

    if (!plan_id) {
      return NextResponse.json(
        { success: false, error: 'يرجى اختيار باقة' },
        { status: 400 }
      );
    }

    // Validate plan exists
    const plan = await db.subscriptionPlan.findUnique({
      where: { id: plan_id },
    });

    if (!plan || !plan.is_active) {
      return NextResponse.json(
        { success: false, error: 'الباقة غير موجودة أو غير متاحة' },
        { status: 400 }
      );
    }

    if (plan.price === 0) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن الترقية للباقة المجانية. استخدم بدء الفترة التجريبية.' },
        { status: 400 }
      );
    }

    // Payment placeholder — in production, integrate Fawry/Vodafone Cash here
    // For now, we record the intent and return a "coming soon" response
    return NextResponse.json({
      success: false,
      error: 'قريباً',
      message: 'نظام الدفع الإلكتروني قيد التطوير. سيتم تفعيل الدفع عبر فوري وفودافون كاش قريباً.',
      plan_info: {
        plan_name: plan.name,
        plan_name_ar: plan.name_ar,
        price: billing_period === 'yearly' ? plan.price_yearly : plan.price,
        billing_period,
      },
    });
  } catch (error) {
    console.error('[POST /api/subscription/upgrade] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء معالجة الترقية' },
      { status: 500 }
    );
  }
}
