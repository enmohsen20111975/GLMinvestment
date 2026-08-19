// ============================================================================
// مساعد الاستثمار Flutter - Academy Encyclopedia Screen (P40 Pillar 4)
// الموسوعة التعليمية الشاملة — 12 درس + اختبارات تفاعلية
// ============================================================================

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/colors.dart';

class AcademyEncyclopediaScreen extends StatefulWidget {
  const AcademyEncyclopediaScreen({super.key});

  @override
  State<AcademyEncyclopediaScreen> createState() => _AcademyEncyclopediaScreenState();
}

class _AcademyEncyclopediaScreenState extends State<AcademyEncyclopediaScreen> {
  int _selectedLesson = 0;
  Set<String> _completed = {};
  Map<String, int> _quizScores = {};

  static const _lessons = [
    _Lesson(
      id: 'what-is-stock-market',
      category: 'الأساسيات',
      title: 'ما هي البورصة؟',
      emoji: '🏛️',
      level: 'مبتدئ',
      duration: 8,
      sections: [
        _Section(
          heading: 'تعريف البورصة',
          body: 'البورصة سوق منظمة يتم فيها تداول الأوراق المالية (الأسهم والسندات) بأسعار تحددها قوى العرض والطلب. البورصة المصرية (EGX) هي السوق الرسمي لتداول أسهم الشركات المصرية.',
          keyPoints: ['سوق منظم ومرخّص', 'أسعار تحددها العرض والطلب', 'إشراف هيئة الرقابة المالية'],
        ),
        _Section(
          heading: 'كيف تربح من الأسهم؟',
          body: '1) ارتفاع السعر: تشتري السهم بسعر منخفض وتبيعه بسعر أعلى. 2) التوزيعات: الشركات المربحة توزّع جزءاً من أرباحها على المساهمين. بعض الأسهم توزّع سنوياً (مثل CIB، TMG).',
          keyPoints: ['فرق السعر (Capital Gain)', 'التوزيعات النقدية (Dividends)', 'بعض الأسهم تجمع الاثنين'],
        ),
      ],
      quiz: [
        _Quiz(q: 'ما المقصود بالبورصة؟', options: ['سوق لبيع السيارات', 'سوق منظمة لتداول الأوراق المالية', 'متجر إلكتروني', 'بنك'], correct: 1, explanation: 'البورصة سوق منظمة لتداول الأسهم والسندات.'),
        _Quiz(q: 'كيف تربح من الأسهم؟', options: ['فقط من ارتفاع السعر', 'فقط من التوزيعات', 'من ارتفاع السعر + التوزيعات', 'لا توجد طريقة'], correct: 2, explanation: 'الربح يأتي من فرق السعر ومن التوزيعات النقدية.'),
        _Quiz(q: 'ما اسم البورصة المصرية؟', options: ['EGX', 'TADAWUL', 'NYSE', 'LSE'], correct: 0, explanation: 'EGX = Egyptian Exchange.'),
      ],
    ),
    _Lesson(
      id: 'how-to-read-chart',
      category: 'الأساسيات',
      title: 'كيف تقرأ الشارت؟',
      emoji: '📊',
      level: 'مبتدئ',
      duration: 12,
      sections: [
        _Section(
          heading: 'أنواع الشارت',
          body: '1) الخطي (Line): يصل نقاط الإغلاق. 2) الشموع اليابانية (Candlestick): يُظهر الافتتاح/الأعلى/الأدنى/الإغلاق. 3) الأعمدة (Bar): مشابه للشموع بدون أجسام.',
          keyPoints: ['الخطي: بساطة', 'الشموع: معلومات غنية', 'الأعمدة: كلاسيكي'],
        ),
        _Section(
          heading: 'مكونات الشمعة',
          body: 'الجسم (Body): الفرق بين الافتتاح والإغلاق. الفتيل العلوي (Upper Wick): أعلى سعر. الفتيل السفلي (Lower Wick): أدنى سعر. الجسم الأخضر = إغلاق أعلى من افتتاح (صاعد). الأحمر = العكس.',
          keyPoints: ['الجسم = |الإغلاق - الافتتاح|', 'الفتيل العلوي = أعلى سعر', 'الفتيل السفلي = أدنى سعر'],
        ),
      ],
      quiz: [
        _Quiz(q: 'ماذا يمثل جسم الشمعة؟', options: ['أعلى سعر', 'الفرق بين الافتتاح والإغلاق', 'حجم التداول', 'السعر المتوسط'], correct: 1, explanation: 'الجسم = |الإغلاق - الافتتاح|.'),
        _Quiz(q: 'الشمعة الخضراء تعني؟', options: ['السعر هبط', 'السعر صعد', 'لا تغيير', 'السوق مغلق'], correct: 1, explanation: 'الأخضر = الإغلاق أعلى من الافتتاح = صاعد.'),
        _Quiz(q: 'ماذا يُظهر الفتيل العلوي؟', options: ['أدنى سعر', 'أعلى سعر', 'سعر الإغلاق', 'حجم التداول'], correct: 1, explanation: 'الفتيل العلوي يمتد لأعلى سعر في الجلسة.'),
      ],
    ),
    _Lesson(
      id: 'order-types',
      category: 'الأساسيات',
      title: 'أنواع الأوامر (Market/Limit/Stop)',
      emoji: '📝',
      level: 'مبتدئ',
      duration: 10,
      sections: [
        _Section(
          heading: 'أمر السوق (Market Order)',
          body: 'تنفيذ فوري بأفضل سعر متاح في السوق. ميزته: سرعة التنفيذ. عيبه: قد تحصل على سعر مختلف عن المتوقع في الأسهم قليلة السيولة.',
          keyPoints: ['تنفيذ فوري', 'أفضل سعر متاح', 'يناسب الأسهم عالية السيولة'],
        ),
        _Section(
          heading: 'الأمر المحدد (Limit Order)',
          body: 'تحدد السعر الذي تريد الشراء/البيع به. لا يُنفّذ إلا عند وصول السوق لسعرك. ميزته: تحكم كامل في السعر. عيبه: قد لا يُنفّذ أبداً.',
          keyPoints: ['سعر محدد مسبقاً', 'ضمان السعر وليس التنفيذ', 'يناسب التداول الدقيق'],
        ),
      ],
      quiz: [
        _Quiz(q: 'متى يُنفّذ أمر السوق؟', options: ['عند سعر محدد', 'فوراً بأفضل سعر', 'في نهاية اليوم', 'لا يُنفّذ'], correct: 1, explanation: 'Market order = تنفيذ فوري.'),
        _Quiz(q: 'ما عيب أمر السوق؟', options: ['بطء التنفيذ', 'سعر مختلف عن المتوقع', 'لا يُنفّذ أبداً', 'يتطلب موافقة'], correct: 1, explanation: 'في الأسهم قليلة السيولة قد تحصل على سعر أسوأ.'),
        _Quiz(q: 'متى تستخدم Limit Order؟', options: ['عند الاستعجال', 'عند تحكمك في السعر', 'دائماً', 'أبداً'], correct: 1, explanation: 'Limit يناسب التداول الدقيق بأسعار محددة.'),
      ],
    ),
    _Lesson(
      id: 'rsi-indicator',
      category: 'تحليل فني',
      title: 'مؤشر RSI وكيفية استخدامه',
      emoji: '📈',
      level: 'متوسط',
      duration: 15,
      sections: [
        _Section(
          heading: 'ما هو RSI؟',
          body: 'مؤشر القوة النسبية (Relative Strength Index) يقيس سرعة وتغيير حركات السعر من 0 إلى 100. فوق 70 = تشبّع شرائي (قد يهبط). تحت 30 = تشبّع بيعي (قد يصعد).',
          keyPoints: ['مدى 0-100', 'فوق 70 = تشبّع شرائي', 'تحت 30 = تشبّع بيعي'],
        ),
        _Section(
          heading: 'التقاطع السلبي (Divergence)',
          body: 'عندما يصنع السعر قمة أعلى بينما RSI يصنع قمة أقل — هذا تحذير من ضعف الزخم. عكسه (قاع أدنى في السعر + قاع أعلى في RSI) إشارة شراء.',
          keyPoints: ['Bearish: سعر أعلى + RSI أقل', 'Bullish: سعر أدنى + RSI أعلى', 'إشارة انعكاس محتملة'],
        ),
      ],
      quiz: [
        _Quiz(q: 'RSI فوق 70 يعني؟', options: ['سعر رخيص', 'تشبّع شرائي', 'شراء قوي', 'سوق هابط'], correct: 1, explanation: 'فوق 70 = تشبّع شرائي، قد يهبط السعر.'),
        _Quiz(q: 'RSI تحت 30 يعني؟', options: ['تشبّع بيعي', 'شراء عاجل', 'سعر مرتفع', 'لا إشارة'], correct: 0, explanation: 'تحت 30 = تشبّع بيعي، قد يصعد السعر.'),
        _Quiz(q: 'ما هو التقاطع السلبي؟', options: ['سعر أعلى + RSI أقل', 'سعر أقل + RSI أعلى', 'RSI = 50', 'لا شيء'], correct: 0, explanation: 'Bearish divergence = ضعف زخم الصعود.'),
      ],
    ),
    _Lesson(
      id: 'candlestick-patterns',
      category: 'تحليل فني',
      title: 'نماذج الشموع اليابانية',
      emoji: '🕯️',
      level: 'متوسط',
      duration: 18,
      sections: [
        _Section(
          heading: 'الشموع الصاعدة',
          body: '1) المطرقة (Hammer): جسم صغير بأعلى + فتيل سفلي طويل = إشارة شراء. 2) الابتلاع الصاعد: شمعة خضراء كبيرة تبتلع شمعة حمراء سابقة. 3) الجنود الثلاثة: 3 شموع خضراء متتالية صاعدة.',
          keyPoints: ['Hammer = ارتداد صاعد', 'Bullish Engulfing = قوة شراء', 'Three White Soldiers = استمرار صعود'],
        ),
        _Section(
          heading: 'الشموع الهابطة',
          body: '1) النجم الهابط (Shooting Star): جسم صغير بأسفل + فتيل علوي طويل = إشارة بيع. 2) الابتلاع الهابط: شمعة حمراء كبيرة تبتلع خضراء. 3) الغربان الثلاثة: 3 شموع حمراء متتالية هابطة.',
          keyPoints: ['Shooting Star = رفض السقف', 'Bearish Engulfing = قوة بيع', 'Three Black Crows = استمرار هبوط'],
        ),
      ],
      quiz: [
        _Quiz(q: 'ما هي المطرقة (Hammer)؟', options: ['شمعة هابطة', 'جسم صغير + فتيل سفلي طويل', '3 شموع خضراء', 'شمعة بدون فتيل'], correct: 1, explanation: 'Hammer = جسم صغير بأعلى + فتيل سفلي طويل.'),
        _Quiz(q: 'الابتلاع الصاعد يعني؟', options: ['شمعة حمراء كبيرة', 'شمعة خضراء تبتلع حمراء', '3 شموع', 'شمعة منفردة'], correct: 1, explanation: 'Bullish Engulfing = قوة شرائية.'),
        _Quiz(q: 'Shooting Star إشارة؟', options: ['شراء', 'بيع', 'انتظار', 'محايدة'], correct: 1, explanation: 'Shooting Star = إشارة بيع.'),
      ],
    ),
    _Lesson(
      id: 'financial-statements',
      category: 'تحليل مالي',
      title: 'تحليل القوائم المالية',
      emoji: '📋',
      level: 'متوسط',
      duration: 20,
      sections: [
        _Section(
          heading: 'القوائم الثلاث',
          body: '1) قائمة الدخل (Income Statement): الإيرادات والمصروفات وصافي الربح. 2) الميزانية العمومية (Balance Sheet): الأصول والخصوم وحقوق الملكية. 3) قائمة التدفقات النقدية (Cash Flow): النقد الداخل والخارج.',
          keyPoints: ['الدخل: ربحية الشركة', 'الميزانية: مركزها المالي', 'التدفقات: سيولتها'],
        ),
        _Section(
          heading: 'أهم النسب',
          body: '1) ROE = صافي الربح ÷ حقوق الملكية (أعلى من 15% ممتاز). 2) Debt/Equity = إجمالي الديون ÷ حقوق الملكية (أقل من 1 جيد). 3) Current Ratio = الأصول المتداولة ÷ الخصوم المتداولة (أعلى من 1.5 آمن).',
          keyPoints: ['ROE > 15% ممتاز', 'D/E < 1 آمن', 'Current > 1.5 سيولة جيدة'],
        ),
      ],
      quiz: [
        _Quiz(q: 'ماذا تُظهر قائمة الدخل؟', options: ['الأصول', 'الإيرادات والمصروفات', 'النقد', 'الديون'], correct: 1, explanation: 'Income Statement = إيرادات - مصروفات = صافي الربح.'),
        _Quiz(q: 'ROE مرتفع يعني؟', options: ['ديون مرتفعة', 'كفاءة عالية في استخدام حقوق الملكية', 'خسارة', 'سيولة منخفضة'], correct: 1, explanation: 'ROE > 15% = كفاءة ممتازة.'),
        _Quiz(q: 'Current Ratio آمن يكون؟', options: ['أقل من 0.5', 'أعلى من 1.5', 'يساوي 0', 'أعلى من 10'], correct: 1, explanation: 'أعلى من 1.5 = سيولة جيدة.'),
      ],
    ),
    _Lesson(
      id: 'pe-ratio',
      category: 'تحليل مالي',
      title: 'مكرر الربح P/E والقيمة العادلة',
      emoji: '💰',
      level: 'متوسط',
      duration: 14,
      sections: [
        _Section(
          heading: 'حساب P/E',
          body: 'P/E = سعر السهم ÷ ربحية السهم (EPS). مثال: سهم بسعر 100 ج.م و EPS=10 → P/E=10. يعني المستثمر يدفع 10 أضعاف الربح السنوي للسهم.',
          keyPoints: ['P/E = Price ÷ EPS', 'منخفض = رخيص', 'مرتفع = مبالغ'],
        ),
        _Section(
          heading: 'متى يكون P/E منخفضاً مفيداً؟',
          body: 'عندما يكون أقل من متوسط القطاع + الشركة تنمو + ربحية مستقرة. مثال: قطاع البنوك EGX متوسط P/E=8، لو لقيت بنك بـ P/E=5 + نمو أرباح 15% = فرصة.',
          keyPoints: ['قارن بمتوسط القطاع', 'تحقق من نمو الأرباح', 'تأكد من استقرار الربحية'],
        ),
      ],
      quiz: [
        _Quiz(q: 'كيف يُحسب P/E؟', options: ['سعر × EPS', 'سعر ÷ EPS', 'EPS ÷ سعر', 'سعر + EPS'], correct: 1, explanation: 'P/E = Price ÷ EPS.'),
        _Quiz(q: 'P/E منخفض عن متوسط القطاع يعني؟', options: ['سهم غالي', 'سهم رخيص', 'لا علاقة', 'خسارة'], correct: 1, explanation: 'منخفض = رخيص نسبياً.'),
        _Quiz(q: 'متى يكون P/E منخفض مفيد؟', options: ['دائماً', 'مع نمو أرباح + استقرار', 'مع خسائر', 'أبداً'], correct: 1, explanation: 'يحتاج نمو + استقرار.'),
      ],
    ),
    _Lesson(
      id: 'order-blocks',
      category: 'SMC',
      title: 'كتل الطلب Order Blocks',
      emoji: '🧱',
      level: 'متقدم',
      duration: 16,
      sections: [
        _Section(
          heading: 'تعريف كتلة الطلب',
          body: 'كتلة الطلب هي آخر شمعة هابطة (حمراء) قبل اندفاع صاعد قوي. تعمل كدعم عند عودة السعر لها. السبب: صانع السوق يجمع أوامر شرائه قبل الاندفاع.',
          keyPoints: ['آخر شمعة حمراء قبل الصعود', 'دعم مستقبلي محتمل', 'تجمع أوامر المؤسسات'],
        ),
        _Section(
          heading: 'كيف تتداولها',
          body: '1) حدد آخر شمعة حمراء قبل الاندفاع. 2) ارسم مستطيل على نطاق الشمعة (من High إلى Low). 3) انتظر عودة السعر لهذه المنطقة. 4) ادخل شراء عند لمس الحد السفلي مع وقف أسفله.',
          keyPoints: ['حدد الشمعة', 'ارسم المنطقة', 'انتظر العودة', 'ادخل مع وقف'],
        ),
      ],
      quiz: [
        _Quiz(q: 'ما هي كتلة الطلب؟', options: ['أول شمعة خضراء', 'آخر شمعة حمراء قبل الصعود', 'أعلى قمة', 'أدنى قاع'], correct: 1, explanation: 'Order Block = آخر شمعة حمراء قبل الاندفاع.'),
        _Quiz(q: 'لماذا تعمل كدعم؟', options: ['صدفة', 'تجمع أوامر المؤسسات', 'قانون', 'لا تعمل'], correct: 1, explanation: 'صانع السوق يجمع أوامره هناك.'),
        _Quiz(q: 'أين تضع الوقف؟', options: ['فوق الكتلة', 'أسفل الكتلة', 'في منتصفها', 'بدون وقف'], correct: 1, explanation: 'أسفل الكتلة = بطلان الفكرة.'),
      ],
    ),
    _Lesson(
      id: 'fvg',
      category: 'SMC',
      title: 'الفجوات السعرية FVG',
      emoji: '📊',
      level: 'متقدم',
      duration: 14,
      sections: [
        _Section(
          heading: 'تعريف FVG',
          body: 'الفجوة السعرية تحدث عندما يتحرك السعر بسرعة فلا يتداخل جسم الشمعة الأولى مع جسم الشمعة الثالثة. تُترك "فجوة" غير مملوءة في الشارت.',
          keyPoints: ['3 شموع', 'الشمعة 2 طويلة', 'جسم 1 و 3 لا يتداخلان'],
        ),
        _Section(
          heading: 'لماذا يملأ السعر الفجوة؟',
          body: 'السعر يبحث عن السيولة — الفجوات تمثل مناطق فارغة تجذب السعر. غالباً يعود لملئها قبل استكمال الاتجاه الأصلي. تستخدم كنقاط دخول.',
          keyPoints: ['الفجوة = فراغ سيولة', 'السعر يعود لملئها', 'نقطة دخول محتملة'],
        ),
      ],
      quiz: [
        _Quiz(q: 'متى تحدث FVG؟', options: ['شمعة واحدة', '3 شموع بدون تداخل', '5 شموع', '10 شموع'], correct: 1, explanation: 'FVG = 3 شموع، جسم 1 و 3 لا يتداخلان.'),
        _Quiz(q: 'لماذا يعود السعر للفجوة؟', options: ['صدفة', 'يبحث عن السيولة', 'قانون', 'لا يعود'], correct: 1, explanation: 'الفجوة = منطقة جذب سيولة.'),
        _Quiz(q: 'FVG تستخدم كـ؟', options: ['مقاومة فقط', 'دعم ومقاومة ديناميكية', 'لا شيء', 'سعر عشوائي'], correct: 1, explanation: 'تستخدم كدعم/مقاومة ديناميكية.'),
      ],
    ),
    _Lesson(
      id: 'risk-management',
      category: 'إدارة المخاطر',
      title: 'إدارة المخاطر وتحجيم الصفقة',
      emoji: '🛡️',
      level: 'متوسط',
      duration: 16,
      sections: [
        _Section(
          heading: 'قاعدة 1-2%',
          body: 'لا تخاطر بأكثر من 1-2% من رأس مالك في صفقة واحدة. لو محفظتك 100,000 ج.م، أقصى خسارة في صفقة = 1,000-2,000 ج.م. هذا يحفظ رأس المال من الانهيار.',
          keyPoints: ['1-2% كحد أقصى للخسارة', 'حفظ رأس المال أولاً', 'العوائد تأتي لاحقاً'],
        ),
        _Section(
          heading: 'تحجيم الصفقة',
          body: 'حجم الصفقة = (رأس المال × نسبة المخاطفة) ÷ (سعر الدخول - وقف الخسارة). مثال: 100,000 × 1% = 1,000 خسارة مسموحة. لو الفرق بين الدخول والوقف = 2 ج.م → اشترِ 500 سهم.',
          keyPoints: ['حدد الخسارة المسموحة أولاً', 'اقسم على فرق الدخول والوقف', 'النتيجة = عدد الأسهم'],
        ),
      ],
      quiz: [
        _Quiz(q: 'كم نسبة المخاطفة القصوى؟', options: ['10%', '1-2%', '50%', '100%'], correct: 1, explanation: '1-2% تحفظ رأس المال.'),
        _Quiz(q: 'لو محفظتك 100,000 كم خسارة مسموحة؟', options: ['50,000', '1,000-2,000', '10,000', '0'], correct: 1, explanation: '1% = 1,000، 2% = 2,000.'),
        _Quiz(q: 'كيف تحسب حجم الصفقة؟', options: ['عشوائي', 'الخسارة المسموحة ÷ فرق الدخول والوقف', 'رأس المال كاملاً', 'حسب المزاج'], correct: 1, explanation: 'حجم الصفقة = المخاطفة À (الدخول - الوقف).'),
      ],
    ),
    _Lesson(
      id: 'stop-loss',
      category: 'إدارة المخاطر',
      title: 'وقف الخسارة ووقف التداول',
      emoji: '🚦',
      level: 'متوسط',
      duration: 12,
      sections: [
        _Section(
          heading: 'أنواع وقف الخسارة',
          body: '1) وقف ثابت: سعر محدد لا يتغير. 2) وقف متحرك (Trailing): يتحرك مع السعر لتفعيل الربح. 3) وقف بناءً على ATR: يأخذ في الاعتبار تقلب السهم.',
          keyPoints: ['ثابت: بساطة', 'متحرك: تأمين ربح', 'ATR: يتناسب مع التقلب'],
        ),
        _Section(
          heading: 'وقف التداول اليومي',
          body: 'حدد خسارة قصوى يومية (مثلاً 3% من المحفظة). إذا وصلتها، أوقف التداول بقية اليوم. هذا يحميك من قرارات انتقامية بعد خسارة كبيرة.',
          keyPoints: ['3% كحد أقصى يومي', 'أوقف عند الوصول', 'لا تنتقم من السوق'],
        ),
      ],
      quiz: [
        _Quiz(q: 'ما هو الوقف المتحرك؟', options: ['سعر ثابت', 'يتحرك مع السعر', 'لا يوجد', 'وقف عشوائي'], correct: 1, explanation: 'Trailing stop يتحرك مع السعر لتفعيل الربح.'),
        _Quiz(q: 'ما الحد الأقصى للخسارة اليومية؟', options: ['10%', '3%', '50%', 'لا حد'], correct: 1, explanation: '3% حد معقول ليومي.'),
        _Quiz(q: 'لماذا توقف عند الخسارة اليومية؟', options: ['للانتقام', 'لتجنب القرارات الانفعالية', 'لسترة السوق', 'لا فائدة'], correct: 1, explanation: 'يحميك من قرارات الاندفاع.'),
      ],
    ),
    _Lesson(
      id: 'trading-psychology',
      category: 'سيكولوجية',
      title: 'سيكولوجية المتداول',
      emoji: '🧠',
      level: 'متوسط',
      duration: 18,
      sections: [
        _Section(
          heading: 'الفخوخ النفسية',
          body: '1) الطمع: تكبير الصفقة بعد ربح. 2) الخوف: إغلاق الصفقة الرابحة مبكراً. 3) الانتقام: فتح صفقات متهورة بعد خسارة. 4) التعلق: التمسك بالسهم الخاسر على أمل العودة.',
          keyPoints: ['الطمع → تكبير متهور', 'الخوف → إغلاق مبكر', 'الانتقام → صفقات عشوائية'],
        ),
        _Section(
          heading: 'كيف تتحكم في مشاعرك',
          body: '1) اكتب خطة قبل الدخول (دخول/وقف/هدف). 2) لا تبتعد عن الخطة مهما حدث. 3) سجّل صفقاتك ومشاعرك في يومية. 4) خذ استراحة بعد خسارة كبيرة. 5) تذكر: الخسارة جزء من اللعبة.',
          keyPoints: ['خطط مسبقاً', 'التزم بالخطة', 'سجّل يومياً', 'استرح بعد الخسارة'],
        ),
      ],
      quiz: [
        _Quiz(q: 'ما هو فخ الانتقام؟', options: ['ربح كبير', 'صفقات متهورة بعد خسارة', 'شراء سهم جيد', 'بيع سهم رابح'], correct: 1, explanation: 'الانتقام = محاولة تعويض الخسارة بسرعة.'),
        _Quiz(q: 'كيف تتجنب الطمع؟', options: ['تكبير الصفقة', 'التزام بحجم ثابت', 'مضاعفة المخاطرة', 'لا تتوقف'], correct: 1, explanation: 'حجم ثابت يحمي من الطمع.'),
        _Quiz(q: 'ماذا تفعل بعد خسارة كبيرة؟', options: ['تابع التداول', 'استرح', 'ضاعف', 'أغلق الحساب'], correct: 1, explanation: 'الاستراحة تحمي من قرارات انفعالية.'),
      ],
    ),
  ];

