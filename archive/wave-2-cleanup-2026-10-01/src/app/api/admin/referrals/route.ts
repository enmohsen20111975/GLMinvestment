import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * GET /api/admin/referrals
 *
 * بيرجّع كل الـ referrals + إحصائيات للأدمن.
 *
 * FIX-P1-SECURITY (CRIT-3): Added `requireAdminAsync` auth check at the top.
 * Previously the comment below falsely claimed middleware protection; the
 * middleware does NOT enforce admin auth (Edge runtime can't read NextAuth
 * session), so any unauthenticated caller could read all referrals + emails.
 */
export async function GET(req: NextRequest) {
  try {
    const authError = await requireAdminAsync(req);
    if (authError) return authError;

    const referrals = await authDb.referral.findMany({
      take: 100,
      orderBy: { created_at: 'desc' },
    });

    // إحصائيات
    const totalReferrals = await authDb.referral.count();
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentReferrals = await authDb.referral.count({
      where: { created_at: { gte: last7Days } },
    });

    // top referrers (أكثر 10 جابوا إحالات)
    const topReferrersRaw = await authDb.referral.groupBy({
      by: ['referrer_id'],
      _count: { referrer_id: true },
      orderBy: { _count: { referrer_id: 'desc' } },
      take: 10,
    });

    // نجيب أسماء الـ top referrers
    const topReferrerIds = topReferrersRaw.map((r) => r.referrer_id);
    const topReferrerUsers = await authDb.user.findMany({
      where: { id: { in: topReferrerIds } },
      select: { id: true, username: true, name: true, email: true },
    });
    const userMap = new Map(topReferrerUsers.map((u) => [u.id, u]));

    const topReferrers = topReferrersRaw.map((r) => ({
      referrerId: r.referrer_id,
      count: r._count.referrer_id,
      user: userMap.get(r.referrer_id),
    }));

    return NextResponse.json({
      success: true,
      stats: {
        totalReferrals,
        recentReferrals,
      },
      topReferrers,
      referrals: referrals.map((r) => ({
        id: r.id,
        referrerId: r.referrer_id,
        referredId: r.referred_id,
        code: r.code,
        rewardGiven: r.reward_given,
        bonusDays: r.bonus_days,
        createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[admin/referrals] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل جلب الإحالات' },
      { status: 500 },
    );
  }
}
