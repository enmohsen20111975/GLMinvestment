import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/admin/subscription/seed
 * Seed subscription plans (admin only)
 */
export async function POST() {
  try {
    console.log('🌱 Seeding subscription plans...');

    const plans = [
      {
        id: 'free',
        name: 'Free',
        name_ar: 'مجاني',
        price: 0,
        price_yearly: 0,
        trial_days: 0,
        features: JSON.stringify([
          'بيانات السوق الأساسية',
          '5 أسهم في قائمة المراقبة',
          '3 تنبيهات يومياً',
          'عرض الأسهم والمؤشرات',
          'التحليل الأساسي للأسهم'
        ]),
        max_watchlist: 5,
        max_portfolio: 3,
        max_alerts: 3,
        ai_analysis: false,
        deep_analysis: false,
        priority_support: false,
        is_active: true,
        sort_order: 1
      },
      {
        id: 'plus',
        name: 'Plus',
        name_ar: 'بلس',
        price: 99,
        price_yearly: 990,
        trial_days: 7,
        features: JSON.stringify([
          'جميع ميزات المجاني',
          '25 سهم في قائمة المراقبة',
          'تنبيهات غير محدودة',
          'تتبع المحفظة الاستثمارية',
          'تحليلات أساسية متقدمة',
          'تصدير التقارير PDF',
          'التحليل الفني للأسهم'
        ]),
        max_watchlist: 25,
        max_portfolio: 10,
        max_alerts: 9999,
        ai_analysis: false,
        deep_analysis: true,
        priority_support: false,
        is_active: true,
        sort_order: 2
      },
      {
        id: 'premium',
        name: 'Premium',
        name_ar: 'بريميوم',
        price: 199,
        price_yearly: 1990,
        trial_days: 14,
        features: JSON.stringify([
          'جميع ميزات بلس',
          'قائمة مراقبة غير محدودة',
          'محافظ استثمارية غير محدودة',
          'تحليل بالذكاء الاصطناعي',
          'توصيات ذكية مخصصة',
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
      const result = await db.subscriptionPlan.upsert({
        where: { id: plan.id },
        update: plan,
        create: plan
      });
      results.push({ id: result.id, name: result.name_ar, price: result.price });
      console.log(`✓ Created/Updated plan: ${plan.name_ar} - ${plan.price} ج.م`);
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
      { success: false, error: 'حدث خطأ أثناء تحديث الباقات' },
      { status: 500 }
    );
  }
}