  @override
  void initState() {
    super.initState();
    _loadProgress();
  }

  Future<void> _loadProgress() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _completed = (prefs.getStringList('academy_completed') ?? []).toSet();
      final scoresJson = prefs.getString('academy_quiz_scores');
      if (scoresJson != null) {
        final decoded = scoresJson.split(';');
        for (final entry in decoded) {
          final parts = entry.split('=');
          if (parts.length == 2) _quizScores[parts[0]] = int.tryParse(parts[1]) ?? 0;
        }
      }
    });
  }

  Future<void> _markCompleted(String lessonId) async {
    setState(() => _completed.add(lessonId));
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList('academy_completed', _completed.toList());
  }

  Future<void> _saveQuizScore(String lessonId, int score) async {
    setState(() => _quizScores[lessonId] = score);
    final prefs = await SharedPreferences.getInstance();
    final encoded = _quizScores.entries.map((e) => '${e.key}=${e.value}').join(';');
    await prefs.setString('academy_quiz_scores', encoded);
  }

  @override
  Widget build(BuildContext context) {
    final lesson = _lessons[_selectedLesson];
    final progress = (_completed.length / _lessons.length * 100).round();
    return Column(
      children: [
        // Progress bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          color: AppColors.primaryContainer,
          child: Row(
            children: [
              const Icon(Icons.school, size: 16, color: AppColors.primary),
              const SizedBox(width: 6),
              Expanded(
                child: Text('تقدّمك: ${_completed.length}/${_lessons.length} درس ($progress%)', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
              ),
              Expanded(
                child: LinearProgressIndicator(
                  value: _completed.length / _lessons.length,
                  backgroundColor: Colors.grey.shade300,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
        // Lessons list (horizontal)
        SizedBox(
          height: 60,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            itemCount: _lessons.length,
            itemBuilder: (ctx, i) {
              final l = _lessons[i];
              final selected = i == _selectedLesson;
              final done = _completed.contains(l.id);
              return GestureDetector(
                onTap: () => setState(() => _selectedLesson = i),
                child: Container(
                  width: 80,
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: selected ? AppColors.primary : (done ? Colors.green.withValues(alpha: 0.1) : Colors.grey.shade100),
                    borderRadius: BorderRadius.circular(10),
                    border: selected ? Border.all(color: AppColors.primary, width: 2) : null,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Stack(
                        children: [
                          Text(l.emoji, style: const TextStyle(fontSize: 18)),
                          if (done)
                            Positioned(
                              right: -2, top: -2,
                              child: Container(
                                padding: const EdgeInsets.all(1),
                                decoration: const BoxDecoration(color: Colors.green, shape: BoxShape.circle),
                                child: const Icon(Icons.check, size: 8, color: Colors.white),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        l.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: selected ? Colors.white : Colors.black87),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        // Lesson content
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(lesson.emoji, style: const TextStyle(fontSize: 28)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(lesson.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                      decoration: BoxDecoration(color: AppColors.primaryContainer, borderRadius: BorderRadius.circular(4)),
                                      child: Text(lesson.category, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold)),
                                    ),
                                    const SizedBox(width: 4),
                                    Text(lesson.level, style: const TextStyle(fontSize: 9, color: Colors.grey)),
                                    const SizedBox(width: 4),
                                    Text('${lesson.duration} دقيقة', style: const TextStyle(fontSize: 9, color: Colors.grey)),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              ...lesson.sections.asMap().entries.map((entry) {
                final idx = entry.key;
                final s = entry.value;
                return Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${idx + 1}. ${s.heading}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primary)),
                        const SizedBox(height: 4),
                        Text(s.body, style: const TextStyle(fontSize: 12, height: 1.5)),
                        if (s.keyPoints.isNotEmpty) ...[
                          const SizedBox(height: 6),
                          const Text('النقاط الأساسية:', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                          ...s.keyPoints.map((k) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 1),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('✓ ', style: TextStyle(color: Colors.green, fontSize: 11)),
                                Expanded(child: Text(k, style: const TextStyle(fontSize: 11, height: 1.3))),
                              ],
                            ),
                          )),
                        ],
                      ],
                    ),
                  ),
                );
              }),
              if (lesson.quiz != null && lesson.quiz!.isNotEmpty) ...[
                const SizedBox(height: 8),
                _QuizWidget(
                  lessonId: lesson.id,
                  quiz: lesson.quiz!,
                  onComplete: (score) {
                    _saveQuizScore(lesson.id, score);
                    if (score >= 2) _markCompleted(lesson.id);
                  },
                ),
              ],
              const SizedBox(height: 12),
              // Next lesson button
              if (_selectedLesson < _lessons.length - 1)
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      _markCompleted(lesson.id);
                      setState(() => _selectedLesson++);
                    },
                    icon: const Icon(Icons.arrow_back, size: 18),
                    label: const Text('الدرس التالي'),
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
                  ),
                )
              else
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _markCompleted(lesson.id),
                    icon: const Icon(Icons.celebration, size: 18),
                    label: const Text('إنهاء الأكاديمية'),
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
                  ),
                ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ],
    );
  }
}

