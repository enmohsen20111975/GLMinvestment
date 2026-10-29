import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

// P0-11-AUTH fix (2026-09-27): added user auth guard — was using
// getServerSession directly (web-only, no mobile Bearer support). Now
// uses requireAuthAsync (which checks both NextAuth session AND Bearer
// token via getSessionUserId). Pre-existing getServerSession kept for
// the subscription-tier lookup that depends on session.user fields.
import { requireAuthAsync } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

// P0.2 (SEC-03): the API key MUST come from process.env.PAYMOB_API_KEY.
// No hardcoded fallback — fail closed if unset. Same hardening pattern as the
// HMAC secret in /api/paymob/callback.
// (Public, non-secret IDs below keep their fallbacks — they are visible in any
// Paymob iframe URL and exist purely for backward compatibility.)
const DEFAULT_PAYMOB_IFRAME_ID = '993228';
const DEFAULT_CARD_INTEGRATION_ID = 5716783;
const DEFAULT_WALLET_INTEGRATION_ID = 5716784;

// Plan prices in cents (Egyptian Piastres)
const PLAN_PRICES: Record<string, { monthly: number; yearly: number }> = {
  'premium': {
    monthly: parseInt(process.env.PAYMOB_PLAN_PREMIUM_MONTHLY_PRICE || '9900'), // 99 EGP
    yearly: parseInt(process.env.PAYMOB_PLAN_PREMIUM_YEARLY_PRICE || '99000'), // 990 EGP
  },
  'normal': {
    monthly: parseInt(process.env.PAYMOB_PLAN_NORMAL_MONTHLY_PRICE || '19900'), // 199 EGP
    yearly: parseInt(process.env.PAYMOB_PLAN_NORMAL_YEARLY_PRICE || '199000'), // 1990 EGP
  },
  'pro': {
    monthly: parseInt(process.env.PAYMOB_PLAN_PRO_MONTHLY_PRICE || '19900'), // 199 EGP
    yearly: parseInt(process.env.PAYMOB_PLAN_PRO_YEARLY_PRICE || '199000'), // 1990 EGP
  },
  'vip_pass': {
    monthly: 24900, // 249 EGP
    yearly: 249000, // 2490 EGP
  },
  'developer': {
    monthly: parseInt(process.env.PAYMOB_PLAN_DEVELOPER_MONTHLY_PRICE || '59900'), // 599 EGP
    yearly: parseInt(process.env.PAYMOB_PLAN_DEVELOPER_YEARLY_PRICE || '599000'), // 5990 EGP
  },
};

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
    throw new Error(`Failed to authenticate with Paymob: ${errorText}`);
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
          description: 'Premium subscription plan',
          quantity: 1,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Paymob Order Error]', response.status, errorText);
    throw new Error(`Failed to create Paymob order: ${errorText}`);
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
  const cleanPhone = (userData.phone && userData.phone.trim().length >= 8)
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
    throw new Error(`Failed to get payment key: ${errorText}`);
  }

  const data: PaymobPaymentKeyResponse = await response.json();
  return data.token;
}

/**
 * POST /api/paymob/create-payment
 * Create a Paymob payment session for card OR wallet payments.
 */
export async function POST(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard (money endpoint)
  const auth = await requireAuthAsync(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.id && !session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id || 'user';
    const body = await request.json();
    const { plan_id, billing_period = 'monthly', payment_method = 'card' } = body;

    if (!plan_id || !PLAN_PRICES[plan_id]) {
      return NextResponse.json(
        { success: false, error: 'الباقة غير صالحة' },
        { status: 400 }
      );
    }

    let user: any = null;
    try {
      if (userId && userId !== 'user') {
        user = await db.user.findUnique({ where: { id: userId } });
      }
    } catch (dbErr) {
      console.warn('[Paymob DB Lookup Warning]', dbErr);
    }

    const email = user?.email || session.user.email || 'user@invist.m2y.net';
    const nameParts = (user?.name || session.user.name || 'User Subscriber').trim().split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || 'Subscriber';
    const phone = user?.phone || '+201000000000';

    const rawMarket = String(body.market || 'egx').toLowerCase();
    let amountCents = PLAN_PRICES[plan_id]?.[billing_period as 'monthly' | 'yearly'] || 9900;
    if (rawMarket !== 'egx') {
      try {
        const mp = await db.marketPricing.findUnique({
          where: {
            tier_market_billing_cycle: {
              tier: plan_id,
              market: rawMarket,
              billing_cycle: billing_period,
            },
          },
        });
        if (mp && mp.price_egp && mp.price_egp > 0) {
          amountCents = Math.round(mp.price_egp * 100);
        }
      } catch (mpErr) {
        console.warn('[Paymob Market Pricing Lookup Warning]', mpErr);
      }
    }
    const merchantOrderId = `GLM-${userId}-${plan_id}-${Date.now()}`;

    // Step 1: Get auth token
    const authToken = await getPaymobAuthToken();

    // Step 2: Create order
    const orderId = await createPaymobOrder(authToken, amountCents, merchantOrderId);

    // Select the correct integration ID based on payment_method
    const cardIntegrationId = parseInt(process.env.PAYMOB_INTEGRATION_ID_CARD || '') || DEFAULT_CARD_INTEGRATION_ID;
    const walletIntegrationId = parseInt(process.env.PAYMOB_INTEGRATION_ID_WALLET || '') || DEFAULT_WALLET_INTEGRATION_ID;
    const integrationId = payment_method === 'wallet' ? walletIntegrationId : cardIntegrationId;

    // Step 3: Get payment key
    const paymentKey = await getPaymentKey(
      authToken,
      orderId,
      amountCents,
      { email, firstName, lastName, phone },
      integrationId
    );

    const iframeId = process.env.PAYMOB_IFRAME_ID || DEFAULT_PAYMOB_IFRAME_ID;
    const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentKey}`;
    const walletPayUrl = 'https://accept.paymob.com/api/acceptance/payments/pay';

    return NextResponse.json({
      success: true,
      payment_url: iframeUrl,
      payment_key: paymentKey,
      paymob_url: walletPayUrl,
      amount: amountCents,
      order_id: orderId,
      merchant_order_id: merchantOrderId,
    });
  } catch (error: any) {
    console.error('[POST /api/paymob/create-payment] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء إنشاء عملية الدفع' },
      { status: 500 }
    );
  }
}
