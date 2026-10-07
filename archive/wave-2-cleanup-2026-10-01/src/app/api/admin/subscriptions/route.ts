import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * GET /api/admin/subscriptions
 *
 * بيرجّع كل الاشتراكات + إحصائيات للأدمن.
 *
 * FIX-P1-SECURITY (CRIT-3): Added `requireAdminAsync` auth check at the top.
 * The previous comment "محمي بـ admin_session cookie (middleware)" was FALSE —
 * middleware does NOT enforce admin auth (Edge runtime limitation), so the
 * previous version leaked MRR + conversion rate + every user's email + tier
 * to ANY unauthenticated caller. Now this route is properly gated.
 *
 * Query params:
 *   - status: filter by status (active|trial|expired|pending_approval|cancelled)
 *   - tier: filter by tier
 *   - limit: default 100
 *
 * الرد:
 *   { success, stats: { MRR, activeTrials, conversionRate, churnRate }, subscriptions: [...] }
 */
export async function GET(req: NextRequest) {
  try {
    const authError = await requireAdminAsync(req);
    if (authError) return authError;

    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status');
    const tierFilter = url.searchParams.get('tier');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

    // بناء where condition
    const where: any = {};
    if (statusFilter) where.status = statusFilter;
    if (tierFilter) where.plan_id = tierFilter;

    // 1. الاشتراكات
    const subscriptions = await authDb.userSubscription.findMany({
      where,
      take: limit,
      orderBy: { updated_at: 'desc' },
    });

    // 2. إحصائيات
    const allSubs = await authDb.userSubscription.findMany();
    const allUsers = await authDb.user.findMany({
      select: { id: true, subscription_tier: true, trial_ends_at: true, created_at: true },
    });

    const now = new Date();
    let activeSubs = 0;
    let activeTrials = 0;
    let expiredTrials = 0;
    let mrr = 0; // Monthly Recurring Revenue بالجنيه

    // price map للحساب MRR
    const pricingRows = await authDb.marketPricing.findMany({
      where: { billing_cycle: 'monthly' },
    });
    const priceMap = new Map<string, number>();
    pricingRows.forEach((p) => {
      // نستخدم سعر egx كـ default للـ MRR
      if (p.market === 'egx' || !priceMap.has(p.tier)) {
        priceMap.set(p.tier, p.price_egp);
      }
    });

    for (const u of allUsers) {
      const tier = (u.subscription_tier || 'free').toLowerCase();
      const isPaid = ['premium', 'pro', 'b2b_starter', 'b2b_pro', 'b2b_enterprise'].includes(tier);
      if (isPaid) {
        activeSubs++;
        // MRR: monthly price (لو سنوي، نقسم على 12)
        const monthlyPrice = priceMap.get(tier) || 0;
        mrr += monthlyPrice;
      } else {
        // Free → فحص trial
        const trialEndsAt = u.trial_ends_at ? new Date(u.trial_ends_at) : null;
        if (trialEndsAt && trialEndsAt > now) {
          activeTrials++;
        } else if (trialEndsAt && trialEndsAt <= now) {
          expiredTrials++;
        }
      }
    }

    // conversion rate = activeSubs / (activeSubs + expiredTrials)
    const conversionRate = activeSubs + expiredTrials > 0
      ? (activeSubs / (activeSubs + expiredTrials)) * 100
      : 0;

    // churn rate (مبسّط) = cancelled this month / total
    const churnRate = 0; // TODO: تتبّع الإلغاءات

    return NextResponse.json({
      success: true,
      stats: {
        MRR: Math.round(mrr),
        activeSubs,
        activeTrials,
        expiredTrials,
        conversionRate: Number(conversionRate.toFixed(2)),
        churnRate,
        totalUsers: allUsers.length,
      },
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        userId: s.user_id,
        tier: s.plan_id,
        status: s.status,
        startedAt: s.started_at,
        expiresAt: s.expires_at,
        trialEndsAt: s.trial_ends_at,
        paymentMethod: s.payment_method,
        updatedAt: s.updated_at,
      })),
    });
  } catch (err: any) {
    console.error('[admin/subscriptions] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل جلب الاشتراكات' },
      { status: 500 },
    );
  }
}
