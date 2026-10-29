import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getSessionUserId } from '@/lib/auth-helper';
import { logger } from '@/lib/logger'; // Wave 1 P0 Fix 3 — Rule 58 (observability)

/**
 * POST /api/subscription/activate
 *
 * FIX-P1-SECURITY (CRIT-2): Paymob verification is now MANDATORY before any DB write.
 *
 * body: { tier, billingCycle, paymobOrderId, paymobTransactionId }
 *
 * Flow:
 * 1. Require `paymobOrderId` AND `paymobTransactionId` in body (else 403).
 * 2. Fetch the Paymob transaction via `/api/ecommerce/transactions/{id}` using
 *    PAYMOB_API_KEY env var (NO hardcoded fallback — fail closed if unset).
 * 3. Verify the transaction:
 *      - success === true
 *      - !is_voided && !is_refunded && !error_occured
 *      - order.merchant_order_id matches the user's session (parsed userId
 *        must equal the authenticated userId).
 *      - amount_cents matches the expected price (in piastres) from the
 *        MarketPricing table for {tier, market, billingCycle}.
 * 4. Only if all checks pass → write subscription_tier + UserSubscription.
 * 5. If B2B → generate API key.
 *
 * Activation also happens independently via /api/paymob/callback (HMAC-verified).
 * This endpoint exists as the second leg of defense-in-depth so the client can
 * poll status after the Paymob redirect without blindly trusting the URL.
 */
export const dynamic = 'force-dynamic';

const VALID_TIERS = ['premium', 'pro', 'b2b_starter', 'b2b_pro', 'b2b_enterprise'] as const;
type Tier = (typeof VALID_TIERS)[number];

interface PaymobTransaction {
  id?: number;
  success?: boolean;
  pending?: boolean;
  amount_cents?: number;
  currency?: string;
  order?:
    | { id?: number; merchant_order_id?: string }
    | string
    | null;
  is_refunded?: boolean;
  is_voided?: boolean;
  error_occured?: boolean;
}

/**
 * Fetch a Paymob auth token using the API key from process.env.
 * Throws if PAYMOB_API_KEY is unset (fail closed).
 */
async function getPaymobAuthToken(): Promise<string> {
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
    throw new Error(`Paymob auth failed: ${response.status}`);
  }
  const data = await response.json();
  return data.token as string;
}

/**
 * Query a Paymob transaction by id. Returns null on lookup failure.
 */