class _QuizWidget extends StatefulWidget {
  final String lessonId;
  final List<_Quiz> quiz;
  final void Function(int score) onComplete;
  const _QuizWidget({required this.lessonId, required this.quiz, required this.onComplete});

  @override
  State<_QuizWidget> createState() => _QuizWidgetState();
}

class _QuizWidgetState extends State<_QuizWidget> {
  int _currentQ = 0;
  int? _selectedAnswer;
  bool _answered = false;
  int _score = 0;
  bool _completed = false;

  void _answer(int idx) {
    if (_answered) return;
    setState(() {
      _selectedAnswer = idx;
      _answered = true;
      if (idx == widget.quiz[_currentQ].correct) _score++;
    });
  }

  void _next() {
    if (_currentQ < widget.quiz.length - 1) {
      setState(() {
        _currentQ++;
        _selectedAnswer = null;
        _answered = false;
      });
    } else {
      setState(() => _completed = true);
      widget.onComplete(_score);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_completed) {
      final passed = _score >= 2;
      return Card(
        color: passed ? Colors.green.withValues(alpha: 0.1) : Colors.orange.withValues(alpha: 0.1),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              Icon(passed ? Icons.emoji_events : Icons.refresh, size: 40, color: passed ? Colors.amber : Colors.orange),
              const SizedBox(height: 8),
              Text('نتيجتك: $_score/${widget.quiz.length}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 4),
              Text(passed ? 'أحسنت! اكتمل الدرس' : 'حاول مرة أخرى لاجتياز الاختبار', style: const TextStyle(fontSize: 12, color: Colors.grey)),
              if (passed) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: Colors.amber, borderRadius: BorderRadius.circular(12)),
                  child: const Text('🏅 شارة إنجاز', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                ),
              ],
            ],
          ),
        ),
      );
    }
    final q = widget.quiz[_currentQ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.quiz, size: 16, color: AppColors.primary),
                const SizedBox(width: 4),
                Text('سؤال ${_currentQ + 1}/${widget.quiz.length}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.primary)),
              ],
            ),
            const SizedBox(height: 6),
            Text(q.q, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 8),
            ...q.options.asMap().entries.map((entry) {
              final idx = entry.key;
              final opt = entry.value;
              final isSelected = _selectedAnswer == idx;
              final isCorrect = idx == q.correct;
              Color? bgColor;
              if (_answered) {
                if (isCorrect) bgColor = Colors.green.withValues(alpha: 0.2);
                else if (isSelected) bgColor = Colors.red.withValues(alpha: 0.2);
              }
              return GestureDetector(
                onTap: _answered ? null : () => _answer(idx),
                child: Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: bgColor ?? Colors.grey.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: isSelected ? AppColors.primary : Colors.grey.shade300),
                  ),
                  child: Row(
                    children: [
                      Text('${String.fromCharCode(65 + idx)})', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
                      const SizedBox(width: 6),
                      Expanded(child: Text(opt, style: const TextStyle(fontSize: 12))),
                      if (_answered && isCorrect) const Icon(Icons.check, color: Colors.green, size: 16),
                      if (_answered && isSelected && !isCorrect) const Icon(Icons.close, color: Colors.red, size: 16),
                    ],
                  ),
                ),
              );
            }),
            if (_answered) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Colors.blue.shade50, borderRadius: BorderRadius.circular(8)),
                child: Text(q.explanation, style: const TextStyle(fontSize: 11, height: 1.4)),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _next,
                  style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
                  child: Text(_currentQ < widget.quiz.length - 1 ? 'السؤال التالي' : 'عرض النتيجة'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Lesson {
  final String id, category, title, emoji, level;
  final int duration;
  final List<_Section> sections;
  final List<_Quiz>? quiz;
  const _Lesson({
    required this.id, required this.category, required this.title, required this.emoji,
    required this.level, required this.duration, required this.sections, this.quiz,
  });
}

class _Section {
  final String heading, body;
  final List<String> keyPoints;
  const _Section({required this.heading, required this.body, this.keyPoints = const []});
}

class _Quiz {
  final String q, explanation;
  final List<String> options;
  final int correct;
  const _Quiz({required this.q, required this.options, required this.correct, required this.explanation});
}
