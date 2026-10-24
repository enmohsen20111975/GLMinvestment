/**
 * ad-templates.ts — نصوص إعلانية ثابتة لكل ميزة (No AI / No LLM)
 * =====================================================================
 *
 * Production-ready: مفيش استدعاءات Ollama ولا أي LLM. كل النصوص مكتوبة
 * مسبقاً باحترافية لكل ميزة، وجاهزة للاستخدام فوراً.
 *
 * الفيديو صامت 100% — المستخدم بيضيف موسيقى تريند يدوياً وقت الرفع.
 */

export interface AdTemplate {
  feature: string;
  featureName: string;
  tagline: string;
  script: string;       // نص التعليق (للعرض كـ caption، مش TTS)
  caption: string;      // كابشن النشر على السوشيال
  hashtags: string[];
  scenes: {
    headline: string;
    subtext: string;
    /** المسار الحي اللي Playwright يلتقط منه screenshot */
    route?: string;
  }[];
}

export const AD_TEMPLATES: Record<string, AdTemplate> = {
  radar: {
    feature: 'radar',
    featureName: 'رادار السيولة',
    tagline: 'اكتشف فرص السهم قبل ما يتجمّع فيها',
    script: 'السيولة بتتجمّع قبل ما السهم يرتفع. رادار السيولة بيكتشف 5 مراحل دخول السيولة لحظيًا، ويرسل تنبيهات قبل الاختراق. استخدم رادار السيولة واحصل على فرص الاستثمار قبل غيرك.',
    caption: '🛰️ رادار السيولة — اكتشف الفرص قبل الجميع!\nاستثمر بحكمة وابقى خطوة قدّام',
    hashtags: ['#رادار_السيولة', '#بورصة_مصر', '#EGX', '#استثمار', '#تداول'],
    scenes: [
      {
        headline: 'رادار السيولة',
        subtext: 'اكتشف الفرص قبل التجمّع',
        route: '/#liquidity-radar',
      },
      {
        headline: '5 مراحل رصد',
        subtext: 'دخول السيولة لحظيًا',
        route: '/#liquidity-radar',
      },
      {
        headline: 'تنبيهات متقدمة',
        subtext: 'قبل الاختراق بوقت كافي',
        route: '/#liquidity-radar',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: 'التسجيل مجاني — 7 أيام تجربة',
      },
    ],
  },
  predictions: {
    feature: 'predictions',
    featureName: 'التوقعات',
    tagline: 'توقعات مبنيّة على باك-تست حقيقي',
    script: 'توقعات مبنيّة على 3 سنوات باك-تست حقيقي. 5 حالات للسهم: قيد التنفيذ، رابح، خاسر، مرفوض. ربط مباشر بالمحفظة والتتبّع.',
    caption: '🎯 التوقعات — توقعات مبنيّة على الأدلة\nباك-تست 3 سنوات + تتبّع لحظي',
    hashtags: ['#توقعات_الأسهم', '#باك_تست', '#EGX', '#استثمار', '#تحليل'],
    scenes: [
      {
        headline: 'التوقعات',
        subtext: 'نظام التحليل بعد 3 سنوات باك-تست',
        route: '/#predictions',
      },
      {
        headline: '5 حالات للسهم',
        subtext: 'قيد التنفيذ / رابح / خاسر / مرفوض',
        route: '/#predictions',
      },
      {
        headline: 'تتبّع لحظي',
        subtext: 'ربط مباشر بالمحفظة',
        route: '/#predictions',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: '7 أيام تجربة كاملة',
      },
    ],
  },
  portfolio: {
    feature: 'portfolio',
    featureName: 'المحفظة الذكية',
    tagline: 'إدارة محفظتك كأنك مدير صندوق',
    script: 'حاسبة العائد الحقيقي بعد التضخم. مستشار روبو لتحسين توزيع المخاطر. إنقاذ المحفظة الراكدة. كل ده في شاشة واحدة.',
    caption: '💼 المحفظة الذكية — إدارة احترافية لمحفظتك\nالعائد الحقيقي + مستشار روبو + إنقاذ الراكدة',
    hashtags: ['#محفظة_استثمارية', '#إدارة_المحافظ', '#EGX', '#استثمار', '#تداول'],
    scenes: [
      {
        headline: 'المحفظة الذكية',
        subtext: 'إدارة كأنك مدير صندوق',
        route: '/#portfolio',
      },
      {
        headline: 'العائد الحقيقي',
        subtext: 'بعد التضخم',
        route: '/#portfolio',
      },
      {
        headline: 'مستشار روبو',
        subtext: 'تحسين توزيع المخاطر',
        route: '/#portfolio',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: '7 أيام تجربة كاملة',
      },
    ],
  },
  risk: {
    feature: 'risk',
    featureName: 'حاسبة المخاطر',
    tagline: 'حدّد وقف الخسارة قبل ما تشتري',
    script: 'حساب حجم الصفقة تلقائيًا حسب مخاطرة 1-2%. نسبة المخاطرة/العائد قبل الدخول. تنبيه لو الصفقة مخاطرتها عالية.',
    caption: '🛡️ حاسبة المخاطر — احمِ رأس مالك قبل الشراء\nحجم الصفقة + وقف الخسارة + RR تلقائي',
    hashtags: ['#وقف_الخسارة', '#إدارة_المخاطر', '#EGX', '#تداول', '#مخاطر'],
    scenes: [
      {
        headline: 'حاسبة المخاطر',
        subtext: 'حدّد وقف الخسارة قبل الشراء',
        route: '/#portfolio',
      },
      {
        headline: 'حجم الصفقة',
        subtext: 'تلقائي حسب مخاطرة 1-2%',
        route: '/#portfolio',
      },
      {
        headline: 'نسبة RR',
        subtext: 'قبل ما تدخل',
        route: '/#portfolio',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: '7 أيام تجربة كاملة',
      },
    ],
  },
  stockcard: {
    feature: 'stockcard',
    featureName: 'كارت السهم الشامل',
    tagline: 'كل اللي محتاجه عن أي سهم',
    script: 'تحليل فني + أساسي + سيولة في شاشة واحدة. كروت جاهزة للنشر على تيليجرام وسوشيال. أيقونة ولوجو لكل شركة.',
    caption: '🪙 كارت السهم الشامل — تحليل كامل في كارت واحد\nفني + أساسي + سيولة + جاهز للنشر',
    hashtags: ['#تحليل_السهم', '#كارت_السهم', '#EGX', '#بورصة_مصر', '#تحليل'],
    scenes: [
      {
        headline: 'كارت السهم',
        subtext: 'كل اللي محتاجه في كارت',
        route: '/#stock-detail',
      },
      {
        headline: 'تحليل شامل',
        subtext: 'فني + أساسي + سيولة',
        route: '/#stock-detail',
      },
      {
        headline: 'جاهز للنشر',
        subtext: 'تيليجرام + سوشيال',
        route: '/#stock-detail',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: '7 أيام تجربة كاملة',
      },
    ],
  },
  alerts: {
    feature: 'alerts',
    featureName: 'مركز التنبيهات',
    tagline: 'المنصة بتكلّمك لما يحصل اللي يهمّك',
    script: 'تنبيهات متعددة المراحل للرادار. إشعارات صوتية + متصفح + بوش. متابعة لحظية للسهم اللي تختاره.',
    caption: '🔔 مركز التنبيهات — ما تفوّتش فرصة\nإشعارات لحظية + صوتية + بوش للرادار',
    hashtags: ['#تنبيهات_البورصة', '#متابعة_الأسهم', '#EGX', '#تداول', '#تنبيهات'],
    scenes: [
      {
        headline: 'مركز التنبيهات',
        subtext: 'المنصة بتكلّمك',
        route: '/#alerts',
      },
      {
        headline: 'إشعارات لحظية',
        subtext: 'صوتية + متصفح + بوش',
        route: '/#alerts',
      },
      {
        headline: 'متابعة السهم',
        subtext: 'لحظية للي تختاره',
        route: '/#alerts',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: '7 أيام تجربة كاملة',
      },
    ],
  },
  exit: {
    feature: 'exit',
    featureName: 'رادار الخروج',
    tagline: 'أهم قرار: إمتى تبيع؟',
    script: '5 مسارات خروج: توزيع قوي، تباعد حجمي، رفض مقاومة. تنبيهات إجهاد السهم قبل الانهيار. kill switch لحماية الأرباح.',
    caption: '🚪 رادار الخروج — أهم قرار: متى تبيع؟\n5 مسارات خروج + إجهاد السهم + kill switch',
    hashtags: ['#رادار_الخروج', '#متى_تبيع', '#EGX', '#تداول', '#أرباح'],
    scenes: [
      {
        headline: 'رادار الخروج',
        subtext: 'أهم قرار: إمتى تبيع؟',
        route: '/#exit-radar',
      },
      {
        headline: '5 مسارات خروج',
        subtext: 'توزيع + تباعد + رفض',
        route: '/#exit-radar',
      },
      {
        headline: 'kill switch',
        subtext: 'حماية الأرباح',
        route: '/#exit-radar',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: '7 أيام تجربة كاملة',
      },
    ],
  },
  academy: {
    feature: 'academy',
    featureName: 'أكاديمية التداول',
    tagline: 'اتعلّم من الصفر للاحتراف',
    script: '8 مستويات تعليمية: سيكولوجية، CANSLIM، Price Action. محاكي تداول ورقي للتدريب. دروس عربية مبسّطة.',
    caption: '🎓 أكاديمية التداول — تعلّم مجاناً من الصفر\n8 مستويات + محاكي + دروس عربية',
    hashtags: ['#تعلم_التداول', '#أكاديمية_التداول', '#EGX', '#بورصة', '#تعليم'],
    scenes: [
      {
        headline: 'أكاديمية التداول',
        subtext: 'من الصفر للاحتراف',
        route: '/#academy',
      },
      {
        headline: '8 مستويات',
        subtext: 'سيكولوجية + CANSLIM + Price Action',
        route: '/#academy',
      },
      {
        headline: 'محاكي تداول',
        subtext: 'ورقي للتدريب',
        route: '/#academy',
      },
      {
        headline: 'جرّب مجانًا',
        subtext: '7 أيام تجربة كاملة',
      },
    ],
  },
};

/** قائمة الميزات المتاحة للاختيار في الـ UI */
export const AD_FEATURE_LIST = Object.keys(AD_TEMPLATES).map((key) => ({
  value: key,
  label: AD_TEMPLATES[key].featureName,
}));

/** دالة مساعدة لجلب template بميزة معيّنة */
export function getAdTemplate(feature: string): AdTemplate {
  return AD_TEMPLATES[feature] || AD_TEMPLATES.radar;
}