async function queryPaymobTransaction(transactionId: string): Promise<PaymobTransaction | null> {
  try {
    const token = await getPaymobAuthToken();
    const response = await fetch(
      `https://accept.paymob.com/api/ecommerce/transactions/${transactionId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      logger.warn('subscription-activate Paymob transaction query failed', { status: response.status });
      return null;
    }
    const data = await response.json();
    return data as PaymobTransaction;
  } catch (err) {
    logger.error('subscription-activate Paymob transaction query error', { err: String(err) });
    return null;
  }
}

/**
 * Parse the merchant_order_id to recover the userId + tier used at checkout.
 * Accepts either the legacy `GLM-{userId}-{planId}-{ts}` format (callback) or
 * the newer `m2y-{tier}-{userIdSuffix}-{ts}` format (checkout/route.ts).
 *
 * Returns { userId, tier } or null if unparseable / suffix doesn't match.
 */
function parseMerchantOrderId(
  merchantOrderId: string | undefined,
  expectedUserId: string,
  expectedTier: string,
): { userId: string; tier: string } | null {
  if (!merchantOrderId) return null;

  // Legacy callback format: GLM-{userId}-{planId}-{ts}
  if (merchantOrderId.startsWith('GLM-')) {
    const parts = merchantOrderId.split('-');
    if (parts.length < 3) return null;
    const userId = parts[1];
    const tier = parts[2];
    if (userId !== expectedUserId || tier !== expectedTier) return null;
    return { userId, tier };
  }

  // Checkout format: m2y-{tier}-{billingCycle}-{userIdSuffix}-{ts} OR legacy m2y-{tier}-{userIdSuffix}-{ts}
  if (merchantOrderId.startsWith('m2y-')) {
    const parts = merchantOrderId.split('-');
    let tier = '';
    let userIdSuffix = '';
    if (parts.length >= 5) {
      tier = parts[1];
      userIdSuffix = parts[3];
    } else if (parts.length >= 4) {
      tier = parts[1];
      userIdSuffix = parts[2];
    } else {
      return null;
    }
    if (tier !== expectedTier) return null;
    // userId suffix is the last 8 chars of the cuid — compare loosely.
    if (!expectedUserId.endsWith(userIdSuffix)) return null;
    return { userId: expectedUserId, tier };
  }

  return null;
}

/**
 * Look up the expected price (in EGP piastres) for a tier+market+billingCycle
 * from MarketPricing. Returns 0 if not found.
 */
async function getExpectedAmountCents(tier: string, market: string, billingCycle: string): Promise<number> {
  const pricing = await authDb.marketPricing.findUnique({
    where: {
      tier_market_billing_cycle: { tier, market, billing_cycle: billingCycle },
    },
  });
  if (pricing && pricing.is_active) {
    return Math.round(pricing.price_egp! * 100);
  }
  // Fallback to market='all'
  const fallback = await authDb.marketPricing.findUnique({
    where: {
      tier_market_billing_cycle: { tier, market: 'all', billing_cycle: billingCycle },
    },
  });
  if (fallback && fallback.is_active) {
    return Math.round(fallback.price_egp! * 100);
  }
  return 0;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const tier = String(body.tier || '').toLowerCase();
    const billingCycle = String(body.billingCycle || body.billing_period || 'monthly').toLowerCase();
    const market = String(body.market || 'egx').toLowerCase();
    const paymobOrderId = String(body.paymobOrderId || body.order_id || '');
    const paymobTransactionId = String(body.paymobTransactionId || body.transaction_id || '');

    // FIX-P1-SECURITY (CRIT-2): Reject any request that does not carry a
    // Paymob order id + transaction id. Without these we CANNOT verify the
    // payment actually happened — the previous behavior let any caller POST
    // `{tier:'premium'}` and get a paid tier for free.
    if (!paymobOrderId || !paymobTransactionId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'يرفض التفعيل بدون تحقق Paymob — يجب توفير paymobOrderId و paymobTransactionId',
          error_en:
            'Activation requires paymobOrderId + paymobTransactionId for Paymob verification',
        },
        { status: 403 },
      );
    }

    if (!VALID_TIERS.includes(tier as Tier)) {
      return NextResponse.json({ success: false, error: 'باقة غير صالحة' }, { status: 400 });
    }

    // ------------------------------------------------------------------
    // Paymob verification (CRIT-2 fix)
    // ------------------------------------------------------------------
    const transaction = await queryPaymobTransaction(paymobTransactionId);
    if (!transaction) {
      logger.warn('subscription-activate Paymob transaction not found', { userId, txId: paymobTransactionId });
      return NextResponse.json(
        { success: false, error: 'فشل التحقق من عملية الدفع — العملية غير موجودة في Paymob' },
        { status: 403 },
      );
    }

    // 1. transaction must be successful + not voided/refunded/errored
    const isSuccess =
      transaction.success === true &&
      !transaction.is_voided &&
      !transaction.is_refunded &&
      !transaction.error_occured;
    if (!isSuccess) {
      logger.warn('subscription-activate Paymob transaction not successful', {
        userId,
        txId: paymobTransactionId,
        success: transaction.success,
        voided: transaction.is_voided,
        refunded: transaction.is_refunded,
      });
      return NextResponse.json(
        { success: false, error: 'عملية الدفع غير ناجحة أو مُلغاة' },
        { status: 403 },
      );
    }

    // 2. merchant_order_id must reference this user + tier
    const merchantOrderId =
      transaction.order && typeof transaction.order === 'object'
        ? transaction.order.merchant_order_id
        : typeof transaction.order === 'string'
          ? transaction.order
          : undefined;

    const parsed = parseMerchantOrderId(merchantOrderId, userId, tier);
    if (!parsed) {
      logger.error('subscription-activate merchant_order_id mismatch', { userId, tier, merchantOrderId });
      return NextResponse.json(
        { success: false, error: 'عملية الدفع لا تنتمي لهذا المستخدم/الباقة' },
        { status: 403 },
      );
    }

    // 3. amount must match the expected price from MarketPricing (±1 piastre tolerance for float rounding)
    const expectedCents = await getExpectedAmountCents(tier, market, billingCycle);
    const actualCents = Number(transaction.amount_cents || 0);
    if (expectedCents <= 0) {
      logger.error('subscription-activate no MarketPricing row found', { tier, market, billingCycle });
      return NextResponse.json(
        { success: false, error: 'تعذر التحقق من السعر المتوقع للباقة' },
        { status: 500 },
      );
    }
    if (Math.abs(actualCents - expectedCents) > 1) {
      logger.error('subscription-activate amount mismatch', { userId, txId: paymobTransactionId, expectedCents, actualCents });
      return NextResponse.json(
        { success: false, error: 'المبلغ المدفوع لا يطابق السعر المتوقع' },
        { status: 403 },
      );
    }

    // ------------------------------------------------------------------
    // All verification passed — safe to activate
    // ------------------------------------------------------------------
    // حساب تاريخ انتهاء المدة
    const now = new Date();
    const periodEnd = new Date(now);
    if (billingCycle === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // 1. تحديث user.subscription_tier
    await authDb.user.update({
      where: { id: userId },
      data: {
        subscription_tier: tier,
        trial_ends_at: null, // مش trial بعد كده
      },
    });

    // 2. إنشاء/تحديث UserSubscription
    const existing = await authDb.userSubscription.findFirst({
      where: { user_id: userId, status: 'active' },
    });

    if (existing) {
      await authDb.userSubscription.update({
        where: { id: existing.id },
        data: {
          plan_id: tier,
          status: 'active',
          expires_at: periodEnd.toISOString(),
          payment_method: 'paymob',
        },
      });
    } else {
      await authDb.userSubscription.create({
        data: {
          id: `sub_${userId.slice(-12)}_${Date.now()}`,
          user_id: userId,
          plan_id: tier,
          status: 'active',
          expires_at: periodEnd.toISOString(),
          trial_started_at: null,
          trial_ends_at: null,
          payment_method: 'paymob',
        },
      });
    }

    // 3. لو B2B → توليد API key تلقائياً
    let apiKey: string | null = null;
    if (tier.startsWith('b2b_')) {
      const key = `sk_live_${require('crypto').randomBytes(24).toString('hex')}`;
      const monthlyLimit =
        tier === 'b2b_starter' ? 10000 :
        tier === 'b2b_pro' ? 100000 :
        999999999; // enterprise
      await authDb.b2bApiKey.create({
        data: {
          user_id: userId,
          key,
          monthly_limit: monthlyLimit,
        },
      });
      apiKey = key;
    }

    return NextResponse.json({
      success: true,
      tier,
      status: 'active',
      currentPeriodEndsAt: periodEnd,
      apiKey,
      paymobOrderId,
      paymobTransactionId,
      verified: true,
    });
  } catch (err: any) {
    logger.error('subscription-activate failed', { err: err?.message || String(err) });
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل تفعيل الاشتراك' },
      { status: 500 },
    );
  }
}
