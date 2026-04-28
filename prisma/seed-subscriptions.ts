import { db } from '../src/lib/db';

async function main() {
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

  for (const plan of plans) {
    await db.subscriptionPlan.upsert({
      where: { id: plan.id },
      update: plan,
      create: plan
    });
    console.log(`✓ Created/Updated plan: ${plan.name_ar} (${plan.name}) - ${plan.price} ج.م/شهر`);
  }

  console.log('\n✅ Subscription plans seeded successfully!');
  console.log('\n📋 Summary:');
  console.log('   - مجاني (Free): 0 ج.م - 5 أسهم مراقبة، 3 تنبيهات');
  console.log('   - بلس (Plus): 99 ج.م/شهر - 25 سهم، تنبيهات غير محدودة');
  console.log('   - بريميوم (Premium): 199 ج.م/شهر - غير محدود + AI');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding subscription plans:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
