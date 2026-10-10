/**
 * Mobile Crypto Learning API
 * تعلم العملات الرقمية
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const CRYPTO_LEARNING_CONTENT = [
  {
    id: 'intro',
    title: 'مقدمة في العملات الرقمية',
    title_en: 'Introduction to Cryptocurrency',
    category: 'basics',
    level: 'beginner',
    duration: '10 دقائق',
    content: `
      العملات الرقمية هي عملات رقمية أو افتراضية تستخدم التشفير للأمان.
      أهم ما يميزها:
      - اللامركزية: لا تخضع لسيطرة حكومية أو بنكية
      - الشفافية: جميع المعاملات مسجلة في البلوكتشين
      - الأمان: استخدام تقنية التشفير المتقدمة

      أشهر العملات:
      - Bitcoin (BTC): أول عملة رقمية وأشهرها
      - Ethereum (ETH): منصة للعقود الذكية
      - Solana (SOL): سريعة ومنخفضة التكلفة
    `,
    key_points: [
      'العملات الرقمية لا مركزية',
      'البلوكتشين هو سجل عام للمعاملات',
      'Bitcoin هي أول وأشهر عملة رقمية',
    ],
  },
  {
    id: 'trading',
    title: 'أساسيات تداول الكريبتو',
    title_en: 'Crypto Trading Basics',
    category: 'trading',
    level: 'beginner',
    duration: '15 دقيقة',
    content: `
      تداول العملات الرقمية يختلف عن تداول الأسهم التقليدية:

      1. السوق يعمل 24/7 على عكس البورصات التقليدية
      2. التقلبات أعلى بكثير - قد تصل إلى 20% في يوم واحد
      3. السيولة تختلف حسب العملة - Bitcoin و Ethereum سيولة عالية

      نصائح للمبتدئين:
      - ابدأ برأس مال قليل
      - تعلم التحليل الفني
      - لا تستثمر أكثر مما يمكنك خسارته
    `,
    key_points: [
      'السوق يعمل 24/7',
      'التقلبات عالية جداً',
      'ابدأ برأس مال قليل',
    ],
  },
  {
    id: 'risk',
    title: 'إدارة المخاطر في الكريبتو',
    title_en: 'Risk Management in Crypto',
    category: 'risk',
    level: 'intermediate',
    duration: '20 دقيقة',
    content: `
      إدارة المخاطر هي أهم مهارة للمتداول:

      1. تحديد حجم المركز: لا تضع أكثر من 2-5% من رأس المال في صفقة واحدة
      2. وقف الخسارة: حدد مستوى الخسارة الأقصى قبل الدخول
      3. التنويع: لا تضع كل أموالك في عملة واحدة
      4. جني الأرباح: حدد مستويات للبيع الجزئي

      قواعد ذهبية:
      - الخسارة الصغيرة أفضل من الخسارة الكبيرة
      - الصبر مفتاح النجاح
      - التعلم من الأخطاء
    `,
    key_points: [
      'لا تخاطر بأكثر من 5% في صفقة واحدة',
      'استخدم وقف الخسارة دائماً',
      'نوّع محفظتك',
    ],
  },
  {
    id: 'analysis',
    title: 'التحليل الفني للكريبتو',
    title_en: 'Technical Analysis for Crypto',
    category: 'analysis',
    level: 'intermediate',
    duration: '25 دقيقة',
    content: `
      التحليل الفني يستخدم الرسوم والمؤشرات للتنبؤ بالأسعار:

      المؤشرات الأساسية:
      - RSI: مؤشر القوة النسبية (تشبع شراء/بيع)
      - MACD: مؤشر التقارب والتباعد
      - Moving Averages: المتوسطات المتحركة

      أنماط الشموع:
      - Doji: تردد في السوق
      - Hammer: احتمال انعكاس صعودي
      - Shooting Star: احتمال انعكاس هبوطي

      مستويات الدعم والمقاومة:
      - الدعم: مستوى سعري يتوقع الشراء عنده
      - المقاومة: مستوى سعري يتوقع البيع عنده
    `,
    key_points: [
      'RSI أقل من 30 = تشبع بيع (فرصة شراء)',
      'RSI أعلى من 70 = تشبع شراء (فرصة بيع)',
      'المستويات التاريخية مهمة',
    ],
  },
  {
    id: 'defi',
    title: 'التمويل اللامركزي DeFi',
    title_en: 'Decentralized Finance',
    category: 'advanced',
    level: 'advanced',
    duration: '30 دقيقة',
    content: `
      DeFi هي خدمات مالية لامركزية على البلوكتشين:

      الخدمات الرئيسية:
      - الإقراض والاقتراض: Aave, Compound
      - التبادل اللامركزي: Uniswap, SushiSwap
      - السيولة: توفير سيولة مقابل عائد

      العائد من Staking:
      - تثبيت العملات مقابل عائد
      - يتراوح من 3% إلى 20% سنوياً

      المخاطر:
      - مخاطر العقد الذكي
      - مخاطر التقلب
      - مخاطر السيولة
    `,
    key_points: [
      'DeFi يوفر خدمات مالية بدون وسطاء',
      'Staking يوفر دخلاً سلبياً',
      'المخاطر أعلى من التداول التقليدي',
    ],
  },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const category = searchParams.get('category');
    const level = searchParams.get('level');

    let content = CRYPTO_LEARNING_CONTENT;

    // Filter by id
    if (id) {
      const item = content.find(c => c.id === id);
      if (item) {
        return NextResponse.json({
          success: true,
          content: item,
        });
      }
      return NextResponse.json({
        success: false,
        error: 'المحتوى غير موجود',
      }, { status: 404 });
    }

    // Filter by category
    if (category) {
      content = content.filter(c => c.category === category);
    }

    // Filter by level
    if (level) {
      content = content.filter(c => c.level === level);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      content,
      categories: ['basics', 'trading', 'risk', 'analysis', 'advanced'],
      levels: ['beginner', 'intermediate', 'advanced'],
    });
  } catch (error: any) {
    console.error('[Mobile Crypto Learning API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error' || 'خطأ في جلب المحتوى',
    }, { status: 500 });
  }
}
