import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import crypto from 'crypto';
import { db } from '@/lib/db';

/**
 * SEC-03 HOTFIX (Phase A) — Mandatory Paymob HMAC verification.
 *
 * Previous behavior (CRITICAL VULNERABILITY):
 *   - HMAC secret was hardcoded as a fallback in source.
 *   - HMAC was only verified *if present*; on failure the code only
 *     `console.warn`-ed and STILL processed the payment. An attacker could
 *     POST a forged `{obj:{success:true, order:{merchant_order_id:'GLM-<victim>-...'}}`
 *     without any HMAC and upgrade any user to premium for free.
 *
 * New behavior (FAIL CLOSED):
 *   - HMAC secret is read ONLY from process.env.PAYMOB_HMAC. No fallback.
 *   - If PAYMOB_HMAC is not configured, all callbacks are rejected (500).
 *   - HMAC is MANDATORY: a callback without `hmac` or with a mismatched
 *     `hmac` is rejected BEFORE any DB write.
 *       - POST (server-to-server webhook) → 401 Unauthorized.
 *       - GET  (browser redirect)          → redirect to failure page
 *         (we cannot return 401 to a browser redirect, but we MUST NOT
 *          process the payment).
 *   - `processPaymentResult` is only reached after HMAC validation passes.
 */

function getPaymobHmac(): string {
  // NO hardcoded fallback. Fail closed if env var is missing.
  return process.env.PAYMOB_HMAC || '';
}

function verifyHmac(data: Record<string, string>, receivedHmac: string): boolean {
  const paymobHmac = getPaymobHmac();
  if (!paymobHmac) {
    // Configuration error — cannot verify anything.
    return false;
  }
  if (!receivedHmac) return false;

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

  const values = keys.map((key) => data[key] || '');
  const stringToHash = values.join('');

  const calculatedHmac = crypto
    .createHmac('sha512', paymobHmac)
    .update(stringToHash)
    .digest('hex');

  // Constant-time comparison to avoid timing oracles.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculatedHmac.toLowerCase(), 'utf-8'),
      Buffer.from(receivedHmac.toLowerCase(), 'utf-8')
    );
  } catch {
    return false; // length mismatch → invalid
  }
}

