/**
 * POST /api/redeem-promo
 * ======================
 * Promo code redemption endpoint (P15-TASK-6, hardened by P0-3).
 *
 * Users send a promo code; if valid, their `subscription_tier` is upgraded to
 * `plan_tier` (default 'premium'), `trial_ends_at` is extended by
 * `premium_days` days, AND a time-limited `UserSubscription` row is upserted
 * with `expires_at = now + premium_days` (or extended from the latest active
 * window).
 *
 * P0-3 (Fix Battalion — Promo Codes Time-Limited): previously ONLY
 * `subscription_tier='premium'` was set, which (being in PAID_TIERS) bypassed
 * the trial check FOREVER. The `trial_ends_at` extension was dead because
 * `subscription_tier` took precedence. Effect: promo code = lifetime free
 * premium (Rule 50 — MONEY-AS-CUSTOMER-LIFE breach). Fix: also write a
 * UserSubscription row with `expires_at`; P0-2's `isPaidSubscriptionActive`
 * (in src/lib/subscription-gate.ts) consults `expires_at` and treats the user
 * as a free user once it elapses, so the promo is genuinely time-limited.
 *
 * Auth: NextAuth session (web) OR bearer API token (mobile) — mirrors
 *       /api/auth/me so the same client auth paths work.
 *
 * Request body:
 *   { "code": "WELCOME90" }
 *
 * Response (200):
 *   { "success": true, "user": { ... }, "promo": { "premium_days": N, "expires_at": "..." } }
 *
 * Response (400/401):
 *   { "success": false, "error": "<Arabic message>" }
 *
 * Race-condition handling:
 *   - Two concurrent redemptions of the last use are prevented via
 *     `updateMany` with a `current_uses < max_uses` condition inside a
 *     transaction. SQLite serializes writes; the loser gets count=0 and we
 *     roll back with a clear "exhausted" error.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RedeemableUser {
  id: string;
  email: string;
  subscription_tier: string;
  trial_ends_at: Date | null;
}

/** Resolve the authenticated user from NextAuth session OR bearer API token. */
async function resolveUser(request: NextRequest): Promise<RedeemableUser | null> {
  // 1) NextAuth session (web)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const dbUser = await db.user.findUnique({
        where: { email: session.user.email },
        select: {
          id: true,
          email: true,
          subscription_tier: true,
          trial_ends_at: true,
        },
      });
      if (dbUser) return dbUser;
    }
  } catch (sessionErr) {
    console.error('[POST /api/redeem-promo] Session error:', sessionErr);
  }

  // 2) Bearer token (mobile API)
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    try {
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;

      if (token) {
        const apiToken = await db.apiToken.findUnique({
          where: { token },
          include: {
            User: {
              select: {
                id: true,
                email: true,
                is_active: true,
                subscription_tier: true,
                trial_ends_at: true,
              },
            },
          },
        });

        const isNotExpired =
          !apiToken.expires_at ||
          new Date(apiToken.expires_at).getTime() > Date.now();

        if (apiToken && isNotExpired && apiToken.User?.is_active) {
          return apiToken.User;
        }
      }
    } catch (tokenErr) {
      console.error('[POST /api/redeem-promo] Token error:', tokenErr);
    }
  }

  return null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // ----- 1. Auth -------------------------------------------------------
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول لتفعيل كود الخصم' },
        { status: 401 }
      );
    }

    // ----- 2. Parse + normalize body ------------------------------------
    let body: unknown = null;
    try {
      body = await request.json();
    } catch { // silent fallback (safe-by-design)
      return NextResponse.json(
        { success: false, error: 'صيغة الطلب غير صحيحة' },
        { status: 400 }
      );
    }

    const rawCode =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).code
        : undefined;

    if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'من فضلك أدخل كود الخصم' },
        { status: 400 }
      );
    }

    // Normalize: uppercase + trim. Promo codes are case-insensitive.
    const code = rawCode.trim().toUpperCase();

    if (code.length < 3 || code.length > 64) {
      return NextResponse.json(
        { success: false, error: 'كود الخصم غير صالح' },
        { status: 400 }
      );
    }

    // ----- 3. Look up promo code ----------------------------------------
    try {
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS PromoCode (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          max_uses INTEGER DEFAULT 1,
          current_uses INTEGER DEFAULT 0,
          expires_at DATETIME,
          premium_days INTEGER DEFAULT 30,
          plan_tier TEXT DEFAULT 'premium',
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          redeemed_by TEXT
        )
      `);
    } catch { /* safe-by-design */ }

    const promo = await db.promoCode.findUnique({
      where: { code },
    });

    if (!promo) {
      return NextResponse.json(
        { success: false, error: 'كود الخصم غير صحيح' },
        { status: 400 }
      );
    }

    // ----- 4. Validity checks -------------------------------------------
    if (!promo.is_active) {
      return NextResponse.json(
        { success: false, error: 'هذا الكود غير مفعّل' },
        { status: 400 }
      );
    }

    if (promo.expires_at && promo.expires_at.getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, error: 'انتهت صلاحية هذا الكود' },
        { status: 400 }
      );
    }

    if (promo.current_uses >= promo.max_uses) {
      return NextResponse.json(
        {
          success: false,
          error: 'تم استخدام هذا الكود الحد الأقصى من المرات',
        },
        { status: 400 }
      );
    }

    // ----- 5. Atomic redemption (transaction + race-safe updateMany) ----
    // We use updateMany with `current_uses < max_uses` so two simultaneous
    // redemptions of the last use cannot both succeed. SQLite serializes the
    // writes; the loser gets count=0 and we surface a clear error.
    const premiumDays = promo.premium_days > 0 ? promo.premium_days : 30;

    // Pre-read the user's existing UserSubscription so we can extend the
    // `expires_at` window from the latest active expiry (paid sub OR trial).
    // Done OUTSIDE the transaction because it's a read; the transaction
    // below holds the actual upsert.
    const existingSub = await db.userSubscription.findUnique({
      where: { user_id: user.id },
      select: { expires_at: true },
    });

    const result = await db.$transaction(async (tx) => {
      // 5a) Conditionally increment usage. Returns count of updated rows.
      const updateResult = await tx.promoCode.updateMany({
        where: {
          id: promo.id,
          is_active: true,
          current_uses: { lt: promo.max_uses },
        },
        data: {
          current_uses: { increment: 1 },
          redeemed_by: user.id,
        },
      });

      if (updateResult.count === 0) {
        // Lost the race — someone else took the last use between our read
        // and our write. Throw to abort the transaction.
        const raceErr = new Error('PROMO_EXHAUSTED');
        (raceErr as Error & { code?: string }).code = 'PROMO_EXHAUSTED';
        throw raceErr;
      }

      // 5b) Compute the new expiry. Extend from whichever of the following
      // is latest AND still in the future:
      //   - existing UserSubscription.expires_at (paid subscription window)
      //   - user.trial_ends_at (trial window)
      //   - now (no active window → start from scratch)
      // This prevents a promo redemption from SHORTENING an existing paid
      // window (Rule 50 — MONEY-AS-CUSTOMER-LIFE: never steal paid time).
      const now = new Date();
      const trialExpiry = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
      const subExpiry = existingSub?.expires_at
        ? new Date(existingSub.expires_at)
        : null;

      let baseDate = now;
      if (trialExpiry && trialExpiry.getTime() > baseDate.getTime()) {
        baseDate = trialExpiry;
      }
      if (subExpiry && subExpiry.getTime() > baseDate.getTime()) {
        baseDate = subExpiry;
      }
      const newExpiry = new Date(baseDate.getTime() + premiumDays * MS_PER_DAY);

      // 5c) Upgrade user tier + set trial expiry. We KEEP setting
      // `subscription_tier='premium'` so `getTrialStatus` grants immediate
      // access (P0-3 plan). The time-limiting is enforced by the
      // UserSubscription row we upsert in 5d below — P0-2's
      // `isPaidSubscriptionActive` consults `UserSubscription.expires_at`
      // and downgrades the user to free once it elapses.
      const targetTier = (promo as any).plan_tier || 'premium';
      const subscriptionTier =
        targetTier === 'all' ? 'developer' : targetTier;
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          subscription_tier: subscriptionTier,
          trial_ends_at: newExpiry,
        },
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          image: true,
          subscription_tier: true,
          trial_ends_at: true,
          is_active: true,
        },
      });

      // 5d) Upsert a time-limited UserSubscription row.
      // BEFORE P0-3: only `subscription_tier='premium'` was set, which bypasts
      // the trial check FOREVER (PAID_TIERS short-circuit). The 30-day
      // `trial_ends_at` extension was dead — `subscription_tier` took
      // precedence. Result: promo code = lifetime free premium.
      // AFTER P0-3: we ALSO write a UserSubscription row with
      // `expires_at = newExpiry`. P0-2's `isPaidSubscriptionActive` reads
      // this and returns `false` once `expires_at < now`, at which point the
      // paid-tier bypass stops applying and the trial gate engages.
      //
      // `plan_id` FK safety: SubscriptionPlan on prod may be seeded with
      // only free/premium/pro (see scripts/setup-all-dbs.ts) or
      // free/normal/premium (see prisma/seed-subscriptions.ts). A promo
      // code with `plan_tier='developer'` or `'normal'` could therefore
      // trip the FK constraint on upsert. To keep redemption working we
      // look up the plan and fall back to 'premium' (always seeded) if
      // the target plan doesn't exist.
      let planIdForSub = subscriptionTier;
      const planExists = await tx.subscriptionPlan.findUnique({
        where: { id: subscriptionTier },
        select: { id: true },
      });
      if (!planExists) {
        planIdForSub = 'premium';
      }

      await tx.userSubscription.upsert({
        where: { user_id: user.id },
        update: {
          plan_id: planIdForSub,
          status: 'active',
          payment_method: 'promo_code',
          expires_at: newExpiry.toISOString(),
          updated_at: now.toISOString(),
        },
        create: {
          id: `sub_${user.id}_${now.getTime()}`,
          user_id: user.id,
          plan_id: planIdForSub,
          status: 'active',
          payment_method: 'promo_code',
          started_at: now.toISOString(),
          expires_at: newExpiry.toISOString(),
          updated_at: now.toISOString(),
        },
      });

      // 5e) Record redemption in PromoRedemption table
      try {
        await tx.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS PromoRedemption (
            id TEXT PRIMARY KEY,
            promo_code_id TEXT,
            code TEXT NOT NULL,
            user_id TEXT NOT NULL,
            plan_tier TEXT NOT NULL,
            premium_days INTEGER NOT NULL,
            redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME
          )
        `);
        const redId = `red_${promo.id}_${user.id}_${now.getTime()}`;
        await tx.$executeRawUnsafe(
          `INSERT INTO PromoRedemption (id, promo_code_id, code, user_id, plan_tier, premium_days, redeemed_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          redId,
          promo.id,
          promo.code,
          user.id,
          (promo as any).plan_tier || 'premium',
          premiumDays,
          now.toISOString(),
          newExpiry.toISOString()
        );
      } catch (redErr) {
        console.warn('[POST /api/redeem-promo] PromoRedemption insert failed (non-fatal):', redErr);
      }

      return { updatedUser, newExpiry };
    });

    // ----- 6. Success ----------------------------------------------------
    return NextResponse.json({
      success: true,
      message: `تم تفعيل الكود بنجاح! استمتعت بـ ${premiumDays} يوم من الباقة المتقدمة`,
      user: {
        id: result.updatedUser.id,
        email: result.updatedUser.email,
        username: result.updatedUser.username || '',
        name: result.updatedUser.name || '',
        image: result.updatedUser.image || null,
        subscription_tier: result.updatedUser.subscription_tier,
        trial_ends_at: result.updatedUser.trial_ends_at?.toISOString() || null,
        is_active: result.updatedUser.is_active ?? true,
      },
      promo: {
        code: promo.code,
        premium_days: premiumDays,
        expires_at: promo.expires_at ? promo.expires_at.toISOString() : null,
      },
      expires_at: result.newExpiry.toISOString(),
    });
  } catch (error) {
    // Race-condition — last use taken between read & write.
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'PROMO_EXHAUSTED'
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'تم استخدام هذا الكود الحد الأقصى من المرات',
        },
        { status: 400 }
      );
    }

    console.error('[POST /api/redeem-promo] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تفعيل الكود. حاول مرة أخرى.' },
      { status: 500 }
    );
  }
}
