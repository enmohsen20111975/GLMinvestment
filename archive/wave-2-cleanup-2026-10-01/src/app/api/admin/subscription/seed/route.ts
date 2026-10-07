import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * POST /api/admin/subscription/seed
 * Seed subscription plans (admin only)
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    console.log('🌱 Seeding subscription plans...');

    // Delete existing plans first
    await db.subscriptionPlan.deleteMany({});
    console.log('✓ Deleted existing plans');

    const plans = [
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
        ai_analysis: true,
        deep_analysis: true,
        priority_support: true,
        is_active: true,
        sort_order: 3
      }
    ];

    const results = [];
    for (const plan of plans) {
      const result = await db.subscriptionPlan.create({ data: plan });
      results.push({ id: result.id, name: result.name_ar, price: result.price });
      console.log(`✓ Created plan: ${plan.name_ar} - ${plan.price} ج.م`);
    }

    console.log('✅ Subscription plans seeded successfully!');

    return NextResponse.json({
      success: true,
      message: 'تم تحديث باقات الاشتراك بنجاح',
      plans: results
    });
  } catch (error) {
    console.error('[POST /api/admin/subscription/seed] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحديث الباقات', detail: String(error) },
      { status: 500 }
    );
  }
}
