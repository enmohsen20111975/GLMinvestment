/**
 * POST /api/redeem-promo
 * ======================
 * Promo code redemption endpoint (P15-TASK-6).
 *
 * Users send a promo code; if valid, their `subscription_tier` is upgraded to
 * 'premium' and `trial_ends_at` is extended by `premium_days` days.
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
    } catch {
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
    } catch {}

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

      // 5b) Compute the new trial expiry. If the user already has premium
      // time left, extend from there; otherwise extend from now.
      const now = new Date();
      const currentExpiry = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
      const baseDate =
        currentExpiry && currentExpiry.getTime() > now.getTime()
          ? currentExpiry
          : now;
      const newExpiry = new Date(baseDate.getTime() + premiumDays * MS_PER_DAY);

      // 5c) Upgrade user tier + set expiry.
      const targetTier = (promo as any).plan_tier || 'premium';
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          subscription_tier: targetTier === 'all' ? 'developer' : targetTier,
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
