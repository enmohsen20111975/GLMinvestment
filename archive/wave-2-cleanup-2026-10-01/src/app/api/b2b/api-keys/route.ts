import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getSessionUserId } from '@/lib/auth-helper';
import crypto from 'crypto';

/**
 * GET /api/b2b/api-keys
 *   - بيرجّع كل الـ API keys للمستخدم الحالي (B2B)
 *
 * POST /api/b2b/api-keys
 *   body: { action: 'rotate' | 'revoke', keyId?: string }
 *   - rotate: يولّد مفتاح جديد + يعمل revoke للقديم
 *   - revoke: يعمل revoke للمفتاح المحدد
 */

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId(req as any);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    // تحقق إن المستخدم B2B
    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: { subscription_tier: true },
    });
    if (!user || !user.subscription_tier?.startsWith('b2b_')) {
      return NextResponse.json(
        { success: false, error: 'هذه الميزة متاحة لعملاء B2B فقط' },
        { status: 403 },
      );
    }

    const keys = await authDb.b2bApiKey.findMany({
      where: { user_id: userId, revoked_at: null },
      orderBy: { created_at: 'desc' },
    });

    // ملاحظة: مفيش expose للمفتاح كامل للـ security (بنعرض prefix بس)
    return NextResponse.json({
      success: true,
      keys: keys.map((k) => ({
        id: k.id,
        keyPrefix: k.key.slice(0, 12) + '...' + k.key.slice(-4),
        label: k.label,
        monthlyLimit: k.monthly_limit,
        requestsThisMonth: k.requests_this_month,
        lastUsed: k.last_used,
        createdAt: k.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[b2b/api-keys GET] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل جلب المفاتيح' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId(req as any);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: { subscription_tier: true },
    });
    if (!user || !user.subscription_tier?.startsWith('b2b_')) {
      return NextResponse.json(
        { success: false, error: 'هذه الميزة متاحة لعملاء B2B فقط' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toLowerCase();

    if (action === 'rotate') {
      // revoke القديم + أنشئ جديد
      await authDb.b2bApiKey.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      // monthly_limit حسب الـ tier
      const tier = user.subscription_tier;
      const monthlyLimit =
        tier === 'b2b_starter' ? 10000 :
        tier === 'b2b_pro' ? 100000 :
        999999999;

      const newKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;
      const created = await authDb.b2bApiKey.create({
        data: {
          user_id: userId,
          key: newKey,
          label: body.label || `key-${Date.now()}`,
          monthly_limit: monthlyLimit,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'تم توليد مفتاح جديد. احفظه في مكان آمن — لن يظهر مرة أخرى.',
        apiKey: newKey,
        keyId: created.id,
      });
    }

    if (action === 'revoke') {
      const keyId = String(body.keyId || '');
      if (!keyId) {
        return NextResponse.json({ success: false, error: 'keyId مطلوب' }, { status: 400 });
      }
      await authDb.b2bApiKey.update({
        where: { id: keyId, user_id: userId },
        data: { revoked_at: new Date() },
      });
      return NextResponse.json({ success: true, message: 'تم إلغاء المفتاح' });
    }

    return NextResponse.json({ success: false, error: 'action غير صالح (rotate|revoke)' }, { status: 400 });
  } catch (err: any) {
    console.error('[b2b/api-keys POST] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل العملية' },
      { status: 500 },
    );
  }
}
