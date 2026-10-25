import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function ensureTables() {
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
    await db.$executeRawUnsafe(`
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
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_promo_redemption_user_id ON PromoRedemption(user_id)`);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_promo_redemption_code ON PromoRedemption(code)`);
  } catch (e) {
    console.error('[ensureTables] Error:', e);
  }
}

/**
 * POST /api/admin/users/[id]/promo
 * Assign or update a promo code for a specific user
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const { id: userId } = await params;
    await ensureTables();

    // Check user existence
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, subscription_tier: true, trial_ends_at: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    const body = await request.json();
    let { code, plan_tier, duration_days } = body;

    let targetTier = plan_tier || 'all';
    let premiumDays = parseInt(String(duration_days || '30'), 10);
    if (isNaN(premiumDays) || premiumDays < 1) premiumDays = 30;

    let promoCodeRecord: any = null;

    if (code && typeof code === 'string' && code.trim().length > 0) {
      const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '');
      promoCodeRecord = await db.promoCode.findUnique({
        where: { code: normalizedCode },
      });

      if (promoCodeRecord) {
        if (!plan_tier) targetTier = promoCodeRecord.plan_tier || 'all';
        if (!duration_days && promoCodeRecord.premium_days) premiumDays = promoCodeRecord.premium_days;

        // Increment usage
        await db.promoCode.update({
          where: { id: promoCodeRecord.id },
          data: {
            current_uses: { increment: 1 },
            redeemed_by: userId,
            updated_at: new Date(),
          },
        });
      } else {
        // Create this new code in PromoCode table for record-keeping
        promoCodeRecord = await db.promoCode.create({
          data: {
            code: normalizedCode,
            plan_tier: targetTier,
            premium_days: premiumDays,
            max_uses: 100,
            current_uses: 1,
            is_active: true,
            redeemed_by: userId,
          },
        });
      }
    } else {
      // Auto-generate code
      const prefix = targetTier === 'all' || targetTier === 'developer' ? 'VIP' : 'PRO';
      const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
      const generatedCode = `${prefix}-ADM-${randomPart}`;

      promoCodeRecord = await db.promoCode.create({
        data: {
          code: generatedCode,
          plan_tier: targetTier,
          premium_days: premiumDays,
          max_uses: 1,
          current_uses: 1,
          is_active: true,
          redeemed_by: userId,
        },
      });
    }

    const now = new Date();
    const newExpiry = new Date(now.getTime() + premiumDays * MS_PER_DAY);
    const subscriptionTier = targetTier === 'all' ? 'developer' : targetTier;

    // 1. Update user
    await db.user.update({
      where: { id: userId },
      data: {
        subscription_tier: subscriptionTier,
        trial_ends_at: newExpiry,
        is_active: true,
      },
    });

    // 2. Insert into PromoRedemption
    const redId = `red_${promoCodeRecord.id}_${userId}_${now.getTime()}`;
    await db.$executeRawUnsafe(
      `INSERT INTO PromoRedemption (id, promo_code_id, code, user_id, plan_tier, premium_days, redeemed_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      redId,
      promoCodeRecord.id,
      promoCodeRecord.code,
      userId,
      targetTier,
      premiumDays,
      now.toISOString(),
      newExpiry.toISOString()
    );

    // 3. Upsert UserSubscription
    let planIdForSub = subscriptionTier;
    const planExists = await db.subscriptionPlan.findUnique({
      where: { id: subscriptionTier },
      select: { id: true },
    });
    if (!planExists) {
      planIdForSub = 'premium';
    }

    await db.userSubscription.upsert({
      where: { user_id: userId },
      update: {
        plan_id: planIdForSub,
        status: 'active',
        payment_method: 'promo_code',
        expires_at: newExpiry.toISOString(),
        updated_at: now.toISOString(),
      },
      create: {
        id: `sub_${userId}_${now.getTime()}`,
        user_id: userId,
        plan_id: planIdForSub,
        status: 'active',
        payment_method: 'promo_code',
        started_at: now.toISOString(),
        expires_at: newExpiry.toISOString(),
        updated_at: now.toISOString(),
      },
    });

    let planLabel = 'باقة المحترفين (Premium)';
    if (targetTier === 'all' || targetTier === 'developer') {
      planLabel = 'VIP شامل (جميع المميزات)';
    } else if (targetTier === 'normal') {
      planLabel = 'الباقة العادية';
    }

    return NextResponse.json({
      success: true,
      message: `تم تفعيل كود الخصم (${promoCodeRecord.code}) للمستخدم بنجاح حتى ${newExpiry.toLocaleDateString('ar-EG')}`,
      promo: {
        id: redId,
        promo_code_id: promoCodeRecord.id,
        code: promoCodeRecord.code,
        plan_tier: targetTier,
        plan_label: planLabel,
        premium_days: premiumDays,
        redeemed_at: now.toISOString(),
        expires_at: newExpiry.toISOString(),
        days_left: premiumDays,
        is_active: true,
        is_expired: false,
      },
    });
  } catch (error: any) {
    console.error('[POST /api/admin/users/[id]/promo] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تفعيل كود الخصم للمستخدم', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users/[id]/promo
 * Revoke promo code and reset user to free
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const { id: userId } = await params;
    await ensureTables();

    // 1. Reset user tier
    await db.user.update({
      where: { id: userId },
      data: {
        subscription_tier: 'free',
        trial_ends_at: null,
      },
    });

    // 2. Mark redemptions as expired
    await db.$executeRawUnsafe(
      `UPDATE PromoRedemption SET expires_at = datetime('now') WHERE user_id = ?`,
      userId
    );

    // 3. Update UserSubscription
    try {
      await db.userSubscription.updateMany({
        where: { user_id: userId },
        data: {
          status: 'cancelled',
          expires_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      message: 'تم إلغاء كود الخصم وإرجاع المستخدم للباقة المجانية بنجاح',
    });
  } catch (error: any) {
    console.error('[DELETE /api/admin/users/[id]/promo] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء إلغاء كود الخصم', details: error.message },
      { status: 500 }
    );
  }
}
