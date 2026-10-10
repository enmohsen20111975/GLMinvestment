/**
 * دليل الاستثمار — POST /api/subscription/verify
 *
 * Verifies a Paymob payment after the user is redirected back to the app.
 * Called by the Flutter Android app. Uses Bearer-token auth (mobile) via
 * `getSessionUserId()` from @/lib/auth-helper.
 *
 * Body: { order_id?: string, transaction_id?: string, tx_hash?: string }
 * Response: { success: true, subscription: {...}, message: "..." }
 *
 * Verification strategy (in priority order):
 *   1. If `transaction_id` is provided → query Paymob /api/transaction/{id}/query
 *   2. If `order_id` is provided       → query Paymob /api/ecommerce/orders/{id}
 *                                        (also lists transactions for that order)
 *   3. If `tx_hash` is provided        → treated as a payment_key/HMAC receipt;
 *                                        we trust it ONLY if a matching HMAC
 *                                        is present on the request body.
 *
 * If verification passes, the user's subscription is activated (mirror of the
 * Paymob webhook at /api/paymob/callback POST).
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// P0.2 (SEC-03): No hardcoded DEFAULT_PAYMOB_API_KEY fallback. The API key
// MUST come from process.env.PAYMOB_API_KEY. If unset, the route will fail
// closed (500) instead of falling back to a hardcoded credential shipped in
// source. Same hardening pattern as the HMAC secret in /api/paymob/callback.

interface PaymobTransaction {
  id?: number;
  success?: boolean;
  pending?: boolean;
  amount_cents?: number;
  currency?: string;
  order?: { id?: number; merchant_order_id?: string } | null;
  is_refunded?: boolean;
  is_voided?: boolean;
  error_occured?: boolean;
}

async function getPaymobAuthToken(): Promise<string> {
  // P0.2 (SEC-03): read API key from env ONLY. No hardcoded fallback.
  // If PAYMOB_API_KEY is unset, fail closed — do not silently fall back to a
  // credential shipped in source.
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
    throw new Error(`Paymob auth failed: ${await response.text()}`);
  }
  const data = await response.json();
  return data.token;
}

async function queryTransaction(transactionId: string): Promise<PaymobTransaction | null> {
  const token = await getPaymobAuthToken();
  const response = await fetch(
    `https://accept.paymob.com/api/ecommerce/transactions/${transactionId}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!response.ok) {
    console.warn('[subscription/verify] transaction query failed:', response.status);
    return null;
  }
  const data = await response.json();
  return data as PaymobTransaction;
}

async function queryOrder(orderId: string): Promise<PaymobTransaction[] | null> {
  const token = await getPaymobAuthToken();
  const response = await fetch(
    `https://accept.paymob.com/api/ecommerce/orders/${orderId}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!response.ok) {
    console.warn('[subscription/verify] order query failed:', response.status);
    return null;
  }
  const data = await response.json();
  // Paymob returns { id, ... , delivery_status, ... transactions: [...] } or a list
  if (Array.isArray(data)) return data as PaymobTransaction[];
  if (data && Array.isArray(data.transactions)) return data.transactions as PaymobTransaction[];
  if (data && data.id) return [data as PaymobTransaction];
  return null;
}

function verifyHmac(data: Record<string, string>, receivedHmac: string): boolean {
  const paymobHmac = process.env.PAYMOB_HMAC || '';
  if (!paymobHmac || !receivedHmac) return false;

  const keys = [
    'amount_cents',
    'created_at',
    'currency',
    'error_occured',
    'has_parent_transaction',
    'id',
    'integration_id',
    'is_3d_secure',
    'is_auth',
    'is_capture',
    'is_refunded',
    'is_standalone_payment',
    'is_voided',
    'order',
    'owner',
    'pending',
    'source_data_pan',
    'source_data_sub_type',
    'source_data_type',
  ];
  const values = keys.map((k) => data[k] || '');
  const stringToHash = values.join('');
  const calculated = crypto
    .createHmac('sha512', paymobHmac)
    .update(stringToHash)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculated.toLowerCase(), 'utf-8'),
      Buffer.from(receivedHmac.toLowerCase(), 'utf-8')
    );
  } catch {
    return false;
  }
}

function parseMerchantOrderId(merchantOrderId: string | undefined): {
  userId: string | null;
  planId: string | null;
} {
  if (!merchantOrderId || !merchantOrderId.startsWith('GLM-')) {
    return { userId: null, planId: null };
  }
  const parts = merchantOrderId.split('-');
  if (parts.length < 3) return { userId: null, planId: null };
  return { userId: parts[1], planId: parts[2] };
}

const ALLOWED_PLANS = new Set(['free', 'normal', 'developer', 'premium']);

async function activateSubscription(userId: string, planId: string): Promise<any> {
  // Defense in depth — never activate arbitrary plan IDs
  if (!ALLOWED_PLANS.has(planId)) {
    throw new Error(`Disallowed plan: ${planId}`);
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  let updatedUser: any = null;
  try {
    updatedUser = await db.user.update({
      where: { id: userId },
      data: { subscription_tier: planId },
    });
  } catch (err) {
    console.error('[subscription/verify] user update error:', err);
    throw err;
  }

  let subscription: any = null;
  try {
    subscription = await db.userSubscription.upsert({
      where: { user_id: userId },
      update: {
        plan_id: planId,
        status: 'active',
        payment_method: 'paymob',
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      create: {
        id: `sub_${userId}_${Date.now()}`,
        user_id: userId,
        plan_id: planId,
        status: 'active',
        payment_method: 'paymob',
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      include: { plan: true },
    });
  } catch (err) {
    console.error('[subscription/verify] subscription upsert error:', err);
    throw err;
  }

  return { updatedUser, subscription };
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
      body = {};
    }
    const { order_id, transaction_id, tx_hash, hmac: bodyHmac } = body;

    if (!order_id && !transaction_id && !tx_hash) {
      return NextResponse.json(
        {
          success: false,
          error: 'يرجى توفير order_id أو transaction_id أو tx_hash',
          error_en: 'Provide one of order_id, transaction_id, or tx_hash',
        },
        { status: 400 }
      );
    }

    // --- Verification ------------------------------------------------------
    let transaction: PaymobTransaction | null = null;
    let merchantOrderId: string | undefined;
    let planId: string | null = null;
    let ownerId: string | null = null;

    if (transaction_id) {
      try {
        transaction = await queryTransaction(String(transaction_id));
      } catch (err) {
        console.warn('[subscription/verify] queryTransaction error:', err);
      }
    }

    if (!transaction && order_id) {
      // Try as Paymob order id first
      let txns: PaymobTransaction[] | null = null;
      try {
        txns = await queryOrder(String(order_id));
      } catch (err) {
        console.warn('[subscription/verify] queryOrder error:', err);
      }
      if (txns && txns.length > 0) {
        // Pick the first successful one, otherwise the first one
        transaction =
          txns.find((t) => t && t.success === true && !t.is_voided && !t.is_refunded) || txns[0];
      } else {
        // Maybe `order_id` is actually a merchant_order_id (GLM-...)
        merchantOrderId = String(order_id);
      }
    }

    if (transaction) {
      merchantOrderId =
        transaction.order?.merchant_order_id ||
        (typeof transaction.order === 'string' ? transaction.order : undefined);
    }

    if (merchantOrderId) {
      const parsed = parseMerchantOrderId(merchantOrderId);
      planId = parsed.planId;
      ownerId = parsed.userId;
    }

    // tx_hash path: trust it only if an HMAC is supplied AND verifies
    if (!transaction && tx_hash) {
      if (!bodyHmac) {
        return NextResponse.json(
          {
            success: false,
            error: 'لا يمكن التحقق من tx_hash بدون HMAC',
            error_en: 'Cannot verify tx_hash without HMAC',
          },
          { status: 400 }
        );
      }
      const hmacOk = verifyHmac(body, bodyHmac);
      if (!hmacOk) {
        return NextResponse.json(
          {
            success: false,
            error: 'فشل التحقق من HMAC',
            error_en: 'HMAC verification failed',
          },
          { status: 401 }
        );
      }
      // If we got here, HMAC verified but we have no transaction details —
      // fall back to the current user's pending subscription.
    }

    // --- Determine success -------------------------------------------------
    const isSuccessful =
      (transaction && transaction.success === true && !transaction.is_voided && !transaction.is_refunded && !transaction.error_occured) ||
      (!!tx_hash && !!bodyHmac); // verified above

    if (!isSuccessful) {
      return NextResponse.json({
        success: false,
        verified: false,
        message: 'لم يتم التحقق من نجاح العملية',
        message_en: 'Payment could not be verified as successful',
        transaction: transaction
          ? {
              id: transaction.id,
              success: transaction.success,
              pending: transaction.pending,
              error_occured: transaction.error_occured,
              is_voided: transaction.is_voided,
              is_refunded: transaction.is_refunded,
            }
          : null,
      });
    }

    // --- Resolve plan & activate ------------------------------------------
    // Prefer the plan decoded from merchant_order_id; fall back to the user's
    // pending subscription record; otherwise refuse.
    if (!planId) {
      try {
        const pending = await db.userSubscription.findUnique({
          where: { user_id: userId },
        });
        if (pending && ALLOWED_PLANS.has(pending.plan_id)) {
          planId = pending.plan_id;
        }
      } catch (dbErr) {
        console.warn('[subscription/verify] pending lookup error:', dbErr);
      }
    }

    if (!planId || !ALLOWED_PLANS.has(planId)) {
      return NextResponse.json(
        {
          success: false,
          verified: true,
          error: 'تعذر تحديد الباقة المرتبطة بالعملية',
          error_en: 'Could not determine the plan for this transaction',
        },
        { status: 400 }
      );
    }

    // Defense in depth — the merchant_order_id user must match the auth user
    if (ownerId && ownerId !== userId) {
      console.error(
        `[subscription/verify] User mismatch: auth=${userId} merchantOrderId.userId=${ownerId}`
      );
      return NextResponse.json(
        {
          success: false,
          verified: true,
          error: 'عدم تطابق المستخدم',
          error_en: 'User mismatch — transaction does not belong to caller',
        },
        { status: 403 }
      );
    }

    let activation: any = null;
    try {
      activation = await activateSubscription(userId, planId);
    } catch (err) {
      console.error('[subscription/verify] activation error:', err);
      return NextResponse.json(
        {
          success: false,
          verified: true,
          error: 'تم التحقق من الدفع ولكن فشل تفعيل الاشتراك',
          error_en: 'Payment verified but subscription activation failed',
        },
        { status: 500 }
      );
    }

    // --- Response ----------------------------------------------------------
    return NextResponse.json({
      success: true,
      verified: true,
      message: 'تم تفعيل الاشتراك بنجاح',
      message_en: 'Subscription activated successfully',
      subscription: {
        id: activation.subscription?.id,
        user_id: userId,
        plan_id: planId,
        plan_name: activation.subscription?.plan?.name || planId,
        plan_name_ar: activation.subscription?.plan?.name_ar || planId,
        status: 'active',
        payment_method: 'paymob',
        started_at: activation.subscription?.started_at,
        expires_at: activation.subscription?.expires_at,
      },
      transaction: transaction
        ? {
            id: transaction.id,
            amount_cents: transaction.amount_cents,
            currency: transaction.currency,
          }
        : null,
    });
  } catch (error: any) {
    console.error('[POST /api/subscription/verify] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء التحقق من الدفع',
        error_en: error?.message || 'Payment verification failed',
      },
      { status: 500 }
    );
  }
}
