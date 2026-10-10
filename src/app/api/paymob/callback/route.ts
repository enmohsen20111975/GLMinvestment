import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import crypto from 'crypto';
import { db } from '@/lib/db';
import { authDb } from '@/lib/db-auth';
import { logger } from '@/lib/logger'; // Wave 1 P0 Fix 3 — Rule 58 (observability)
import { PAID_TIERS } from '@/lib/subscription-gate';

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
  } catch { // silent fallback (safe-by-design)
    return false; // length mismatch → invalid
  }
}

async function processPaymentResult(params: Record<string, string>) {
  const isSuccess = params.success === 'true' || params.success === 'True' || params.success === '1';
  const merchantOrderId = params.merchant_order_id || params['order.merchant_order_id'] || '';

  if (!merchantOrderId) {
    return { success: false, planId: 'normal', userId: null, error: 'Invalid merchant order ID' };
  }

  // P0 HOTFIX (Task 16-A): accept BOTH legacy 'GLM-' and new 'm2y-' prefixes.
  // The legacy /api/paymob/create-payment generates 'GLM-{userId}-{plan}-{ts}'.
  // The new /api/subscription/checkout generates 'm2y-{tier}-{userIdSuffix8}-{ts}'.
  // Before this fix, the callback rejected ALL m2y- orders → users paid but
  // were never upgraded (direct revenue loss). Per Rule 50 (MONEY-AS-CUSTOMER-LIFE).
  let userId: string | null = null;
  let planId: string = 'normal';
  let billingCycle = 'monthly';

  if (merchantOrderId.startsWith('GLM-')) {
    // Legacy format: GLM-{userId}-{plan_id}-{timestamp}
    const parts = merchantOrderId.split('-');
    if (parts.length < 3) {
      return { success: false, planId: 'normal', userId: null, error: 'Malformed order ID' };
    }
    userId = parts[1];
    planId = parts[2];
  } else if (merchantOrderId.startsWith('m2y-')) {
    // Accepts both 5-part (with billingCycle) and 4-part (legacy) formats:
    // 5-part: m2y-{tier}-{billingCycle}-{userIdSuffix8}-{timestamp}
    // 4-part: m2y-{tier}-{userIdSuffix8}-{timestamp}
    const parts = merchantOrderId.split('-');
    let userIdSuffix = '';
    if (parts.length >= 5) {
      planId = parts[1];
      billingCycle = parts[2].toLowerCase();
      userIdSuffix = parts[3];
    } else if (parts.length >= 4) {
      planId = parts[1];
      userIdSuffix = parts[2];
    } else {
      return { success: false, planId: 'normal', userId: null, error: 'Malformed m2y order ID' };
    }

    // Look up the full user ID by suffix (last 8 chars of the user id).
    try {
      const candidates = await authDb.user.findMany({
        where: { id: { endsWith: userIdSuffix } },
        select: { id: true },
      });
      if (candidates.length === 0) {
        logger.error('paymob-callback m2y-: no user matches suffix', { merchantOrderId, userIdSuffix });
        return { success: false, planId, userId: null, error: 'User not found for order suffix' };
      }
      if (candidates.length > 1) {
        logger.error('paymob-callback m2y-: AMBIGUOUS suffix — multiple users match', { merchantOrderId, userIdSuffix, count: candidates.length });
        return { success: false, planId, userId: null, error: 'Ambiguous user suffix' };
      }
      userId = candidates[0].id;
    } catch (lookupErr) {
      logger.error('paymob-callback m2y-: DB lookup failed', { merchantOrderId, err: String(lookupErr) });
      return { success: false, planId, userId: null, error: 'DB lookup failed' };
    }
  } else {
    return { success: false, planId: 'normal', userId: null, error: 'Invalid merchant order ID prefix' };
  }

  // Canonical allowlist: supports all valid platform tiers (free, normal, premium, pro, b2b_*, etc.)
  const ALLOWED_PLANS = new Set([...PAID_TIERS, 'free']);
  if (!ALLOWED_PLANS.has(planId)) {
    logger.error('paymob-callback rejected unknown planId', { planId, userId });
    return { success: false, planId: 'normal', userId, error: 'Invalid plan' };
  }

  // Detect yearly cycle from amount if not explicitly in order id
  if (billingCycle === 'monthly' && params.amount_cents) {
    try {
      const amountCents = Number(params.amount_cents);
      const yearlyPricing = await authDb.marketPricing.findFirst({
        where: { tier: planId, billing_cycle: 'yearly' },
      });
      if (yearlyPricing?.price_egp && Math.abs(amountCents - Math.round(yearlyPricing.price_egp * 100)) <= 100) {
        billingCycle = 'yearly';
      }
    } catch { // silent fallback (safe-by-design)
      // ignore
    }
  }

  const durationMs = (billingCycle === 'yearly' || billingCycle === 'annual')
    ? 365 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;
  const expiresAtIso = new Date(Date.now() + durationMs).toISOString();

  if (isSuccess && userId) {
    try {
      // Update User subscription tier in DB
      await db.user.update({
        where: { id: userId },
        data: { subscription_tier: planId, trial_ends_at: null },
      });

      // Upsert UserSubscription record
      await db.userSubscription.upsert({
        where: { user_id: userId },
        update: {
          plan_id: planId,
          status: 'active',
          payment_method: 'paymob',
          expires_at: expiresAtIso,
          updated_at: new Date().toISOString(),
        },
        create: {
          id: `sub_${userId}_${Date.now()}`,
          user_id: userId,
          plan_id: planId,
          status: 'active',
          payment_method: 'paymob',
          started_at: new Date().toISOString(),
          expires_at: expiresAtIso,
        },
      });

      logger.info('paymob-callback user upgraded', { userId, planId, billingCycle, expiresAt: expiresAtIso });
    } catch (err) {
      logger.error('paymob-callback DB update error', { err: String(err), userId, planId });
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
      logger.warn('paymob-callback GET rejected: missing HMAC');
      return NextResponse.redirect(
        new URL('/subscription?payment=failed&reason=missing_hmac', req.url)
      );
    }

    const hmacValid = verifyHmac(params, receivedHmac);
    if (!hmacValid) {
      logger.warn('paymob-callback GET rejected: HMAC validation failed');
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
    logger.error('paymob-callback GET failed', { err: String(error) });
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
      logger.error('paymob-webhook PAYMOB_HMAC env var not configured — rejecting all webhooks (fail closed)');
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
      logger.warn('paymob-webhook rejected: missing HMAC');
      return NextResponse.json(
        { success: false, error: 'Unauthorized: missing HMAC' },
        { status: 401 }
      );
    }

    const isValid = verifyHmac(params, receivedHmac);
    if (!isValid) {
      logger.warn('paymob-webhook rejected: HMAC validation failed');
      return NextResponse.json(
        { success: false, error: 'Unauthorized: invalid HMAC' },
        { status: 401 }
      );
    }

    // Only reached after HMAC validation passes.
    await processPaymentResult(params);

    return NextResponse.json({ success: true, message: 'Callback received' });
  } catch (error) {
    logger.error('paymob-callback POST failed', { err: String(error) });
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
