import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getSessionUserId } from '@/lib/auth-helper';

/**
 * POST /api/subscription/checkout
 *
 * body: { tier, market, billingCycle, referralCode? }
 *
 * 1. يقرأ MarketPricing من الـ DB (السعر بالجنيه لـ Paymob)
 * 2. ينشئ Paymob order
 * 3. يرجّع iframe URL للمستخدم
 *
 * المستخدم بيدفع price_egp دايماً (Paymob EGP only).
 */
export const dynamic = 'force-dynamic';

const PAYMOB_API_KEY = process.env.PAYMOB_API_KEY;
const PAYMOB_IFRAME_ID = process.env.PAYMOB_IFRAME_ID || '993228';
const CARD_INTEGRATION_ID = process.env.PAYMOB_CARD_INTEGRATION_ID || '5716783';

interface CheckoutBody {
  tier?: string;
  market?: string;
  billingCycle?: string;
  referralCode?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 },
      );
    }

    if (!PAYMOB_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'بوابة الدفع غير مُهيّأة (PAYMOB_API_KEY missing)' },
        { status: 503 },
      );
    }

    const body: CheckoutBody = await req.json().catch(() => ({}));
    const MARKET_ALIASES: Record<string, string> = {
      kuwait: 'kse',
      kw: 'kse',
      qatar: 'qse',
      qa: 'qse',
      saudi: 'tadawul',
      ksa: 'tadawul',
      egypt: 'egx',
      usa: 'us',
    };
    const rawMarket = String(body.market || 'egx').toLowerCase();
    const market = MARKET_ALIASES[rawMarket] || rawMarket;
    const rawTier = String(body.tier || '').toLowerCase();
    const TIER_ALIASES: Record<string, string> = {
      normal: 'pro',
      developer: 'b2b_starter',
    };
    const tier = TIER_ALIASES[rawTier] || rawTier;
    const billingCycle = String(body.billingCycle || 'monthly');

    // تحقق من الباقة
    const validTiers = ['premium', 'pro', 'vip_pass', 'b2b_starter', 'b2b_pro', 'b2b_enterprise'];
    if (!validTiers.includes(tier)) {
      return NextResponse.json(
        { success: false, error: `باقة غير صالحة: ${tier}. المتاح: ${validTiers.join(', ')}` },
        { status: 400 },
      );
    }

    // اقرأ السعر من الـ DB
    const pricing = await authDb.marketPricing.findUnique({
      where: {
        tier_market_billing_cycle: {
          tier,
          market,
          billing_cycle: billingCycle,
        },
      },
    });

    if (!pricing || !pricing.is_active) {
      // fallback: نحاول بالسوق 'all'
      const fallbackPricing = await authDb.marketPricing.findUnique({
        where: {
          tier_market_billing_cycle: {
            tier,
            market: 'all',
            billing_cycle: billingCycle,
          },
        },
      });
      if (!fallbackPricing || !fallbackPricing.is_active) {
        return NextResponse.json(
          { success: false, error: `مفيش تسعير متاح لـ ${tier}/${market}/${billingCycle}` },
          { status: 404 },
        );
      }
    }

    const finalPricing = pricing || (await authDb.marketPricing.findUnique({
      where: {
        tier_market_billing_cycle: {
          tier,
          market: 'all',
          billing_cycle: billingCycle,
        },
      },
    }))!;

    // السعر بالـ piastres (1 EGP = 100 piastres) مع fallback لأسعار العملات
    const exchangeRates: Record<string, number> = {
      EGP: 1,
      SAR: 13.2,
      KWD: 161.0,
      QAR: 13.5,
      USD: 49.0,
    };
    const rate = exchangeRates[finalPricing.currency] || 1;
    const priceEgp = (finalPricing.price_egp && finalPricing.price_egp > 0)
      ? finalPricing.price_egp
      : Math.round(finalPricing.price_local * rate);
    const amountCents = Math.max(100, Math.round(priceEgp * 100));

    // 1. Auth request → get auth token
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: PAYMOB_API_KEY }),
    });
    if (!authRes.ok) {
      const errBody = await authRes.text();
      console.error('[subscription/checkout] Paymob auth failed:', authRes.status, errBody);
      return NextResponse.json(
        { success: false, error: 'فشل الاتصال ببوابة الدفع (auth)' },
        { status: 502 },
      );
    }
    const authData = await authRes.json();
    const authToken = authData.token;

    // 2. Order registration
    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, username: true },
    });

    const merchantOrderId = `m2y-${tier}-${billingCycle}-${userId.slice(-8)}-${Date.now()}`;
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        delivery_needed: 'false',
        amount_cents: amountCents,
        currency: 'EGP',
        merchant_order_id: merchantOrderId,
        items: [],
      }),
    });
    if (!orderRes.ok) {
      const errBody = await orderRes.text();
      console.error('[subscription/checkout] Paymob order failed:', orderRes.status, errBody);
      return NextResponse.json(
        { success: false, error: 'فشل إنشاء طلب الدفع' },
        { status: 502 },
      );
    }
    const orderData = await orderRes.json();
    const paymobOrderId = orderData.id;

    // 3. Payment key request
    const billingData = {
      email: user?.email || 'customer@m2y.net',
      first_name: (user?.name || user?.username || 'Customer').slice(0, 30),
      last_name: 'M2Y',
      phone_number: '01000000000', // Paymob requires it
      apartment: 'NA',
      floor: 'NA',
      street: 'NA',
      building: 'NA',
      shipping_method: 'NA',
      postal_code: 'NA',
      city: 'Cairo',
      country: 'EG',
      state: 'Cairo',
    };

    const paymentKeyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: paymobOrderId,
        billing_data: billingData,
        currency: 'EGP',
        integration_id: Number(CARD_INTEGRATION_ID),
        lock_order_when_paid: 'true',
      }),
    });
    if (!paymentKeyRes.ok) {
      const errBody = await paymentKeyRes.text();
      console.error('[subscription/checkout] Paymob payment key failed:', paymentKeyRes.status, errBody);
      return NextResponse.json(
        { success: false, error: 'فشل توليد مفتاح الدفع' },
        { status: 502 },
      );
    }
    const paymentKeyData = await paymentKeyRes.json();
    const paymentToken = paymentKeyData.token;

    // 4. iframe URL
    const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${PAYMOB_IFRAME_ID}?payment_token=${paymentToken}`;

    // سجّل محاولة الـ checkout للتحليل
    console.log(`[subscription/checkout] user=${userId} tier=${tier} market=${market} billingCycle=${billingCycle} amount=${amountCents}c order=${paymobOrderId}`);

    return NextResponse.json({
      success: true,
      iframeUrl,
      paymobOrderId: String(paymobOrderId),
      amountEgp: finalPricing.price_egp,
      amountCents,
      currency: 'EGP',
      tier,
      market,
      billingCycle,
      merchantOrderId,
    });
  } catch (err: any) {
    console.error('[subscription/checkout] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل بدء عملية الدفع' },
      { status: 500 },
    );
  }
}
