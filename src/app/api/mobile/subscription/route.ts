export const dynamic = 'force-dynamic';
/**
 * Mobile Subscription API - Subscription Plans
 * خطط الاشتراك
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEFAULT_PLANS = [
  {
    id: 'free',
    name: 'free',
    name_ar: 'مجانى',
    price: 0,
    price_yearly: 0,
    trial_days: 30,
    features: [
      'بيانات السوق الأساسية',
      '5 أسهم في قائمة المراقبة',
      'محفظة استثمارية واحدة',
      '3 تنبيهات يومياً',
      'عرض الأسهم والمؤشرات'
    ],
    max_watchlist: 5,
    max_portfolio: 1,
    max_alerts: 3,
    ai_analysis: false,
    deep_analysis: false,
    priority_support: false,
    is_active: true,
    sort_order: 1
  },
  {
    id: 'normal',
    name: 'normal',
    name_ar: 'عادى',
    price: 199,
    price_yearly: 1990,
    trial_days: 0,
    features: [
      'جميع ميزات المجانى',
      '25 سهم في قائمة المراقبة',
      '5 محافظ استثمارية',
      'تنبيهات غير محدودة',
      'تتبع المحفظة الاستثمارية',
      'تحليلات أساسية متقدمة',
      'تصدير التقارير PDF',
      'التحليل الفني للأسهم'
    ],
    max_watchlist: 25,
    max_portfolio: 5,
    max_alerts: 9999,
    ai_analysis: false,
    deep_analysis: true,
    priority_support: false,
    is_active: true,
    sort_order: 2
  },
  {
    id: 'premium',
    name: 'premium',
    name_ar: 'مميز',
    price: 299,
    price_yearly: 2990,
    trial_days: 0,
    features: [
      'جميع ميزات عادى',
      'قائمة مراقبة غير محدودة',
      'محافظ استثمارية غير محدودة',
      'تحليل فني ومالي متقدم',
      'تحليلات ذكية مخصصة',
      'دعم أولوي على مدار الساعة',
      'تقارير مخصصة',
      'إشعارات فورية للأسعار',
      'تحليل عميق للأسهم'
    ],
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: true,
    deep_analysis: true,
    priority_support: true,
    is_active: true,
    sort_order: 3
  }
];

export async function GET() {
  try {
    // Try to get plans from database
    try {
      const plans = await db.subscriptionPlan.findMany({
        where: { is_active: true },
        orderBy: { sort_order: 'asc' },
      });

      if (plans && plans.length > 0) {
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

        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          plans: enriched,
          source: 'database',
        });
      }
    } catch (dbError) {
      console.warn('[Mobile Subscription] DB error, using defaults:', dbError);
    }

    // Return default plans
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      plans: DEFAULT_PLANS,
      source: 'defaults',
    });
  } catch (error: any) {
    console.error('[Mobile Subscription API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'خطأ في جلب الخطط',
    }, { status: 500 });
  }
}