async function processPaymentResult(params: Record<string, string>) {
  const isSuccess = params.success === 'true' || params.success === 'True' || params.success === '1';
  const merchantOrderId = params.merchant_order_id || params['order.merchant_order_id'] || '';

  if (!merchantOrderId || !merchantOrderId.startsWith('GLM-')) {
    return { success: false, planId: 'normal', userId: null, error: 'Invalid merchant order ID' };
  }

  // Format: GLM-{userId}-{plan_id}-{timestamp}
  const parts = merchantOrderId.split('-');
  if (parts.length < 3) {
    return { success: false, planId: 'normal', userId: null, error: 'Malformed order ID' };
  }

  const userId = parts[1];
  const planId = parts[2];

  // Defense in depth: validate planId against an allowlist to prevent
  // arbitrary tier injection even if an attacker somehow passes HMAC.
  const ALLOWED_PLANS = new Set(['free', 'normal', 'developer', 'premium']);
  if (!ALLOWED_PLANS.has(planId)) {
    console.error(`[Paymob Callback] Rejected unknown planId: ${planId} for user ${userId}`);
    return { success: false, planId: 'normal', userId, error: 'Invalid plan' };
  }

  if (isSuccess && userId) {
    try {
      // Update User subscription tier in DB
      await db.user.update({
        where: { id: userId },
        data: { subscription_tier: planId },
      });

      // Upsert UserSubscription record
      await db.userSubscription.upsert({
        where: { user_id: userId },
        update: {
          plan_id: planId,
          status: 'active',
          payment_method: 'paymob',
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        create: {
          id: `sub_${userId}_${Date.now()}`,
          user_id: userId,
          plan_id: planId,
          status: 'active',
          payment_method: 'paymob',
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      console.log(`[Paymob Callback] User ${userId} upgraded to ${planId} successfully (HMAC verified).`);
    } catch (err) {
      console.error('[Paymob Callback] Database update error:', err);
    }
  }

  return { success: isSuccess, planId, userId };
}

/**
 * GET — browser redirect callback after the user completes payment on Paymob.
 * The user is redirected here by their browser, so we cannot return 401; we
 * redirect to a failure page if HMAC is missing/invalid. Critically, we NEVER
 * process the payment (no DB write) unless HMAC validates.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const params: Record<string, string> = {};
    searchParams.forEach((val, key) => {
      params[key] = val;
    });

    const receivedHmac = params.hmac || '';

    // SEC-03: HMAC is MANDATORY. Reject (redirect to failure) if missing/invalid.
    if (!receivedHmac) {
      console.warn('[Paymob GET Callback] Rejected: missing HMAC');
      return NextResponse.redirect(
        new URL('/subscription?payment=failed&reason=missing_hmac', req.url)
      );
    }

    const hmacValid = verifyHmac(params, receivedHmac);
    if (!hmacValid) {
      console.warn('[Paymob GET Callback] Rejected: HMAC validation failed');
      return NextResponse.redirect(
        new URL('/subscription?payment=failed&reason=invalid_hmac', req.url)
      );
    }

    // Only reached after HMAC validation passes.
    const result = await processPaymentResult(params);

    if (result.success) {
      return NextResponse.redirect(
        new URL(`/payment/success?plan=${result.planId}`, req.url)
      );
    } else {
      return NextResponse.redirect(
        new URL('/subscription?payment=failed', req.url)
      );
    }
  } catch (error) {
    console.error('[Paymob GET Callback] Error:', error);
    return NextResponse.redirect(new URL('/subscription?payment=error', req.url));
  }
}

/**
 * POST — server-to-server webhook from Paymob.
 * HMAC is MANDATORY. Return 401 if missing/invalid. Never process payment
 * without a valid HMAC.
 */
export async function POST(req: NextRequest) {
  try {
    // SEC-03: configuration check — if PAYMOB_HMAC is not set, fail closed.
    if (!getPaymobHmac()) {
      console.error('[Paymob Webhook] PAYMOB_HMAC env var not configured — rejecting all webhooks (fail closed).');
      return NextResponse.json(
        { success: false, error: 'Server misconfigured' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const obj = body.obj || body;

    const params: Record<string, string> = {
      amount_cents: String(obj.amount_cents || ''),
      created_at: String(obj.created_at || ''),
      currency: String(obj.currency || ''),
      error_occured: String(obj.error_occured || ''),
      has_parent_transaction: String(obj.has_parent_transaction || ''),
      id: String(obj.id || ''),
      integration_id: String(obj.integration_id || ''),
      is_3d_secure: String(obj.is_3d_secure || ''),
      is_auth: String(obj.is_auth || ''),
      is_capture: String(obj.is_capture || ''),
      is_refunded: String(obj.is_refunded || ''),
      is_standalone_payment: String(obj.is_standalone_payment || ''),
      is_voided: String(obj.is_voided || ''),
      order: String(obj.order?.id || obj.order || ''),
      owner: String(obj.owner || ''),
      pending: String(obj.pending || ''),
      source_data_pan: String(obj.source_data?.pan || ''),
      source_data_sub_type: String(obj.source_data?.sub_type || ''),
      source_data_type: String(obj.source_data?.type || ''),
      success: String(obj.success || ''),
      merchant_order_id: String(obj.order?.merchant_order_id || ''),
    };

    const receivedHmac = req.nextUrl.searchParams.get('hmac') || obj.hmac || '';

    // SEC-03: HMAC is MANDATORY for the server-to-server webhook.
    if (!receivedHmac) {
      console.warn('[Paymob Webhook] Rejected: missing HMAC');
      return NextResponse.json(
        { success: false, error: 'Unauthorized: missing HMAC' },
        { status: 401 }
      );
    }

    const isValid = verifyHmac(params, receivedHmac);
    if (!isValid) {
      console.warn('[Paymob Webhook] Rejected: HMAC validation failed');
      return NextResponse.json(
        { success: false, error: 'Unauthorized: invalid HMAC' },
        { status: 401 }
      );
    }

    // Only reached after HMAC validation passes.
    await processPaymentResult(params);

    return NextResponse.json({ success: true, message: 'Callback received' });
  } catch (error) {
    console.error('[Paymob POST Callback] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
