import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/subscription/plans
 * List all active subscription plans (public)
 */
export async function GET() {
  try {
    const plans = await db.subscriptionPlan.findMany({
      where: { is_active: true },
      orderBy: { sort_order: 'asc' },
    });

    const enriched = plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      name_ar: plan.name_ar,
      price: plan.price,
      price_yearly: plan.price_yearly,
      trial_days: plan.trial_days,
      features: JSON.parse(plan.features || '[]'),
      max_watchlist: plan.max_watchlist,
      max_portfolio: plan.max_portfolio,
      max_alerts: plan.max_alerts,
      ai_analysis: plan.ai_analysis,
      deep_analysis: plan.deep_analysis,
      priority_support: plan.priority_support,
    }));

    return NextResponse.json({ success: true, plans: enriched });
  } catch (error) {
    console.error('[GET /api/subscription/plans] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب الباقات' },
      { status: 500 }
    );
  }
}
