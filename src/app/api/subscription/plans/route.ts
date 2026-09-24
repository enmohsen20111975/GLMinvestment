export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const M2Y_API_URL = process.env.M2Y_API_URL || process.env.MAIN_DOMAIN || 'https://m2y.net';
const M2Y_SYNC_SECRET = process.env.M2Y_SYNC_SECRET || process.env.SHARED_SECRET || '';

// Default subscription plans data  (fallback if m2y.net and local DB are both unreachable)
const DEFAULT_PLANS = [
  {
    id: 'free',
    name: 'free',
    name_ar: 'مجانى',
    price: 0,
    price_yearly: 0,
    trial_days: 30,
    features: JSON.stringify([
      'بيانات السوق الأساسية',
      '5 أسهم في قائمة المراقبة',
      'محفظة استثمارية واحدة',
      '3 تنبيهات يومياً',
      'عرض الأسهم والمؤشرات'
    ]),
    max_watchlist: 5,
    max_portfolio: 1,
    max_alerts: 3,
    ai_analysis: 0,
    deep_analysis: 0,
    priority_support: 0,
    is_active: 1,
    sort_order: 1
  },
  {
    id: 'normal',
    name: 'normal',
    name_ar: 'عادى',
    price: 199,
    price_yearly: 1990,
    trial_days: 0,
    features: JSON.stringify([
      'جميع ميزات المجانى',
      '25 سهم في قائمة المراقبة',
      '5 محافظ استثمارية',
      'تنبيهات غير محدودة',
      'تتبع المحفظة الاستثمارية',
      'تحليلات أساسية متقدمة',
      'تصدير التقارير PDF',
      'التحليل الفني للأسهم'
    ]),
    max_watchlist: 25,
    max_portfolio: 5,
    max_alerts: 9999,
    ai_analysis: 0,
    deep_analysis: 1,
    priority_support: 0,
    is_active: 1,
    sort_order: 2
  },
  {
    id: 'premium',
    name: 'premium',
    name_ar: 'مميز',
    price: 299,
    price_yearly: 2990,
    trial_days: 0,
    features: JSON.stringify([
      'جميع ميزات عادى',
      'قائمة مراقبة غير محدودة',
      'محافظ استثمارية غير محدودة',
      'تحليل فني ومالي متقدم',
      'تحليلات ذكية مخصصة',
      'دعم أولوي على مدار الساعة',
      'تقارير مخصصة',
      'إشعارات فورية للأسعار',
      'تحليل عميق للأسهم'
    ]),
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: 1,
    deep_analysis: 1,
    priority_support: 1,
    is_active: 1,
    sort_order: 3
  }
];

// Auto-seed/update plans if needed
async function ensurePlansExist() {
  try {
    const existingCount = await db.subscriptionPlan.count();
    if (existingCount === 0) {
      console.log('[subscription/plans] No plans found, seeding defaults...');
      for (const plan of DEFAULT_PLANS) {
        await db.subscriptionPlan.create({ data: plan });
      }
      console.log('[subscription/plans] Seeded', DEFAULT_PLANS.length, 'plans');
    } else {
      // Sync plans to updated prices
      for (const plan of DEFAULT_PLANS) {
        await db.subscriptionPlan.upsert({
          where: { id: plan.id },
          update: {
            price: plan.price,
            price_yearly: plan.price_yearly,
            trial_days: plan.trial_days,
          },
          create: plan,
        }).catch(() => {});
      }
    }
  } catch (error) {
    console.error('[subscription/plans] Error ensuring plans:', error);
  }
}

/**
 * GET /api/subscription/plans
 * Priority: m2y.net (central) → local DB → hardcoded defaults
 */
export async function GET() {
  // ─── 1. Try m2y.net central gateway first ────────────────────
  if (M2Y_SYNC_SECRET && M2Y_API_URL && !M2Y_API_URL.includes('localhost')) {
    try {
      const res = await fetch(`${M2Y_API_URL}/api/subscriptions/plans?source=glminvestment`, {
        headers: { 'X-M2Y-Sync-Secret': M2Y_SYNC_SECRET },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && (data.plans?.length ?? 0) > 0) {
          return NextResponse.json({ success: true, plans: data.plans, source: 'm2y.net' });
        }
      }
    } catch (e) {
      console.warn('[subscription/plans] m2y.net unreachable, falling back:', (e as Error).message);
    }
  }

  // ─── 2. Fallback to local Prisma DB ──────────────────────────
  try {
    await ensurePlansExist();
    const plans = await db.subscriptionPlan.findMany({
      where: { is_active: 1 },
      orderBy: { sort_order: 'asc' },
    });

    if (plans && plans.length > 0) {
      const enriched = plans.map((plan) => ({
        id: plan.id, name: plan.name, name_ar: plan.name_ar,
        price: plan.price, price_yearly: plan.price_yearly, trial_days: plan.trial_days,
        features: JSON.parse(plan.features || '[]'),
        max_watchlist: plan.max_watchlist, max_portfolio: plan.max_portfolio, max_alerts: plan.max_alerts,
        ai_analysis: plan.ai_analysis, deep_analysis: plan.deep_analysis, priority_support: plan.priority_support,
      }));
      return NextResponse.json({ success: true, plans: enriched, source: 'local' });
    }
  } catch (dbError) {
    console.warn('[GET /api/subscription/plans] DB error, using defaults:', dbError);
  }

  // ─── 3. Last-resort fallback: hardcoded plans ─────────────────
  const enriched = DEFAULT_PLANS.map((plan) => ({
    id: plan.id, name: plan.name, name_ar: plan.name_ar,
    price: plan.price, price_yearly: plan.price_yearly, trial_days: plan.trial_days,
    features: JSON.parse(plan.features || '[]'),
    max_watchlist: plan.max_watchlist, max_portfolio: plan.max_portfolio, max_alerts: plan.max_alerts,
    ai_analysis: plan.ai_analysis, deep_analysis: plan.deep_analysis, priority_support: plan.priority_support,
  }));

  return NextResponse.json({ success: true, plans: enriched, source: 'defaults' });
}
