/**
 * دليل الاستثمار — POST /api/subscription/upgrade
 *
 * NEW FLOW: Generates a JWT payment token → redirects user to m2y.net/checkout
 * m2y.net handles all Paymob / Instapay interactions centrally.
 * Payment result callbacks update both m2y.net and دليل الاستثمار DBs.
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';
import { generatePaymentToken } from '@/lib/payment';

const MAIN_DOMAIN = process.env.M2Y_API_URL || process.env.MAIN_DOMAIN || 'https://m2y.net';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    const userId = session.user.id as string;
    const body   = await request.json();
    const { plan_id, billing_period = 'monthly', payment_type = 'card' } = body;

    if (!plan_id) {
      return NextResponse.json(
        { success: false, error: 'يرجى اختيار باقة' },
        { status: 400 }
      );
    }

    const plan = await db.subscriptionPlan.findUnique({ where: { id: plan_id } });
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

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    const amount = billing_period === 'yearly' ? plan.price_yearly : plan.price;

    // Generate JWT payment token for m2y.net central gateway
    const token = generatePaymentToken({
      plan: plan_id,
      user_id: userId,
      payment_type: payment_type || 'card',
      amount,
      billing_period,
    });

    // Redirect to m2y.net checkout — all payment logic is now centralised there
    const checkoutUrl = `${MAIN_DOMAIN}/checkout?token=${encodeURIComponent(token)}`;
    return NextResponse.json({
      success: true,
      redirect_url: checkoutUrl,
      checkout_url: checkoutUrl,
      token: token,  // kept for backward compat; client should use redirect_url
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
