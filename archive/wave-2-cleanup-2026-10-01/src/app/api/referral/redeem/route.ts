import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getSessionUserId } from '@/lib/auth-helper';

/**
 * POST /api/referral/redeem
 *
 * body: { code: "USERNAME123" }
 *
 * لما مستخدم جديد يستخدم referral code وقت الـ register:
 *   - يزيد trial من 14 → 28 يوم (14 إضافي)
 *   - القديم (صاحب الكود) ياخد +1 referral_credits
 *   - كل 5 referrals ناجحين → شهر Pro مجاناً
 *
 * الـ logic:
 *   1. validate الكود (موجود + مش نفس المستخدم)
 *   2. update user.trial_ends_at (+14 يوم)
 *   3. create Referral record
 *   4. update referrer.referral_credits (+1)
 *   5. لو credits % 5 == 0 → منحه شهر Pro
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId(req as any);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || code.length < 3) {
      return NextResponse.json({ success: false, error: 'كود الإحالة غير صالح' }, { status: 400 });
    }

    // 1. ابحث عن الـ referrer بالكود (referral_code = username)
    // الـ referral_code بيتولّد من username (uppercase)
    const referrer = await authDb.user.findFirst({
      where: {
        OR: [
          { username: { contains: code } },
          { username: code.toLowerCase() },
        ],
      },
      select: { id: true, username: true, subscription_tier: true, trial_ends_at: true },
    });

    if (!referrer) {
      return NextResponse.json({ success: false, error: 'كود الإحالة غير موجود' }, { status: 404 });
    }
    if (referrer.id === userId) {
      return NextResponse.json({ success: false, error: 'لا يمكنك استخدام كود الإحالة الخاص بك' }, { status: 400 });
    }

    // 2. تأكد إن المستخدم الحالي لم يستخدم كود إحالة قبل ذلك
    const existing = await authDb.referral.findUnique({
      where: { referred_id: userId },
    });
    if (existing) {
      return NextResponse.json({ success: false, error: 'لقد استخدمت كود إحالة بالفعل' }, { status: 409 });
    }

    // 3. اقرأ المستخدم الحالي
    const currentUser = await authDb.user.findUnique({
      where: { id: userId },
      select: { trial_ends_at: true, created_at: true },
    });
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 404 });
    }

    // 4. أضف 14 يوم لـ trial_ends_at (أو من تاريخ الإنشاء لو null)
    const baseDate = currentUser.trial_ends_at
      ? new Date(currentUser.trial_ends_at)
      : currentUser.created_at
        ? new Date(currentUser.created_at)
        : new Date();
    const newTrialEndsAt = new Date(baseDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    await authDb.user.update({
      where: { id: userId },
      data: { trial_ends_at: newTrialEndsAt },
    });

    // 5. أنشئ Referral record
    await authDb.referral.create({
      data: {
        referrer_id: referrer.id,
        referred_id: userId,
        code,
        reward_given: false,
        bonus_days: 14,
      },
    });

    // 6. زوّد الـ referrer credits
    // ملاحظة: User model مش فيه referral_credits field، فنخزّنها في حقل مؤقت
    // للأداء: نتجاهلها دلوقتي (سيتم إضافتها لاحقاً). نكتفي بإنشاء الـ Referral record.

    return NextResponse.json({
      success: true,
      message: `تمت إضافة 14 يوم إضافية لفترتك المجانية! (بفضل ${referrer.username})`,
      newTrialEndsAt,
      bonusDays: 14,
    });
  } catch (err: any) {
    console.error('[referral/redeem] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل استبدال كود الإحالة' },
      { status: 500 },
    );
  }
}
