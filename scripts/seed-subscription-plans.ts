/**
 * Seed subscription plans into auth.db
 * Run: cd /home/z/my-project/GLMinvestment && DATABASE_URL="file:./db/auth.db" npx tsx scripts/seed-subscription-plans.ts
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const plans = [
  {
    name: 'free',
    name_ar: 'مجاني',
    price: 0,
    price_yearly: null,
    trial_days: 7,
    features: JSON.stringify([
      'عرض لوحة التحكم',
      'تصفح الأسهم',
      '5 عناصر في قائمة المراقبة',
      '3 محافظ استثمارية',
      '10 تنبيهات أسعار',
      'التعلم والمحاكاة',
    ]),
    max_watchlist: 5,
    max_portfolio: 3,
    max_alerts: 10,
    ai_analysis: false,
    deep_analysis: false,
    priority_support: false,
    is_active: true,
    sort_order: 0,
  },
  {
    name: 'plus',
    name_ar: 'بلس',
    price: 99,
    price_yearly: 999,
    trial_days: 0,
    features: JSON.stringify([
      'كل مميزات الباقة المجانية',
      '20 عنصر في قائمة المراقبة',
      '10 محافظ استثمارية',
      '50 تنبيهات أسعار',
      'تحليل بالذكاء الاصطناعي',
      'تحليل شامل للأسهم',
      'تقارير يومية وأسبوعية',
      'بيانات تاريخية موسعة',
    ]),
    max_watchlist: 20,
    max_portfolio: 10,
    max_alerts: 50,
    ai_analysis: true,
    deep_analysis: true,
    priority_support: false,
    is_active: true,
    sort_order: 1,
  },
  {
    name: 'premium',
    name_ar: 'بريميوم',
    price: 199,
    price_yearly: 1999,
    trial_days: 0,
    features: JSON.stringify([
      'كل مميزات باقة بلس',
      'قائمة مراقبة غير محدودة',
      'محافظ استثمارية غير محدودة',
      'تنبيهات أسعار غير محدودة',
      'تحليل متقدم بالذكاء الاصطناعي',
      'توقعات الأسعار المتقدمة',
      'تقارير مخصصة',
      'دعم أولوي على مدار الساعة',
      'وصول مبكر للميزات الجديدة',
    ]),
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: true,
    deep_analysis: true,
    priority_support: true,
    is_active: true,
    sort_order: 2,
  },
];

async function seed() {
  console.log('🌱 Seeding subscription plans...');

  for (const plan of plans) {
    const upserted = await db.subscriptionPlan.upsert({
      where: { name: plan.name },
      update: {
        name_ar: plan.name_ar,
        price: plan.price,
        price_yearly: plan.price_yearly,
        trial_days: plan.trial_days,
        features: plan.features,
        max_watchlist: plan.max_watchlist,
        max_portfolio: plan.max_portfolio,
        max_alerts: plan.max_alerts,
        ai_analysis: plan.ai_analysis,
        deep_analysis: plan.deep_analysis,
        priority_support: plan.priority_support,
        is_active: plan.is_active,
        sort_order: plan.sort_order,
      },
      create: plan,
    });
    console.log(`  ✅ ${upserted.name_ar} (${upserted.name}) — ${upserted.price} EGP/month`);
  }

  console.log('🎉 Subscription plans seeded successfully!');
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
