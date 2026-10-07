import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getSessionUserId } from '@/lib/auth-helper';

/**
 * GET /api/referral/stats
 *
 * بيرجّع إحصائيات الإحالة للمستخدم الحالي:
 *   { referralCode, totalReferrals, activeReferrals, creditsEarned }
 *
 * الـ referralCode = username.uppercase() (سهل يتذكر)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId(req as any);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: { username: true, name: true },
    });
    if (!user) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 404 });
    }

    // referralCode = username uppercased (or name if no username)
    const referralCode = (user.username || user.name || 'user').toUpperCase();

    // عدد الإحالات الإجمالي
    const totalReferrals = await authDb.referral.count({
      where: { referrer_id: userId },
    });

    // عدد الإحالات "النشطة" (اللي مازالوا مستخدمين نشطين)
    // ملاحظة: هنا نعتبر "نشط" = اتعمل referral في آخر 30 يوم
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeReferrals = await authDb.referral.count({
      where: {
        referrer_id: userId,
        created_at: { gte: thirtyDaysAgo },
      },
    });

    // credits = totalReferrals (1 credit per referral)
    // كل 5 referrals = شهر Pro مجاناً
    const creditsEarned = totalReferrals;
    const proMonthsEarned = Math.floor(totalReferrals / 5);
    const referralsToNextReward = 5 - (totalReferrals % 5);

    return NextResponse.json({
      success: true,
      referralCode,
      shareUrl: `https://invist.m2y.net/r/${referralCode}`,
      totalReferrals,
      activeReferrals,
      creditsEarned,
      proMonthsEarned,
      referralsToNextReward: referralsToNextReward === 5 ? 0 : referralsToNextReward,
    });
  } catch (err: any) {
    console.error('[referral/stats] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل جلب إحصائيات الإحالة' },
      { status: 500 },
    );
  }
}
