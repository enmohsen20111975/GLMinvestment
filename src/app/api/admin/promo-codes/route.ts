import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

let _tableEnsured = false;

async function ensurePromoCodeTable() {
  if (_tableEnsured) return;
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
    _tableEnsured = true;
  } catch (err) {
    console.error('[PromoCode Table Init Error]:', err);
  }
}

function generateRandomCode(prefix = 'GLM'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomStr = '';
  for (let i = 0; i < 6; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${randomStr}`;
}

/**
 * GET /api/admin/promo-codes
 * List all promo codes with stats
 */
export async function GET(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    await ensurePromoCodeTable();

    const promoCodes = await db.promoCode.findMany({
      orderBy: { created_at: 'desc' },
    });

    const totalCodes = promoCodes.length;
    const activeCodes = promoCodes.filter((p) => p.is_active).length;
    const totalRedemptions = promoCodes.reduce((acc, p) => acc + p.current_uses, 0);

    return NextResponse.json({
      success: true,
      stats: {
        total_codes: totalCodes,
        active_codes: activeCodes,
        total_redemptions: totalRedemptions,
      },
      promo_codes: promoCodes,
    });
  } catch (error: any) {
    console.error('[GET /api/admin/promo-codes] Error:', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/promo-codes
 * Create a new promo code
 */
export async function POST(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    await ensurePromoCodeTable();

    const body = await request.json();
    let { code, plan_tier = 'premium', duration_days = 30, max_uses = 1, expires_at } = body;

    // Normalize code or auto-generate
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      code = generateRandomCode(plan_tier === 'developer' || plan_tier === 'all' ? 'VIP' : 'PRO');
    } else {
      code = code.trim().toUpperCase().replace(/\s+/g, '');
    }

    if (code.length < 3) {
      return NextResponse.json(
        { success: false, error: 'كود الخصم يجب أن يتكون من 3 أحرف على الأقل' },
        { status: 400 }
      );
    }

    // Check code uniqueness
    const existing = await db.promoCode.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `كود الخصم (${code}) موجود بالفعل!` },
        { status: 400 }
      );
    }

    const numDays = Math.max(1, parseInt(String(duration_days || '30'), 10));
    const maxUsesInt = Math.max(1, parseInt(String(max_uses || '1'), 10));
    const expiryDate = expires_at ? new Date(expires_at) : null;

    const newPromo = await db.promoCode.create({
      data: {
        code,
        plan_tier: plan_tier || 'premium',
        premium_days: numDays,
        max_uses: maxUsesInt,
        current_uses: 0,
        is_active: true,
        expires_at: expiryDate,
      },
    });

    return NextResponse.json({
      success: true,
      message: `تم إنشاء كود الخصم (${newPromo.code}) بنجاح!`,
      promo: newPromo,
    });
  } catch (error: any) {
    console.error('[POST /api/admin/promo-codes] Error:', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/promo-codes
 * Toggle active status or update promo properties
 */
export async function PATCH(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    await ensurePromoCodeTable();

    const body = await request.json();
    const { id, is_active, max_uses, expires_at } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'معرف الكود مطلوب' }, { status: 400 });
    }

    const promo = await db.promoCode.findUnique({ where: { id } });
    if (!promo) {
      return NextResponse.json({ success: false, error: 'كود الخصم غير موجود' }, { status: 404 });
    }

    const updateData: any = {};
    if (typeof is_active === 'boolean') updateData.is_active = is_active;
    if (max_uses !== undefined) updateData.max_uses = Math.max(1, parseInt(String(max_uses), 10));
    if (expires_at !== undefined) updateData.expires_at = expires_at ? new Date(expires_at) : null;

    const updated = await db.promoCode.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      message: `تم تحديث الكود (${updated.code}) بنجاح`,
      promo: updated,
    });
  } catch (error: any) {
    console.error('[PATCH /api/admin/promo-codes] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في تحديث كود الخصم' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/promo-codes
 * Delete a promo code
 */
export async function DELETE(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    await ensurePromoCodeTable();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'معرف الكود مطلوب' }, { status: 400 });
    }

    await db.promoCode.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: 'تم حذف كود الخصم بنجاح',
    });
  } catch (error: any) {
    console.error('[DELETE /api/admin/promo-codes] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في حذف كود الخصم' },
      { status: 500 }
    );
  }
}
