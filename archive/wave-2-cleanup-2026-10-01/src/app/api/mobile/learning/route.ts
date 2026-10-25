/**
 * Mobile Learning API - Educational Content
 * المحتوى التعليمي
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const LEARNING_CONTENT = [
  // Basics
  {
    id: 'what-is-stock',
    title: 'ما هي الأسهم؟',
    title_en: 'What are Stocks?',
    category: 'basics',
    level: 'beginner',
    duration: '10 دقائق',
    content: `
      السهم هو حصة في ملكية شركة. عندما تشتري سهماً، تصبح مالكاً لجزء من الشركة.

      أنواع الأسهم:
      - الأسهم العادية: تعطي حق التصويت في الجمعية العمومية
      - الأسهم الممتازة: أولوية في الأرباح ولكن بدون حق التصويت

      كيف تربح من الأسهم:
      1. ارتفاع سعر السهم (الربح الرأسمالي)
      2. توزيعات الأرباح (الأرباح السنوية)

      البورصة المصرية (EGX):
      - تأسست عام 1883
      - تعمل من الأحد للخميس
      - جلسة التداول: 10:00 ص - 2:30 م
    `,
    key_points: [
      'السهم = حصة في ملكية شركة',
      'الربح من ارتفاع السعر أو التوزيعات',
      'EGX من أقدم البورصات في المنطقة',
    ],
  },
  {
    id: 'how-to-start',
    title: 'كيف تبدأ الاستثمار؟',
    title_en: 'How to Start Investing?',
    category: 'basics',
    level: 'beginner',
    duration: '15 دقيقة',
    content: `
      خطوات البدء في الاستثمار:

      1. افتح حساب تداول
         - اختر شركة وساطة مرخصة
         - قدم الأوراق المطلوبة
         - أودع المبلغ المراد استثماره

      2. تعلم الأساسيات
         - افهم البيانات المالية
         - تعلم التحليل الفني
         - تابع أخبار السوق

      3. ابدأ ببطء
         - لا تستثمر كل أموالك مرة واحدة
         - ابدأ بالأسهم الكبيرة والمستقرة
         - تنويع المحفظة

      4. استمر في التعلم
         - راجع أداء استثماراتك
         - تعلم من أخطائك
         - طور استراتيجيتك
    `,
    key_points: [
      'افتح حساب مع وسيط مرخص',
      'تعلم قبل أن تستثمر',
      'ابدأ ببطء وتدرج',
    ],
  },

  // Analysis
  {
    id: 'fundamental-analysis',
    title: 'التحليل الأساسي',
    title_en: 'Fundamental Analysis',
    category: 'analysis',
    level: 'intermediate',
    duration: '20 دقيقة',
    content: `
      التحليل الأساسي يركز على قيمة الشركة الحقيقية:

      المؤشرات المهمة:
      - P/E (السعر للربح): كلما انخفض كان أفضل
      - P/B (السعر للقيمة الدفترية): يقيم بسعر السهم مقارنة بأصول الشركة
      - ROE (العائد على حقوق الملكية): كلما ارتفع كان أفضل
      - EPS (ربح السهم): الأرباح الموزعة على كل سهم

      البيانات المالية:
      - قائمة الدخل: الإيرادات والمصروفات والأرباح
      - الميزانية: الأصول والالتزامات
      - قائمة التدفقات النقدية: حركة النقد

      نصائح:
      - قارن مع شركات نفس القطاع
      - راقب نمو الأرباح
      - انتبه للديون
    `,
    key_points: [
      'P/E منخفض = قد يكون السهم رخيص',
      'ROE مرتفع = إدارة فعالة',
      'النمو المستمر = استثمار جيد',
    ],
  },
  {
    id: 'technical-analysis',
    title: 'التحليل الفني',
    title_en: 'Technical Analysis',
    category: 'analysis',
    level: 'intermediate',
    duration: '25 دقيقة',
    content: `
      التحليل الفني يستخدم الرسوم للتنبؤ بالأسعار:

      المؤشرات الأساسية:
      - المتوسطات المتحركة (MA): اتجاه السوق
      - RSI: مؤشر القوة النسبية
      - MACD: مؤشر الزخم

      أنماط الشموع اليابانية:
      - الشمعة الخضراء: إغلاق أعلى من الفتح (صعود)
      - الشمعة الحمراء: إغلاق أقل من الفتح (هبوط)
      - Doji: تردد في السوق

      الدعم والمقاومة:
      - الدعم: مستوى يتوقع الشراء عنده
      - المقاومة: مستوى يتوقع البيع عنده

      نصائح للتطبيق:
      - لا تعتمد على مؤشر واحد فقط
      - ادمج التحليل الأساسي والفني
      - التزم بخطة التداول
    `,
    key_points: [
      'MA50 فوق MA200 = اتجاه صعودي',
      'RSI < 30 = تشبع بيع',
      'RSI > 70 = تشبع شراء',
    ],
  },

  // Risk Management
  {
    id: 'risk-management',
    title: 'إدارة المخاطر',
    title_en: 'Risk Management',
    category: 'risk',
    level: 'intermediate',
    duration: '15 دقيقة',
    content: `
      إدارة المخاطر أهم من اختيار الأسهم:

      قواعد ذهبية:
      1. لا تضع كل أموالك في سهم واحد
      2. حدد مستوى الخسارة الأقصى (وقف الخسارة)
      3. لا تزيد حجم الصفقة عن 5-10% من المحفظة

      التنويع:
      - استثمر في قطاعات مختلفة
      - لا تركز على سهم واحد
      - فكر في الذهب والعملات

      وقف الخسارة:
      - حدده قبل الدخول في الصفقة
      - لا تحركه لأسفل
      - التزم به بصرامة

      إدارة الأرباح:
      - جني الأرباح جزئياً
      - لا تطمع
      - استخدم وقف الربح المتحرك
    `,
    key_points: [
      'التنويع يقلل المخاطر',
      'وقف الخسارة إجباري',
      'لا تطمع في الأرباح',
    ],
  },

  // Strategies
  {
    id: 'investment-strategies',
    title: 'استراتيجيات الاستثمار',
    title_en: 'Investment Strategies',
    category: 'strategies',
    level: 'advanced',
    duration: '20 دقيقة',
    content: `
      استراتيجيات مختلفة لأهداف مختلفة:

      1. الاستثمار طويل الأمد
         - شراء أسهم قوية والاحتفاظ
         - الاستفادة من النمو والتوزيعات
         - مناسب للمبتدئين

      2. التداول اليومي
         - شراء وبيع في نفس اليوم
         - يحتاج خبرة ووقت
         - مخاطرة عالية

      3. التأرجح (Swing)
         - الاحتفاظ لأيام أو أسابيع
         - الاستفادة من التقلبات
         - يحتاج تحليلاً فنياً جيداً

      4. التوزيع الدوري (DCA)
         - استثمار مبلغ ثابت دورياً
         - يقلل تأثير التقلبات
         - مناسب للدخل الثابت
    `,
    key_points: [
      'كل استراتيجية لها مزايا وعيوب',
      'اختر ما يناسب شخصيتك ووقتك',
      'DCA الأفضل للمبتدئين',
    ],
  },

  // Islamic
  {
    id: 'islamic-investing',
    title: 'الاستثمار الإسلامي',
    title_en: 'Islamic Investing',
    category: 'islamic',
    level: 'intermediate',
    duration: '20 دقيقة',
    content: `
      ضوابط الاستثمار الإسلامي:

      المعايير الشرعية:
      - تجنب الربا
      - تجنب الغرر (المخاطرة المفرطة)
      - تجنب الحرام (الخمر، القمار، إلخ)

      أسهم الحلال:
      - نشاط الشركة مباح
      - نسبة الديون أقل من 33%
      - نسبة السيولة أقل من 33%
      - نسبة الربا أقل من 33%

      الفتاوى المهمة:
      - يجوز تداول الأسهم بشروط
      - يجب تطهير الربح من الحرام
      - الشركات المختلطة تنظر حالة بحالة

      نصيحة:
      - راجع قوائم الأسهم الحلال المعتمدة
      - احسب الزكاة على أرباحك
      - استشر أهل العلم
    `,
    key_points: [
      'تجنب شركات الربا والحرام',
      'راجع المعايير الشرعية',
      'طهّر أرباحك من الحرام',
    ],
  },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const category = searchParams.get('category');
    const level = searchParams.get('level');

    let content = LEARNING_CONTENT;

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

    if (category) {
      content = content.filter(c => c.category === category);
    }

    if (level) {
      content = content.filter(c => c.level === level);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      content,
      categories: ['basics', 'analysis', 'risk', 'strategies', 'islamic'],
      levels: ['beginner', 'intermediate', 'advanced'],
      total: content.length,
    });
  } catch (error: any) {
    console.error('[Mobile Learning API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error' || 'خطأ في جلب المحتوى',
    }, { status: 500 });
  }
}
