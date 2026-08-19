/**
 * دليل الاستثمار — POST /api/subscription/checkout
 *
 * Initiates a Paymob checkout session for the authenticated user.
 * Called by the Flutter Android app. Uses Bearer-token auth (mobile) via
 * `getSessionUserId()` from @/lib/auth-helper.
 *
 * Body: { plan_id: string, payment_method?: 'card'|'wallet', billing_period?: 'monthly'|'yearly' }
 * Response: { success: true, payment_url: "...", iframe_url: "...", order_id: "..." }
 *
 * Paymob flow (3 steps):
 *   1. POST /api/auth/tokens             → auth_token
 *   2. POST /api/ecommerce/orders        → paymob_order_id
 *   3. POST /api/acceptance/payment_keys → payment_key (used to build iframe URL)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// P0.2 (SEC-03): the API key MUST come from process.env.PAYMOB_API_KEY.
// No hardcoded fallback — fail closed if unset. Same hardening pattern as the
// HMAC secret in /api/paymob/callback.
// (Public, non-secret IDs below keep their fallbacks — they are visible in any
// Paymob iframe URL and exist purely for backward compatibility.)

const DEFAULT_PAYMOB_IFRAME_ID = '993228';
const DEFAULT_CARD_INTEGRATION_ID = 5716783;
const DEFAULT_WALLET_INTEGRATION_ID = 5716784;

interface PaymobAuthResponse {
  token: string;
}
interface PaymobOrderResponse {
  id: number;
}
interface PaymobPaymentKeyResponse {
  token: string;
}

async function getPaymobAuthToken(): Promise<string> {
  // P0.2 (SEC-03): read API key from env ONLY. No hardcoded fallback.
  const apiKey = process.env.PAYMOB_API_KEY;
  if (!apiKey) {
    throw new Error('PAYMOB_API_KEY env var not configured');
  }
  const response = await fetch('https://accept.paymob.com/api/auth/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Paymob Auth Error]', response.status, errorText);
    throw new Error(`Paymob auth failed: ${errorText}`);
  }
  const data: PaymobAuthResponse = await response.json();
  return data.token;
}

async function createPaymobOrder(
  authToken: string,
  amountCents: number,
  merchantOrderId: string
): Promise<number> {
  const response = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: amountCents,
      merchant_order_id: merchantOrderId,
      items: [
        {
          name: 'GLM Investment Subscription',
          amount_cents: amountCents,
          description: 'Subscription plan',
          quantity: 1,
        },
      ],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Paymob Order Error]', response.status, errorText);
    throw new Error(`Paymob order creation failed: ${errorText}`);
  }
  const data: PaymobOrderResponse = await response.json();
  return data.id;
}

async function getPaymentKey(
  authToken: string,
  orderId: number,
  amountCents: number,
  userData: { email: string; firstName: string; lastName: string; phone: string },
  integrationId: number
): Promise<string> {
  const cleanPhone =
    userData.phone && userData.phone.trim().length >= 8
      ? userData.phone.trim()
      : '+201000000000';

  const response = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: orderId,
      billing_data: {
        first_name: userData.firstName || 'User',
        last_name: userData.lastName || 'Subscriber',
        email: userData.email || 'user@invist.m2y.net',
        phone_number: cleanPhone,
        country: 'EG',
        city: 'Cairo',
        street: 'NA',
        building: 'NA',
        floor: 'NA',
        apartment: 'NA',
      },
      currency: 'EGP',
      integration_id: integrationId,
      lock_order_when_paid: true,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Paymob Payment Key Error]', response.status, errorText);
    throw new Error(`Paymob payment key failed: ${errorText}`);
  }
  const data: PaymobPaymentKeyResponse = await response.json();
  return data.token;
}

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
    } catch {
      // empty body
    }
    const { plan_id, payment_method = 'card', billing_period = 'monthly' } = body;

    if (!plan_id) {
      return NextResponse.json(
        { success: false, error: 'يرجى اختيار باقة', error_en: 'plan_id is required' },
        { status: 400 }
      );
    }

    if (payment_method && !['card', 'wallet'].includes(payment_method)) {
      return NextResponse.json(
        {
          success: false,
          error: 'طريقة الدفع غير صالحة',
          error_en: 'payment_method must be "card" or "wallet"',
        },
        { status: 400 }
      );
    }

    // --- Plan lookup (DB first, fallback to env-configured price table) ----
    let plan: any = null;
    try {
      plan = await db.subscriptionPlan.findUnique({ where: { id: plan_id } });
    } catch (dbErr) {
      console.warn('[POST /api/subscription/checkout] Plan lookup error:', dbErr);
    }

    // Resolve amount (in piastres/cents). DB price takes precedence; otherwise
    // fall back to the env-configured price table used by /api/paymob/create-payment.
    const PLAN_PRICES: Record<string, { monthly: number; yearly: number }> = {
      normal: {
        monthly: parseInt(process.env.PAYMOB_PLAN_NORMAL_MONTHLY_PRICE || '19900'),
        yearly: parseInt(process.env.PAYMOB_PLAN_NORMAL_YEARLY_PRICE || '199000'),
      },
      premium: {
        monthly: parseInt(process.env.PAYMOB_PLAN_PREMIUM_MONTHLY_PRICE || '29900'),
        yearly: parseInt(process.env.PAYMOB_PLAN_PREMIUM_YEARLY_PRICE || '299000'),
      },
      developer: {
        monthly: parseInt(process.env.PAYMOB_PLAN_DEVELOPER_MONTHLY_PRICE || '49900'),
        yearly: parseInt(process.env.PAYMOB_PLAN_DEVELOPER_YEARLY_PRICE || '499000'),
      },
    };

    let amountCents: number;
    if (plan) {
      const price = billing_period === 'yearly' ? (plan.price_yearly ?? plan.price) : plan.price;
      amountCents = Math.round(price * 100);
    } else if (PLAN_PRICES[plan_id]) {
      amountCents = PLAN_PRICES[plan_id][billing_period as 'monthly' | 'yearly'];
    } else {
      return NextResponse.json(
        { success: false, error: 'الباقة غير موجودة', error_en: 'Plan not found' },
        { status: 400 }
      );
    }

    if (!amountCents || amountCents <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'سعر الباقة غير صالح',
          error_en: 'Invalid plan price',
        },
        { status: 400 }
      );
    }

    // --- User lookup (for billing_data) -----------------------------------
    let user: any = null;
    try {
      user = await db.user.findUnique({ where: { id: userId } });
    } catch (dbErr) {
      console.warn('[POST /api/subscription/checkout] User lookup warning:', dbErr);
    }

    const email = user?.email || 'user@invist.m2y.net';
    const nameParts = (user?.name || 'User Subscriber').trim().split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || 'Subscriber';
    const phone = (user as any)?.phone || '+201000000000';

    // --- Paymob 3-step flow ------------------------------------------------
    const merchantOrderId = `GLM-${userId}-${plan_id}-${Date.now()}`;

    const authToken = await getPaymobAuthToken();
    const paymobOrderId = await createPaymobOrder(authToken, amountCents, merchantOrderId);

    const cardIntegrationId =
      parseInt(process.env.PAYMOB_INTEGRATION_ID_CARD || '') || DEFAULT_CARD_INTEGRATION_ID;
    const walletIntegrationId =
      parseInt(process.env.PAYMOB_INTEGRATION_ID_WALLET || '') || DEFAULT_WALLET_INTEGRATION_ID;
    const integrationId = payment_method === 'wallet' ? walletIntegrationId : cardIntegrationId;

    const paymentKey = await getPaymentKey(
      authToken,
      paymobOrderId,
      amountCents,
      { email, firstName, lastName, phone },
      integrationId
    );

    const iframeId = process.env.PAYMOB_IFRAME_ID || DEFAULT_PAYMOB_IFRAME_ID;
    const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentKey}`;
    const walletPayUrl = `https://accept.paymob.com/api/acceptance/payments/pay`;

    const paymentUrl = payment_method === 'wallet' ? walletPayUrl : iframeUrl;

    // --- Persist a 'pending' subscription so /verify can activate it ------
    try {
      const expiresAt = new Date(
        Date.now() + (billing_period === 'yearly' ? 12 : 1) * 30 * 24 * 60 * 60 * 1000
      ).toISOString();
      await db.userSubscription.upsert({
        where: { user_id: userId },
        update: {
          plan_id: plan?.id || plan_id,
          status: 'pending',
          payment_method: payment_method === 'wallet' ? 'paymob_wallet' : 'paymob',
          updated_at: new Date().toISOString(),
        },
        create: {
          id: `sub_${userId}_${Date.now()}`,
          user_id: userId,
          plan_id: plan?.id || plan_id,
          status: 'pending',
          payment_method: payment_method === 'wallet' ? 'paymob_wallet' : 'paymob',
          started_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
      });
    } catch (dbErr) {
      console.warn('[POST /api/subscription/checkout] Upsert pending subscription:', dbErr);
      // Non-fatal — the iframe URL is still valid
    }

    // --- Response ----------------------------------------------------------
    return NextResponse.json({
      success: true,
      payment_url: paymentUrl,
      iframe_url: iframeUrl,
      wallet_url: walletPayUrl,
      payment_key: paymentKey,
      order_id: String(paymobOrderId),
      merchant_order_id: merchantOrderId,
      amount: amountCents,
      currency: 'EGP',
      payment_method,
      plan_id,
      billing_period,
    });
  } catch (error: any) {
    console.error('[POST /api/subscription/checkout] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء إنشاء عملية الدفع',
        error_en: error?.message || 'Failed to create checkout session',
      },
      { status: 500 }
    );
  }
}
