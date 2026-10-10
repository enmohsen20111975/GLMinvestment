/**
 * دليل الاستثمار — POST /api/subscription/subscribe
 *
 * Alias for POST /api/subscription/upgrade — subscribes the user to a paid plan.
 * Called by the Flutter Android app. Uses Bearer-token auth (mobile) via
 * `getSessionUserId()` from @/lib/auth-helper.
 *
 * Body: { plan_id: string, billing_period?: 'monthly'|'yearly', payment_type?: 'card'|'wallet' }
 * Response: { success: true, subscription: {...}, message: "..." }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';
import { generatePaymentToken } from '@/lib/payment';

export const dynamic = 'force-dynamic';

const MAIN_DOMAIN = process.env.M2Y_API_URL || process.env.MAIN_DOMAIN || 'https://m2y.net';

export async function POST(request: NextRequest) {
  try {
    // --- Auth --------------------------------------------------------------
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح', error_en: 'Unauthorized' },
        { status: 401 }
      );
    }

    // --- Body --------------------------------------------------------------
    let body: any = {};
    try {
      body = await request.json();
    } catch { // silent fallback (safe-by-design)
      // Empty body — fall through to plan_id check below
    }
    const { plan_id, billing_period = 'monthly', payment_type = 'card' } = body;

    if (!plan_id) {
      return NextResponse.json(
        { success: false, error: 'يرجى اختيار باقة', error_en: 'plan_id is required' },
        { status: 400 }
      );
    }

    // --- Plan lookup -------------------------------------------------------
    let plan: any = null;
    try {
      plan = await db.subscriptionPlan.findUnique({ where: { id: plan_id } });
    } catch (dbErr) {
      console.error('[POST /api/subscription/subscribe] Plan lookup error:', dbErr);
      return NextResponse.json(
        {
          success: false,
          error: 'خطأ في قاعدة البيانات',
          error_en: 'Database error while looking up plan',
        },
        { status: 500 }
      );
    }

    if (!plan || !plan.is_active) {
      return NextResponse.json(
        { success: false, error: 'الباقة غير موجودة أو غير متاحة', error_en: 'Plan not found or inactive' },
        { status: 400 }
      );
    }

    if (plan.price === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'لا يمكن الاشتراك في الباقة المجانية. استخدم بدء الفترة التجريبية.',
          error_en: 'Cannot subscribe to the free plan. Use the trial endpoint instead.',
        },
        { status: 400 }
      );
    }

    // --- User lookup -------------------------------------------------------
    let user: any = null;
    try {
      user = await db.user.findUnique({ where: { id: userId } });
    } catch (dbErr) {
      console.error('[POST /api/subscription/subscribe] User lookup error:', dbErr);
    }
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود', error_en: 'User not found' },
        { status: 404 }
      );
    }

    // --- Build subscription record (mirrors /upgrade + /activate) ---------
    const amount = billing_period === 'yearly' ? (plan.price_yearly ?? plan.price) : plan.price;

    // Generate a JWT payment token for the m2y.net central checkout gateway
    let token: string;
    try {
      token = generatePaymentToken({
        plan: plan_id,
        user_id: userId,
        payment_type: payment_type || 'card',
        amount,
        billing_period,
      });
    } catch (tokenErr) {
      console.error('[POST /api/subscription/subscribe] generatePaymentToken error:', tokenErr);
      // Fall back to a no-token response — client may still proceed via /checkout
      token = '';
    }

    const checkoutUrl = token
      ? `${MAIN_DOMAIN}/checkout?token=${encodeURIComponent(token)}`
      : null;

    // --- Persist subscription record as 'pending' -------------------------
    const expiresAt = new Date(
      Date.now() + (billing_period === 'yearly' ? 12 : 1) * 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    let subscriptionRecord: any = null;
    try {
      subscriptionRecord = await db.userSubscription.upsert({
        where: { user_id: userId },
        update: {
          plan_id: plan.id,
          status: 'pending',
          payment_method: payment_type || 'card',
          updated_at: new Date().toISOString(),
        },
        create: {
          id: `sub_${userId}_${Date.now()}`,
          user_id: userId,
          plan_id: plan.id,
          status: 'pending',
          payment_method: payment_type || 'card',
          started_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        include: { plan: true },
      });
    } catch (dbErr) {
      console.error('[POST /api/subscription/subscribe] Upsert subscription error:', dbErr);
      // Non-fatal — we still return success so the client can proceed to checkout
    }

    // --- Response ----------------------------------------------------------
    return NextResponse.json({
      success: true,
      message: 'تم إنشاء طلب الاشتراك بنجاح. يرجى إتمام عملية الدفع.',
      message_en: 'Subscription request created. Please complete payment.',
      subscription: {
        id: subscriptionRecord?.id || `sub_${userId}_${Date.now()}`,
        user_id: userId,
        plan_id: plan.id,
        plan_name: plan.name,
        plan_name_ar: plan.name_ar,
        status: subscriptionRecord?.status || 'pending',
        billing_period,
        amount,
        currency: 'EGP',
        started_at: subscriptionRecord?.started_at || new Date().toISOString(),
        expires_at: subscriptionRecord?.expires_at || expiresAt,
      },
      checkout_url: checkoutUrl,
      redirect_url: checkoutUrl,
      token,
      plan_info: {
        plan_name: plan.name,
        plan_name_ar: plan.name_ar,
        price: amount,
        billing_period,
      },
    });
  } catch (error) {
    console.error('[POST /api/subscription/subscribe] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء معالجة الاشتراك',
        error_en: 'Failed to process subscription',
      },
      { status: 500 }
    );
  }
}
