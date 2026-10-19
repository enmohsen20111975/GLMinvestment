// P40-ACADEMY PILLAR 3: Strategy Chart Sandbox
'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch,
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  LineChart,
  Layers,
  Target,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Percent,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

/* ============================================================
   P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
   مختبر الاستراتيجيات: مكون تفاعلي يُظهر مفاهيم SMC/ICT،
   التحليل الفني التقليدي، والتحليل المالي الأساسي عبر
   شارتات SVG توليدية مع شرح عربي كامل.
   ============================================================ */

/* ─────────────────────────────────────────── Types ────────── */

interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

interface StrategyTopic {
  id: string;
  category: 'smc' | 'ta' | 'fa';
  nameAr: string;
  nameEn: string;
  icon: LucideIcon;
  pattern: string;
  summary: string;
  explanation: string[];
  howToTrade: {
    entry: string;
    stopLoss: string;
    target: string;
  };
  examples: string[];
}

interface StrategyCategory {
  id: 'smc' | 'ta' | 'fa';
  nameAr: string;
  nameEn: string;
  icon: LucideIcon;
  accent: string;
  topics: StrategyTopic[];
}

/* ───────────────────────────────────── Topics Data ────────── */

const TOPICS: StrategyTopic[] = [
  /* ─── A. SMC / ICT ─── */
  {
    id: 'fvg',
    category: 'smc',
    nameAr: 'فجوة القيمة العادلة',
    nameEn: 'Fair Value Gap (FVG)',
    icon: Layers,
    pattern: 'fvg',
    summary: 'منطقة فجوة سيولة بين ثلاث شموع متتالية — السعر يعود لملئها غالباً.',
    explanation: [
      'تظهر FVG عندما يكون هناك فراغ بين جسم شمعة 1 وجسم شمعة 3 (الشمعة الوسطى عادةً اندفاعية).',
      'هذه الفجوة تمثل عدم توازن مؤقت بين العرض والطلب في السوق.',
      'السيولة تملأ الفجوات — السعر غالباً سيعود لملء هذه الفجوة قبل المواصلة في الاتجاه الأصلي.',
      'الفجوات الصعودية تعمل كدعم مستقبلي، والهابطة كمقاومة مستقبلية.',
      'كلما كانت الفجوة أكبر وأحدث، كانت أكثر موثوقية.',
    ],
    howToTrade: {
      entry: 'انتظر عودة السعر لملء الفجوة، ثم ادخل بعد ظهور شمعة انعكاس مؤكدة (مثل pin bar أو engulfing).',
      stopLoss: 'أسفل الفجوة بمسافة ATR واحدة، أو أسفل شمعة الدخول.',
      target: 'أعلى قمة قبل الفجوة، أو بنسبة مخاطرة/عائد 1:2 على الأقل.',
    },
    examples: [
      'EUR/USD على فريم 4 ساعات في نوفمبر 2023 شكّل FVG صاعد ثم عاد لملئه قبل الارتفاع 200 نقطة.',
      'COMI (البنك التجاري الدولي) في يناير 2024 ترك فجوة عند جري إيرادات Q4 ثم امتلأت قبل الصعود.',
    ],
  },
  {
    id: 'order-block',
    category: 'smc',
    nameAr: 'كتلة الطلب',
    nameEn: 'Order Block (OB)',
    icon: GitBranch,
    pattern: 'orderBlock',
    summary: 'آخر شمعة هابطة قبل اندفاع صاعد قوي — تعمل كدعم عند العودة.',
    explanation: [
      'كتلة الطلب (Demand Block) هي آخر شمعة بيع قبل الشراء القوي — تعمل كدعم عند العودة.',
      'الوكلاء المؤسسيون (Smart Money) يجمّعون مراكزهم في هذه المنطقة قبل الاندفاع.',
      'عندما يعود السعر لمنطقة الـ OB، يُتوقع أن يتفاعل معها بقوة.',
      'يفضل أن تكون شمعة الـ OB قد أخذت سيولة من جانب البيع أولاً (Liquidity Sweep).',
      'منطقة الـ OB الفعالة تكون قد تسببت في كسر هيكل سابق (MSS).',
    ],
    howToTrade: {
      entry: 'عند عودة السعر لمنطقة الـ OB، انتظر تأكيداً بشمعة صاعدة على فريم أصغر ثم ادخل شراء.',
      stopLoss: 'أسفل جسم شمعة الـ OB بمسافة صغيرة.',
      target: 'أعلى قمة الاندفاع السابق، أو بنسبة 1:3 من المخاطرة.',
    },
    examples: [
      'BTC/USD في أكتوبر 2023 شكّل OB على فريم اليومي قبل الارتفاع من 27K إلى 35K.',
      'Talaat Moustafa Group (TMG) في مارس 2024 ترك OB واضح على فريم 4 ساعات قبل الاندفاع.',
    ],
  },
  {
    id: 'liquidity-sweep',
    category: 'smc',
    nameAr: 'جمع السيولة',
    nameEn: 'Liquidity Sweep / Grab',
    icon: Activity,
    pattern: 'liquiditySweep',
    summary: 'كسر قمة سابقة ثم ارتداد — صانع السوق يلتزم طلبات الشراء فوق القمة.',
    explanation: [
      'جمع السيولة (Liquidity Grab) يحدث عندما يكسر السعر قمة سابقة ثم يرتد — صانع السوق يلتزم طلبات الشراء فوق القمة.',
      'السيولة البائلة (Buy-side Liquidity) تكون فوق القمم في صورة وقوف خسارة البائعين.',
      'كل قمة واضحة هي هدف محتمل لجمع السيولة من قِبل صانع السوق.',
      'السويب الناجح يكون سريعاً: يكسر القمة ثم يغلق تحتها بنفس الشمعة أو الشمعة التالية.',
      'بعد السويب، يتحول دور القمة المكسورة من مقاومة إلى دعم نفسي.',
    ],
    howToTrade: {
      entry: 'بعد تأكيد السويب (إغلاق شمعة هابطة تحت القمة المكسورة)، ادخل بيعاً عند اختبار القمة من الأسفل.',
      stopLoss: 'فوق ذيل السويب بمسافة صغيرة.',
      target: 'آخر قاع سابق (هدف السيولة المعاكس).',
    },
    examples: [
      'XAU/USD في ديسمبر 2023 سحب سيولة فوق قمة 2080 ثم هبط 80 دولار.',
      'EGX30 في فبراير 2024 سحب سيولة فوق مقاومة 28,000 ثم ارتدع هبوطياً.',
    ],
  },
  {
    id: 'mss',
    category: 'smc',
    nameAr: 'تغيّر هيكل السوق',
    nameEn: 'Market Structure Shift (MSS)',
    icon: TrendingDown,
    pattern: 'mss',
    summary: 'كسر آخر قاع بعد سلسلة صاعدة — إشارة دخول للبيع.',
    explanation: [
      'تغيّر هيكل السوق من صاعد إلى هابط يحدث عند كسر آخر قاع — إشارة دخول للبيع.',
      'في الاتجاه الصاعد: قمم صاعدة وقيعان صاعدة. أول كسر لقاع = تحوّل هابط (BOS/MSS).',
      'كلما كان القاع المكسور أحدث وأهم، كانت الإشارة أقوى.',
      'يفضل أن يحدث MSS بعد جمع سيولة (Liquidity Sweep) من الأعلى.',
      'MSS هو تأكيد أن صانع السوق بدأ التوزيع (Distribution).',
    ],
    howToTrade: {
      entry: 'بعد كسر القاع، انتظر ارتداد السعر لاختبار القاع المكسور من الأسفل، ثم ادخل بيعاً.',
      stopLoss: 'فوق القمة التي سبقت الكسر.',
      target: 'آخر قاع سابق أدنى، أو 1:2 من المخاطرة.',
    },
    examples: [
      'NAS100 في أبريل 2024 كسر قاع 17,800 بعد صعود طويل ثم هبط إلى 17,200.',
      'ETEL (اتصالات مصر) في يونيو 2023 كسر قاع هيكلي على فريم 4 ساعات قبل موجة هبوط.',
    ],
  },

  /* ─── B. Traditional TA ─── */
  {
    id: 'head-shoulders',
    category: 'ta',
    nameAr: 'الرأس والكتفين',
    nameEn: 'Head and Shoulders',
    icon: TrendingDown,
    pattern: 'headShoulders',
    summary: 'نموذج انعكاسي هابط بثلاث قمم: الكتف الأيسر، الرأس، الكتف الأيمن.',
    explanation: [
      'نموذج انعكاسي هابط يتكون من ثلاث قمم: الكتف الأيسر، الرأس (الأعلى)، الكتف الأيمن.',
      'خط الرقبة (Neckline) يربط بين القاعين الواقعين بين الكتفين والرأس.',
      'الكتف الأيمن عادةً يكون أقل من الرأس ومساوٍ أو أقل من الكتف الأيسر.',
      'حجم التداول (Volume) يقل عادةً عند الكتف الأيمن — دليل ضعف الزخم.',
      'كسر خط الرقبة يؤكد اكتمال النموذج ويبدأ الموجة الهابطة.',
    ],
    howToTrade: {
      entry: 'ادخل بيعاً عند كسر خط الرقبة (إغلاق شمعة تحته)، أو انتظر ارتداد السعر لاختبار الرقبة من الأسفل.',
      stopLoss: 'فوق قمة الكتف الأيمن.',
      target: 'مسافة الرأس من خط الرقبة، نازلاً من نقطة الكسر (Measured Move).',
    },
    examples: [
      'Apple (AAPL) في يناير 2024 شكّل H&S على فريم يومي قبل التصحيح من 199 إلى 165.',
      'EGX30 في يونيو 2018 شكّل H&S كلاسيكي قبل موجة هبوط طويلة.',
    ],
  },
  {
    id: 'triangles',
    category: 'ta',
    nameAr: 'المثلثات',
    nameEn: 'Triangles (Asc / Desc / Sym)',
    icon: TrendingUp,
    pattern: 'triangle',
    summary: 'ثلاثة أنواع: صاعد، هابط، متماثل — كل منها له اتجاه كسر مُرجّح.',
    explanation: [
      'المثلث الصاعد (Ascending): قمة أفقية وقاع صاعد — يكسر للأعلى غالباً.',
      'المثلث الهابط (Descending): قاع أفقي وقمة هابطة — يكسر للأسفل غالباً.',
      'المثلث المتماثل (Symmetric): قمم هابطة وقيعان صاعدة — يحتاج تأكيد الاتجاه.',
      'الكثير من المثلثات تكون أنماط استمرارية (Continuation) وليست انعكاسية.',
      'الحجم يتقلص أثناء تكون المثلث ويتسع عند الكسر — تأكيد مهم.',
    ],
    howToTrade: {
      entry: 'ادخل بعد كسر خط الاتجاه مع إغلاق شمعة خارج المثلث، أو على ارتداد اختبار الكسر.',
      stopLoss: 'داخل المثلث قريباً من خط الكسر.',
      target: 'ارتفاع قاعدة المثلث (أوسع مسافة داخل المثلث) من نقطة الكسر.',
    },
    examples: [
      'Microsoft (MSFT) في 2023 شكّل مثلث صاعد على فريم أسبوعي قبل الارتفاع من 330 إلى 420.',
      'CIB (البنك التجاري الدولي) شكّل مثلث متماثل على فريم يومي قبل تحديد الاتجاه.',
    ],
  },
  {
    id: 'rsi-divergence',
    category: 'ta',
    nameAr: 'تباين RSI',
    nameEn: 'RSI Divergence',
    icon: Activity,
    pattern: 'rsiDiv',
    summary: 'السعر يصنع قمة أعلى بينما RSI يصنع قمة أدنى — تحذير ضعف الزخم.',
    explanation: [
      'التقاطع السلبي (Bearish Divergence) يُحذّر من ضعف الزخم رغم ارتفاع السعر.',
      'السعر يصنع قمة أعلى (Higher High) بينما RSI يصنع قمة أدنى (Lower High).',
      'التقاطع الإيجابي (Bullish Divergence) عكس ذلك: سعر أقل + RSI أعلى.',
      'التباين مؤشر تنبؤي، لا يُستخدم للدخول مباشرةً بل بانتظار تأكيد انعكاسي.',
      'يفضل البحث عن التباين على فريمات أعلى (يومي/4 ساعات) لأنها أكثر موثوقية.',
    ],
    howToTrade: {
      entry: 'بعد ظهور التباين، انتظر كسر هيكل قاع (MSS) أو شمعة انعكاسية، ثم ادخل في اتجاه التباين.',
      stopLoss: 'فوق/تحت آخر قمة/قاع سعري.',
      target: 'آخر قمة/قيم مقاومة/دعم رئيسي.',
    },
    examples: [
      'Tesla (TSLA) في نوفمبر 2021 أظهر تباين سلبي على فريم يومي قبل الهبوط من 414 إلى 152.',
      'Sidi Kerir Petrochemicals (SKPC) أظهر تباين إيجابي قبل موجة صعود 2023.',
    ],
  },
  {
    id: 'macd-crossover',
    category: 'ta',
    nameAr: 'تقاطع MACD',
    nameEn: 'MACD Crossover',
    icon: LineChart,
    pattern: 'macd',
    summary: 'تقاطع خط MACD مع خط Signal — إشارة شراء أو بيع حسب الاتجاه.',
    explanation: [
      'تقاطع MACD فوق Signal = إشارة شراء، تحته = إشارة بيع.',
      'MACD = الفرق بين EMA(12) و EMA(26). Signal = EMA(9) لـ MACD.',
      'الهيستوجرام (Histogram) يُظهر الفرق بين MACD و Signal — يقوّي الإشارة.',
      'تقاطعات في اتجاه الترند العام أقوى بكثير من تقاطعات عكسية.',
      'تقاطعات متأخرة بطبيعتها — استخدمها مع مؤشرات أخرى للتأكيد.',
    ],
    howToTrade: {
      entry: 'شراء عند تقاطع MACD فوق Signal (مع تأكيد هيستوجرام موجب)، بيع عند العكس.',
      stopLoss: 'أسفل آخر سوينج قاعي في صفقة الشراء، أو أعلى السوينج القمي في البيع.',
      target: 'بنسبة 1:2 من المخاطرة، أو عند ظهور تقاطع معاكس.',
    },
    examples: [
      'SPY على فريم يومي في نوفمبر 2023 أعطى تقاطع شراء قرب 450 قبل الصعود إلى 480.',
      'EZZ Steel (ESRS) في أوائل 2024 أعطى تقاطع شراء على فريم 4 ساعات قبل صعود 15%.',
    ],
  },
  {
    id: 'bollinger-squeeze',
    category: 'ta',
    nameAr: 'انضغاط بولينجر',
    nameEn: 'Bollinger Squeeze',
    icon: BarChart3,
    pattern: 'bollinger',
    summary: 'تضيّق النطاقات يسبق انفجاراً سعرياً — انتظر الاتساع لتحديد الاتجاه.',
    explanation: [
      'الانضغاط (Squeeze) يسبق الانفجار — انتظر اتساع النطاقات لتحديد الاتجاه.',
      'عندما تقترب الباند العلوية من السفلية جداً، يتجمّع السوق لتحرك كبير.',
      'كسر الباند العلوية مع اتساع = صعود قوي. كسر السفلية = هبوط قوي.',
      'الباند الوسطى = SMA(20) وتعمل كدعم/مقاومة ديناميكي.',
      'العودة من خارج الباند غالباً تعني ارتداد نحو الوسط.',
    ],
    howToTrade: {
      entry: 'انتظر الاتساع بعد الانضغاط، وادخل في اتجاه الكسر مع شمعة إغلاق خارج الباند.',
      stopLoss: 'تحت/فوق الباند الوسطى (SMA 20).',
      target: 'ضعيف: لمس الباند المقابل. قوي: بنسبة 1:2 أو 1:3 من المخاطرة.',
    },
    examples: [
      'Netflix (NFLX) في يناير 2022 شكّل squeeze قبل انفجار هبوطي 50%.',
      'Orascom Investment Holding (OIH) أظهر squeeze متكرر قبل تحركات كبيرة في 2023.',
    ],
  },

  /* ─── C. Fundamental Analysis ─── */
  {
    id: 'pe-ratio',
    category: 'fa',
    nameAr: 'مكرر الربحية',
    nameEn: 'P/E Ratio',
    icon: DollarSign,
    pattern: 'pe',
    summary: 'سعر السهم مقسوماً على ربحيته للسهم — مقياس التقييم الأشهر.',
    explanation: [
      'سهم بسعر 100 ج.م و EPS=10 → P/E=10. كلما انخفض P/E عن متوسط القطاع، كان السهم أرخص.',
      'P/E = سعر السهم السوقي ÷ ربحية السهم الواحد (EPS).',
      'P/E منخفض جداً قد يعني مشاكل خفية — والمرتفع جداً قد يعني نمو متوقع.',
      'استخدم P/E Forward (للسنة القادمة) بدل Trailing لرؤية أحدث.',
      'يقارن دائماً بمتوسط القطاع والتاريخي للسهم نفسه، ليس برقم مطلق.',
    ],
    howToTrade: {
      entry: 'سهم بـ P/E أقل من متوسط القطاع بفارق كبير، مع أساسيات قوية (نمو + هوامش جيدة).',
      stopLoss: 'إذا هبط EPS بشكل مفاجئ أو تغيّرت توقعات القطاع.',
      target: 'عند عودة P/E لمتوسط القطاع، أو خلال 12-18 شهر استثمار طويل.',
    },
    examples: [
      'CIB بسعر 60 ج.م و EPS=10 → P/E=6 (أقل من متوسط البنوك عند 8).',
      'Apple بـ P/E=30 vs Microsoft بـ P/E=35 — مقارنة قطاعية مباشرة.',
    ],
  },
  {
    id: 'pb-ratio',
    category: 'fa',
    nameAr: 'نسبة القيمة الدفترية',
    nameEn: 'P/B Ratio',
    icon: Building2,
    pattern: 'pb',
    summary: 'سعر السهم مقسوماً على قيمته الدفترية — مقياس للأصول.',
    explanation: [
      'P/B = سعر السهم ÷ القيمة الدفترية للسهم (Book Value per Share).',
      'P/B < 1: السهم يتداول تحت قيمته الدفترية — قد يكون مقوّم بأقل من قيمته.',
      'P/B > 3: السهم فوق قيمته الدفترية بكثير — يعكس شهية السوق أو أصول غير ملموسة.',
      'مفيد جداً للبنوك وشركات التأمين والصناعات كثيفة الأصول.',
      'للشركات التكنولوجية P/B مرتفع طبيعي لأن قيمتها في العلامة والابتكار، لا الأصول الملموسة.',
    ],
    howToTrade: {
      entry: 'P/B < 1 لسهم رابح بمخصصات سليمة، أو P/B أقل من متوسط تاريخه.',
      stopLoss: 'إذا ظهرت خسائر في الأصول أو تآكل حقوق المساهمين.',
      target: 'عند اقتراب P/B من متوسط القطاع أو القيمة العادلة.',
    },
    examples: [
      'البنك الأهلي المصري (NBE) — غير مدرج لكن P/B للبنوك الحكومية عادةً < 1.',
      'Bank of America (BAC) بـ P/B=1.1 يُعتبر مقوّماً بعقلانية للبنوك الأمريكية.',
    ],
  },
  {
    id: 'dividend-yield',
    category: 'fa',
    nameAr: 'عائد التوزيعات',
    nameEn: 'Dividend Yield',
    icon: Percent,
    pattern: 'dividend',
    summary: 'التوزيعات النقدية السنوية كنسبة من سعر السهم.',
    explanation: [
      'سهم بسعر 50 ج.م يوزّع 2.5 ج.م سنوياً → Yield=5%.',
      'Dividend Yield = التوزيع السنوي للسهم ÷ سعر السهم × 100%.',
      'عائد مرتفع جداً (>10%) قد يكون تحذيراً — السعر هبط كثيراً أو التوزيع غير مستدام.',
      'عائد منخفض (<1%) لشركة نامية طبيعي — تُعيد استثمار أرباحها بدل توزيعها.',
      'يفضل النظر لـ Dividend Payout Ratio (نسبة توزيع الأرباح من EPS).',
    ],
    howToTrade: {
      entry: 'سهم بعائد > متوسط القطاع + تاريخ توزيع مستقر > 5 سنوات + payout ratio معقول (<80%).',
      stopLoss: 'إذا أعلنت الشركة تخفيض التوزيعات أو توقفت عنها.',
      target: 'دخل سلبي مستمر + إعادة استثمار، أو هدف رأس مالي بنسبة 20-30%.',
    },
    examples: [
      'Telecom Egypt (ETEL) بتوزيعات 1 ج.م وسعر 18 → Yield≈5.5% (تاريخي مستقر).',
      'AT&T (T) الأمريكي بعائد ~7% — مرتفع لكن بانتباه لنسبة الدين.',
    ],
  },
  {
    id: 'graham-number',
    category: 'fa',
    nameAr: 'القيمة العادلة (Graham)',
    nameEn: 'Graham Number',
    icon: Target,
    pattern: 'graham',
    summary: 'صيغة بنجامين غراهام لحساب القيمة العادلة من EPS و Book Value.',
    explanation: [
      'معادلة Graham: √(22.5 × EPS × Book Value per Share).',
      '22.5 = حاصل ضرب P/E المقبول (15) × P/B المقبول (1.5).',
      'إذا كان السعر السوقي أقل من Graham Number → السهم مقوّم بأقل من قيمته.',
      'تُستخدم للأصول المالية فقط، وليست للتكنولوجيا أو شركات النمو السريع.',
      'هي قاعدة إرشادية، ليست دقيقة 100% — استخدمها مع تحليل أعمق.',
    ],
    howToTrade: {
      entry: 'سهم ربحه موجب ومستقر، سعره أقل من Graham Number بفارق > 20%.',
      stopLoss: 'إذا هبط EPS أو Book Value بشكل جوهري، أو تغيّرت طبيعة العمل.',
      target: 'عند وصول السعر لـ Graham Number، أو خلال 2-3 سنوات.',
    },
    examples: [
      'سهم EPS=5 ج.م و BV=40 → Graham = √(22.5×5×40)=√4500≈67 ج.م. إن كان السعر 45 → مقوّم بأقل.',
      'Chevron (CVX) عام 2020 كان سعره تحت Graham Number — فرصة قيمية كلاسيكية.',
    ],
  },
];

const CATEGORIES: StrategyCategory[] = [
  {
    id: 'smc',
    nameAr: 'مدرسة SMC / ICT',
    nameEn: 'Smart Money Concepts',
    icon: GitBranch,
    accent: 'text-violet-600',
    topics: TOPICS.filter(t => t.category === 'smc'),
  },
  {
    id: 'ta',
    nameAr: 'التحليل الفني التقليدي',
    nameEn: 'Traditional Technical Analysis',
    icon: BarChart3,
    accent: 'text-sky-600',
    topics: TOPICS.filter(t => t.category === 'ta'),
  },
  {
    id: 'fa',
    nameAr: 'التحليل المالي والأساسي',
    nameEn: 'Fundamental Analysis',
    icon: BookOpen,
    accent: 'text-profit',
    topics: TOPICS.filter(t => t.category === 'fa'),
  },
];

const FLAT_TOPIC_IDS = TOPICS.map(t => t.id);

/* ───────────────────────── Synthetic Candles Generator ───── */

function generateSyntheticCandles(pattern: string): Candle[] {
  const out: Candle[] = [];
  const N = 26;
  const clamp = (c: Candle): Candle => ({
    o: +(c.o ?? 0).toFixed(2),
    h: +(c.h ?? 0).toFixed(2),
    l: +(c.l ?? 0).toFixed(2),
    c: +(c.c ?? 0).toFixed(2),
  });

  switch (pattern) {
    /* ── FVG: 3-candle gap up at indices 5-7 ── */
    case 'fvg': {
      let p = 95;
      for (let i = 0; i < N; i++) {
        if (i === 5) {
          out.push(clamp({ o: p, c: p + 1.2, h: p + 1.6, l: p - 0.4 }));
        } else if (i === 6) {
          // Impulse candle that opens with a gap up
          out.push(clamp({ o: p + 5, c: p + 9, h: p + 9.5, l: p + 4.5 }));
          p = p + 9;
        } else if (i === 7) {
          // Candle after gap opens above previous high → gap remains
          out.push(clamp({ o: p + 1, c: p + 2.5, h: p + 3.2, l: p + 0.6 }));
          p = p + 2.5;
        } else if (i === 11 || i === 12) {
          // Price returns to fill the gap
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else if (i === 13) {
          // Bounce from gap zone
          out.push(clamp({ o: p, c: p + 3, h: p + 3.5, l: p - 0.5 }));
          p = p + 3;
        } else {
          const drift = Math.sin(i * 0.5) * 0.6;
          const isBull = i % 3 !== 0;
          const o = p;
          const c = isBull ? p + 0.8 + drift : p - 0.7 + drift;
          const h = Math.max(o, c) + 0.5;
          const l = Math.min(o, c) - 0.5;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Order Block: red candle at index 4 followed by strong rally ── */
    case 'orderBlock': {
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i === 4) {
          // Last red candle before rally = the Order Block
          out.push(clamp({ o: p, c: p - 2, h: p + 0.3, l: p - 2.5 }));
          p = p - 2;
        } else if (i === 5 || i === 6 || i === 7) {
          // Strong rally
          const gain = 3 + i * 0.5;
          out.push(clamp({ o: p, c: p + gain, h: p + gain + 0.4, l: p - 0.2 }));
          p = p + gain;
        } else if (i === 14 || i === 15) {
          // Return to test OB
          out.push(clamp({ o: p, c: p - 3.5, h: p + 0.2, l: p - 4 }));
          p = p - 3.5;
        } else if (i === 16) {
          // Bounce from OB
          out.push(clamp({ o: p, c: p + 4, h: p + 4.5, l: p - 0.3 }));
          p = p + 4;
        } else {
          const drift = Math.cos(i * 0.4) * 0.5;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.5 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Liquidity Sweep: rising peaks, then sweep + bounce ── */
    case 'liquiditySweep': {
      let p = 100;
      const peaks = [3, 9, 15]; // indices of consecutive peaks
      const peakVals: number[] = [];
      for (let i = 0; i < N; i++) {
        if (i === 3) {
          out.push(clamp({ o: p, c: p + 2, h: p + 3, l: p - 0.3 }));
          p = p + 2;
          peakVals.push(p + 1);
        } else if (i === 9) {
          out.push(clamp({ o: p, c: p + 1.5, h: p + 3, l: p - 0.3 }));
          p = p + 1.5;
          peakVals.push(p + 1.5);
        } else if (i === 15) {
          // Sweep: breaks above previous peak then closes below
          const prevPeak = peakVals[peakVals.length - 1];
          out.push(clamp({
            o: p,
            c: prevPeak - 0.5,
            h: prevPeak + 1.5, // sweep above
            l: p - 0.5,
          }));
          p = prevPeak - 0.5;
        } else if (i === 16 || i === 17 || i === 18) {
          // Bounce down
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = !peaks.includes(i) && i % 3 !== 0;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.5 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── MSS: ascending structure then break of last low ── */
    case 'mss': {
      let p = 100;
      const lows = [4, 11, 18];
      const lowVals: number[] = [];
      for (let i = 0; i < N; i++) {
        if (i === 4) {
          out.push(clamp({ o: p, c: p + 1, h: p + 1.5, l: p - 1 }));
          p = p + 1;
          lowVals.push(p - 1);
        } else if (i === 11) {
          out.push(clamp({ o: p, c: p + 1, h: p + 1.5, l: p - 0.8 }));
          p = p + 1;
          lowVals.push(p - 0.8);
        } else if (i === 18) {
          // Last higher low
          out.push(clamp({ o: p, c: p + 1, h: p + 1.5, l: p - 0.6 }));
          p = p + 1;
          lowVals.push(p - 0.6);
        } else if (i === 22) {
          // MSS: break below last low
          const lastLow = lowVals[lowVals.length - 1];
          out.push(clamp({ o: p, c: lastLow - 1.5, h: p + 0.3, l: lastLow - 2 }));
          p = lastLow - 1.5;
        } else if (i === 23 || i === 24 || i === 25) {
          // Continuation down
          out.push(clamp({ o: p, c: p - 1.5, h: p + 0.3, l: p - 2 }));
          p = p - 1.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 3 !== 1;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.4 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Head and Shoulders: LS (5), Head (13), RS (21), neckline ── */
    case 'headShoulders': {
      let p = 100;
      const necklineY = 100;
      for (let i = 0; i < N; i++) {
        if (i === 5) {
          // Left shoulder
          out.push(clamp({ o: p, c: p + 4, h: p + 5, l: p - 0.3 }));
          p = p + 4;
        } else if (i === 6 || i === 7) {
          // Pullback to neckline
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else if (i === 13) {
          // Head
          out.push(clamp({ o: p, c: p + 7, h: p + 8, l: p - 0.3 }));
          p = p + 7;
        } else if (i === 14 || i === 15) {
          // Pullback to neckline
          out.push(clamp({ o: p, c: p - 4, h: p + 0.3, l: p - 4.5 }));
          p = p - 4;
        } else if (i === 21) {
          // Right shoulder
          out.push(clamp({ o: p, c: p + 4, h: p + 5, l: p - 0.3 }));
          p = p + 4;
        } else if (i === 22 || i === 23) {
          // Pullback and neckline break
          out.push(clamp({ o: p, c: p - 3, h: p + 0.3, l: p - 3.5 }));
          p = p - 3;
        } else if (i === 24 || i === 25) {
          // Continuation down
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.4 + drift : p - 0.3 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Bollinger Squeeze: narrow then expand ── */
    case 'bollinger': {
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i < 14) {
          // Tight squeeze: tiny candles
          const drift = Math.sin(i * 0.6) * 0.2;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.3 + drift : p - 0.2 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.15, l: Math.min(o, c) - 0.15, c }));
          p = c;
        } else if (i === 14) {
          // Breakout candle
          out.push(clamp({ o: p, c: p + 4, h: p + 4.5, l: p - 0.2 }));
          p = p + 4;
        } else {
          // Expansion
          const drift = Math.sin(i * 0.5) * 0.8;
          const isBull = i % 3 !== 0;
          const o = p;
          const c = isBull ? p + 1.5 + drift : p - 1.2 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.6, l: Math.min(o, c) - 0.6, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── RSI Divergence: price higher high + RSI lower high ── */
    case 'rsiDiv': {
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i === 6) {
          // First peak
          out.push(clamp({ o: p, c: p + 5, h: p + 6, l: p - 0.3 }));
          p = p + 5;
        } else if (i === 7 || i === 8) {
          out.push(clamp({ o: p, c: p - 3, h: p + 0.3, l: p - 3.5 }));
          p = p - 3;
        } else if (i === 18) {
          // Higher high in price
          out.push(clamp({ o: p, c: p + 7, h: p + 8, l: p - 0.3 }));
          p = p + 7;
        } else if (i === 19 || i === 20) {
          // Pullback — start of downtrend
          out.push(clamp({ o: p, c: p - 4, h: p + 0.3, l: p - 4.5 }));
          p = p - 4;
        } else if (i > 20) {
          // Downtrend
          out.push(clamp({ o: p, c: p - 2, h: p + 0.3, l: p - 2.5 }));
          p = p - 2;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.4 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Triangle (used for the 3 sub-types) ── */
    case 'triangle': {
      // Ascending triangle pattern by default
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i === 4 || i === 12 || i === 19) {
          // Test horizontal resistance
          out.push(clamp({ o: p, c: p + 3, h: 110, l: p - 0.3 }));
          p = p + 3;
        } else if (i === 8) {
          out.push(clamp({ o: p, c: p - 1, h: p + 0.3, l: p - 1.5 }));
          p = p - 1;
        } else if (i === 16) {
          out.push(clamp({ o: p, c: p - 0.5, h: p + 0.3, l: p - 1 }));
          p = p - 0.5;
        } else if (i === 22 || i === 23 || i === 24 || i === 25) {
          // Breakout up
          out.push(clamp({ o: p, c: p + 2.5, h: p + 3, l: p - 0.2 }));
          p = p + 2.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.5 + drift : p - 0.3 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c }));
          p = c;
        }
      }
      return out;
    }

    default:
      // Generic rising candles
      for (let i = 0; i < N; i++) {
        const drift = Math.sin(i * 0.5) * 0.4;
        const o = 100 + i * 0.5;
        const c = o + 0.5 + drift;
        out.push(clamp({ o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c }));
      }
      return out;
  }
}

/* ───────────────────────── Chart Layout Helpers ──────────── */

const CHART_W = 600;
const CHART_H = 300;
const PAD = { left: 44, right: 14, top: 18, bottom: 28 };
const PLOT_W = CHART_W - PAD.left - PAD.right;
const PLOT_H = CHART_H - PAD.top - PAD.bottom;

function makeScales(candles: Candle[]) {
  const lows = candles.map(c => c.l);
  const highs = candles.map(c => c.h);
  const minP = Math.min(...lows) - 1;
  const maxP = Math.max(...highs) + 1;
  const slot = PLOT_W / candles.length;
  const xOf = (i: number) => PAD.left + i * slot + slot / 2;
  const yOf = (p: number) => PAD.top + PLOT_H - ((p - minP) / (maxP - minP)) * PLOT_H;
  const bodyW = Math.max(4, slot * 0.6);
  return { minP, maxP, slot, xOf, yOf, bodyW };
}

/* ───────────────────────── CandleChart Base ──────────────── */

function CandleChart({
  candles,
  children,
}: {
  candles: Candle[];
  children?: (helpers: ReturnType<typeof makeScales>) => React.ReactNode;
}) {
  const { minP, maxP, slot, xOf, yOf, bodyW } = makeScales(candles);
  const gridVals = [minP, (minP + maxP) / 2, maxP];

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" dir="ltr">
      {/* grid */}
      {gridVals.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            y1={yOf(v)}
            x2={CHART_W - PAD.right}
            y2={yOf(v)}
            stroke="currentColor"
            className="text-border"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
          <text x={6} y={yOf(v) + 4} fontSize="10" className="fill-muted-foreground">
            {(v ?? 0).toFixed(1)}
          </text>
        </g>
      ))}
      {/* x-axis labels */}
      {[0, Math.floor(candles.length / 2), candles.length - 1].map((idx, i) => (
        <text
          key={i}
          x={xOf(idx)}
          y={CHART_H - 8}
          fontSize="10"
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          {idx + 1}
        </text>
      ))}

      {/* candles */}
      {candles.map((c, i) => {
        const isBull = c.c >= c.o;
        const color = isBull ? '#10b981' : '#ef4444';
        const x = xOf(i);
        const bodyTop = yOf(Math.max(c.o, c.c));
        const bodyBot = yOf(Math.min(c.o, c.c));
        return (
          <g key={i}>
            <line x1={x} y1={yOf(c.h)} x2={x} y2={yOf(c.l)} stroke={color} strokeWidth={1.2} />
            <rect
              x={x - bodyW / 2}
              y={bodyTop}
              width={bodyW}
              height={Math.max(1.5, bodyBot - bodyTop)}
              fill={color}
              opacity={isBull ? 0.95 : 0.95}
            />
          </g>
        );
      })}

      {children && children({ minP, maxP, slot, xOf, yOf, bodyW })}
    </svg>
  );
}

/* ───────────────────────── Animated Annotation Wrapper ───── */

function AnimatedG({
  children,
  delay = 0.2,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.g
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.g>
  );
}

function Label({
  x,
  y,
  text,
  color,
  size = 11,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <text x={x} y={y} fontSize={size} fill={color} textAnchor={anchor} fontWeight="700">
      {text}
    </text>
  );
}

function Arrow({
  from,
  to,
  color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
}) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLen = 8;
  const a1 = angle + Math.PI - 0.4;
  const a2 = angle + Math.PI + 0.4;
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={2} />
      <polygon
        points={`${to.x},${to.y} ${to.x + headLen * Math.cos(a1)},${to.y + headLen * Math.sin(a1)} ${to.x + headLen * Math.cos(a2)},${to.y + headLen * Math.sin(a2)}`}
        fill={color}
      />
    </g>
  );
}

/* ───────────────────────── Strategy Charts ───────────────── */

function FVGChart() {
  const candles = generateSyntheticCandles('fvg');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf, bodyW }) => {
        // FVG: gap between candle[5].high and candle[7].low
        const gapLeft = xOf(5) - bodyW / 2;
        const gapRight = xOf(7) + bodyW / 2;
        const gapTop = yOf(candles[5].h);
        const gapBot = yOf(candles[7].l);
        return (
          <>
            <AnimatedG delay={0.1}>
              <rect
                x={gapLeft}
                y={gapTop}
                width={gapRight - gapLeft}
                height={gapBot - gapTop}
                fill="#3b82f6"
                opacity={0.18}
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <Label
                x={(gapLeft + gapRight) / 2}
                y={(gapTop + gapBot) / 2 + 4}
                text="FVG"
                color="#3b82f6"
                size={13}
              />
            </AnimatedG>
            <AnimatedG delay={0.45}>
              <Arrow
                from={{ x: xOf(11), y: yOf(candles[12].l) + 22 }}
                to={{ x: xOf(11), y: (gapTop + gapBot) / 2 }}
                color="#f59e0b"
              />
              <Label
                x={xOf(11)}
                y={yOf(candles[12].l) + 34}
                text="عودة لملء الفجوة"
                color="#f59e0b"
                size={10}
              />
            </AnimatedG>
            <AnimatedG delay={0.7}>
              <Arrow
                from={{ x: xOf(13), y: (gapTop + gapBot) / 2 }}
                to={{ x: xOf(18), y: yOf(candles[18].c) - 14 }}
                color="#10b981"
              />
              <Label x={xOf(20)} y={yOf(candles[18].c) - 18} text="ارتداد صاعد" color="#10b981" size={10} />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

function OrderBlockChart() {
  const candles = generateSyntheticCandles('orderBlock');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf, bodyW }) => {
        const obCandle = candles[4];
        const obLeft = xOf(4) - bodyW / 2;
        const obRight = xOf(4) + bodyW / 2;
        const obTop = yOf(obCandle.h);
        const obBot = yOf(obCandle.l);
        return (
          <>
            <AnimatedG delay={0.1}>
              <rect
                x={obLeft - 2}
                y={obTop}
                width={obRight - obLeft + 4}
                height={obBot - obTop}
                fill="#ef4444"
                opacity={0.18}
                stroke="#ef4444"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <Label x={xOf(4)} y={obTop - 4} text="OB" color="#ef4444" size={12} />
            </AnimatedG>
            <AnimatedG delay={0.4}>
              <Arrow
                from={{ x: xOf(5), y: yOf(candles[5].o) }}
                to={{ x: xOf(7), y: yOf(candles[7].c) }}
                color="#10b981"
              />
              <Label
                x={xOf(7) + 6}
                y={yOf(candles[7].c) - 4}
                text="اندفاع صاعد قوي"
                color="#10b981"
                size={10}
                anchor="start"
              />
            </AnimatedG>
            <AnimatedG delay={0.7}>
              <Arrow
                from={{ x: xOf(14), y: yOf(candles[14].l) + 22 }}
                to={{ x: xOf(15), y: (obTop + obBot) / 2 }}
                color="#f59e0b"
              />
              <Label
                x={xOf(15)}
                y={yOf(candles[14].l) + 34}
                text="اختبار OB"
                color="#f59e0b"
                size={10}
              />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

function LiquiditySweepChart() {
  const candles = generateSyntheticCandles('liquiditySweep');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf, bodyW }) => {
        const peak1 = candles[3].h;
        const peak2 = candles[9].h;
        const sweepCandle = candles[15];
        const sweepLineY = yOf(Math.max(peak1, peak2));
        return (
          <>
            <AnimatedG delay={0.1}>
              <line
                x1={xOf(2)}
                y1={sweepLineY}
                x2={xOf(18)}
                y2={sweepLineY}
                stroke="#a855f7"
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
              <Label x={xOf(2) - 6} y={sweepLineY - 4} text="قمة سيولة" color="#a855f7" size={10} anchor="end" />
            </AnimatedG>
            <AnimatedG delay={0.4}>
              <Arrow
                from={{ x: xOf(14), y: yOf(candles[14].c) - 22 }}
                to={{ x: xOf(15), y: yOf(sweepCandle.h) + 4 }}
                color="#ef4444"
              />
              <Label
                x={xOf(15)}
                y={yOf(sweepCandle.h) - 6}
                text="سويب (جمع سيولة)"
                color="#ef4444"
                size={10}
              />
            </AnimatedG>
            <AnimatedG delay={0.7}>
              <Arrow
                from={{ x: xOf(16), y: yOf(candles[18].c) }}
                to={{ x: xOf(19), y: yOf(candles[19].c) + 10 }}
                color="#10b981"
              />
              <Label
                x={xOf(20)}
                y={yOf(candles[18].c) + 18}
                text="ارتداد هابط"
                color="#10b981"
                size={10}
              />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

function MSSChart() {
  const candles = generateSyntheticCandles('mss');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf }) => {
        const low1 = candles[4].l;
        const low2 = candles[11].l;
        const low3 = candles[18].l;
        return (
          <>
            <AnimatedG delay={0.1}>
              <line
                x1={xOf(4)}
                y1={yOf(low1)}
                x2={xOf(11)}
                y2={yOf(low2)}
                stroke="#3b82f6"
                strokeWidth={1.4}
                strokeDasharray="3 3"
              />
              <line
                x1={xOf(11)}
                y1={yOf(low2)}
                x2={xOf(18)}
                y2={yOf(low3)}
                stroke="#3b82f6"
                strokeWidth={1.4}
                strokeDasharray="3 3"
              />
              <Label x={xOf(4)} y={yOf(low1) + 14} text="قاع1" color="#3b82f6" size={9} />
              <Label x={xOf(11)} y={yOf(low2) + 14} text="قاع2 (أعلى)" color="#3b82f6" size={9} />
              <Label x={xOf(18)} y={yOf(low3) + 14} text="قاع3 (أعلى)" color="#3b82f6" size={9} />
            </AnimatedG>
            <AnimatedG delay={0.5}>
              <line
                x1={xOf(18)}
                y1={yOf(low3)}
                x2={xOf(23)}
                y2={yOf(low3)}
                stroke="#ef4444"
                strokeWidth={1.2}
                strokeDasharray="2 2"
              />
              <Arrow
                from={{ x: xOf(21), y: yOf(low3) - 20 }}
                to={{ x: xOf(22), y: yOf(candles[22].l) }}
                color="#ef4444"
              />
              <Label x={xOf(22)} y={yOf(low3) - 26} text="MSS: كسر القاع" color="#ef4444" size={11} />
            </AnimatedG>
            <AnimatedG delay={0.85}>
              <Arrow
                from={{ x: xOf(23), y: yOf(candles[23].o) }}
                to={{ x: xOf(25), y: yOf(candles[25].c) }}
                color="#ef4444"
              />
              <Label x={xOf(25)} y={yOf(candles[25].c) + 16} text="استمرار هابط" color="#ef4444" size={10} />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

function HeadShouldersChart() {
  const candles = generateSyntheticCandles('headShoulders');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf }) => {
        const lsHigh = candles[5].h;
        const headHigh = candles[13].h;
        const rsHigh = candles[21].h;
        const necklineY = yOf(Math.min(candles[6].l, candles[14].l));
        return (
          <>
            <AnimatedG delay={0.1}>
              <line
                x1={xOf(2)}
                y1={necklineY}
                x2={xOf(25)}
                y2={necklineY}
                stroke="#f59e0b"
                strokeWidth={1.6}
                strokeDasharray="5 3"
              />
              <Label x={xOf(25) + 4} y={necklineY + 4} text="خط الرقبة" color="#f59e0b" size={10} anchor="start" />
            </AnimatedG>
            <AnimatedG delay={0.35}>
              <Arrow from={{ x: xOf(5), y: yOf(lsHigh) - 22 }} to={{ x: xOf(5), y: yOf(lsHigh) - 4 }} color="#3b82f6" />
              <Label x={xOf(5)} y={yOf(lsHigh) - 28} text="كتف أيسر" color="#3b82f6" size={10} />
            </AnimatedG>
            <AnimatedG delay={0.55}>
              <Arrow from={{ x: xOf(13), y: yOf(headHigh) - 22 }} to={{ x: xOf(13), y: yOf(headHigh) - 4 }} color="#a855f7" />
              <Label x={xOf(13)} y={yOf(headHigh) - 28} text="الرأس" color="#a855f7" size={11} />
            </AnimatedG>
            <AnimatedG delay={0.75}>
              <Arrow from={{ x: xOf(21), y: yOf(rsHigh) - 22 }} to={{ x: xOf(21), y: yOf(rsHigh) - 4 }} color="#3b82f6" />
              <Label x={xOf(21)} y={yOf(rsHigh) - 28} text="كتف أيمن" color="#3b82f6" size={10} />
            </AnimatedG>
            <AnimatedG delay={1.0}>
              <Arrow
                from={{ x: xOf(23), y: necklineY }}
                to={{ x: xOf(25), y: yOf(candles[25].c) }}
                color="#ef4444"
              />
              <Label x={xOf(25)} y={yOf(candles[25].c) + 14} text="كسر الرقبة" color="#ef4444" size={10} />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

function TrianglesChart() {
  // Three small triangle SVGs side-by-side
  const W = 188;
  const H = 200;
  const pad = 14;

  const renderTriangle = (
    type: 'asc' | 'desc' | 'sym',
    color: string,
    label: string,
    breakoutUp: boolean,
  ) => {
    const top = pad;
    const bot = H - pad - 18;
    const left = pad + 8;
    const right = W - pad - 8;
    const midX = (left + right) / 2;

    let upperLine: [number, number][];
    let lowerLine: [number, number][];

    if (type === 'asc') {
      // top flat, bottom rising
      upperLine = [[left, top + 20], [right, top + 20]];
      lowerLine = [[left, bot], [right, top + 35]];
    } else if (type === 'desc') {
      // top falling, bottom flat
      upperLine = [[left, top + 20], [right, bot]];
      lowerLine = [[left, bot], [right, bot]];
    } else {
      // sym: top falling, bottom rising → apex at right
      upperLine = [[left, top + 15], [right, (top + bot) / 2]];
      lowerLine = [[left, bot], [right, (top + bot) / 2]];
    }

    const breakX = right;
    const breakY = breakoutUp ? (top + 20) - 18 : bot + 18;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* candles hint */}
        {Array.from({ length: 18 }).map((_, i) => {
          const cx = left + (i / 17) * (right - left);
          const isBull = i % 2 === 0;
          const cy = (top + bot) / 2 + Math.sin(i * 0.7) * 6;
          const ch = isBull ? 6 : -6;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy - ch}
              x2={cx}
              y2={cy + ch}
              stroke={isBull ? '#10b981' : '#ef4444'}
              strokeWidth={2}
              opacity={0.55}
            />
          );
        })}
        {/* trendlines */}
        <polyline
          points={upperLine.map(p => p.join(',')).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
        <polyline
          points={lowerLine.map(p => p.join(',')).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
        {/* apex dot */}
        <circle cx={right} cy={(top + bot) / 2} r={2.5} fill={color} />
        {/* breakout arrow */}
        <motion.g
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <Arrow
            from={{ x: midX + 18, y: (top + bot) / 2 }}
            to={{ x: breakX + 6, y: breakoutUp ? top + 4 : bot - 4 }}
            color={breakoutUp ? '#10b981' : '#ef4444'}
          />
        </motion.g>
        <text x={midX} y={bot + 14} textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>
          {label}
        </text>
      </svg>
    );
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="rounded-lg border p-2 bg-muted/20">
        {renderTriangle('asc', '#10b981', 'مثلث صاعد', true)}
      </div>
      <div className="rounded-lg border p-2 bg-muted/20">
        {renderTriangle('desc', '#ef4444', 'مثلث هابط', false)}
      </div>
      <div className="rounded-lg border p-2 bg-muted/20">
        {renderTriangle('sym', '#a855f7', 'مثلث متماثل', true)}
      </div>
    </div>
  );
}

function RSIDivergenceChart() {
  const candles = generateSyntheticCandles('rsiDiv');
  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs text-muted-foreground mb-1">شارت السعر (Price)</div>
        <CandleChart candles={candles}>
          {({ xOf, yOf }) => {
            const p1 = candles[6].h;
            const p2 = candles[18].h;
            return (
              <>
                <AnimatedG delay={0.2}>
                  <line
                    x1={xOf(6)}
                    y1={yOf(p1)}
                    x2={xOf(18)}
                    y2={yOf(p2)}
                    stroke="#ef4444"
                    strokeWidth={1.8}
                  />
                  <Label x={xOf(6)} y={yOf(p1) - 8} text="قمة 1" color="#ef4444" size={9} />
                  <Label x={xOf(18)} y={yOf(p2) - 8} text="قمة أعلى" color="#ef4444" size={9} />
                </AnimatedG>
              </>
            );
          }}
        </CandleChart>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">مؤشر RSI (14)</div>
        <RSIPane />
      </div>
    </div>
  );
}

function RSIPane() {
  // RSI line that diverges from price (lower high)
  const W = CHART_W;
  const H = 110;
  const padL = 44, padR = 14, padT = 8, padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const N = 26;
  // RSI values (0-100)
  const rsi = Array.from({ length: N }, (_, i) => {
    if (i === 6) return 75; // first peak (high)
    if (i === 18) return 68; // second peak (lower) → divergence
    if (i < 6) return 55 + Math.sin(i * 0.6) * 5;
    if (i < 18) return 55 + Math.cos(i * 0.4) * 4;
    return 50 - (i - 18) * 2.5; // downtrend
  });
  const xOf = (i: number) => padL + (i / (N - 1)) * plotW;
  const yOf = (v: number) => padT + plotH - (v / 100) * plotH;
  const pathD = rsi.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" dir="ltr">
      {/* 30/70 lines */}
      {[30, 50, 70].map(v => (
        <g key={v}>
          <line
            x1={padL}
            y1={yOf(v)}
            x2={W - padR}
            y2={yOf(v)}
            stroke="currentColor"
            className="text-border"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text x={6} y={yOf(v) + 4} fontSize="9" className="fill-muted-foreground">{v}</text>
        </g>
      ))}
      {/* RSI line */}
      <motion.path
        d={pathD}
        fill="none"
        stroke="#8b5cf6"
        strokeWidth={1.8}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      {/* Divergence arrows */}
      <AnimatedG delay={1.0}>
        <line x1={xOf(6)} y1={yOf(75)} x2={xOf(18)} y2={yOf(68)} stroke="#ef4444" strokeWidth={1.6} />
        <Label x={xOf(6)} y={yOf(75) - 6} text="RSI قمة 1 (75)" color="#ef4444" size={9} anchor="middle" />
        <Label x={xOf(18)} y={yOf(68) - 6} text="RSI قمة أدنى (68)" color="#ef4444" size={9} anchor="middle" />
      </AnimatedG>
    </svg>
  );
}

function MACDChart() {
  // MACD line + signal line + histogram
  const W = CHART_W;
  const H = CHART_H;
  const padL = 44, padR = 14, padT = 18, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const N = 30;
  const macd: number[] = [];
  const signal: number[] = [];
  for (let i = 0; i < N; i++) {
    const v = Math.sin(i * 0.35) * 2 + Math.cos(i * 0.18) * 1.2 + (i - 15) * 0.06;
    macd.push(+(v ?? 0).toFixed(2));
    const sig = i === 0 ? v : signal[i - 1] + (v - (signal[i - 1] ?? v)) * 0.25;
    signal.push(+(sig ?? 0).toFixed(2));
  }
  const allVals = [...macd, ...signal];
  const minV = Math.min(...allVals) - 0.5;
  const maxV = Math.max(...allVals) + 0.5;
  const xOf = (i: number) => padL + (i / (N - 1)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;
  const macdPath = macd.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');
  const sigPath = signal.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');

  // Find crossover index (macd crosses above signal)
  let crossIdx = -1;
  for (let i = 1; i < N; i++) {
    if (macd[i - 1] < signal[i - 1] && macd[i] >= signal[i]) {
      crossIdx = i;
      break;
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" dir="ltr">
      {/* zero line */}
      <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)} stroke="currentColor" className="text-border" strokeWidth={1.2} />
      <text x={6} y={yOf(0) + 4} fontSize="10" className="fill-muted-foreground">0</text>
      {/* histogram */}
      {macd.map((v, i) => {
        const h = Math.abs(yOf(v) - yOf(0));
        const isPos = v >= 0;
        return (
          <rect
            key={i}
            x={xOf(i) - 3}
            y={isPos ? yOf(v) : yOf(0)}
            width={6}
            height={Math.max(0.5, h)}
            fill={isPos ? '#10b981' : '#ef4444'}
            opacity={0.5}
          />
        );
      })}
      {/* signal line */}
      <motion.path
        d={sigPath}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={1.6}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      {/* macd line */}
      <motion.path
        d={macdPath}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.8}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      {/* crossover marker */}
      {crossIdx >= 0 && (
        <AnimatedG delay={1.4}>
          <circle cx={xOf(crossIdx)} cy={yOf(macd[crossIdx])} r={5} fill="#10b981" stroke="#fff" strokeWidth={2} />
          <Arrow
            from={{ x: xOf(crossIdx), y: yOf(macd[crossIdx]) - 24 }}
            to={{ x: xOf(crossIdx), y: yOf(macd[crossIdx]) - 8 }}
            color="#10b981"
          />
          <Label x={xOf(crossIdx)} y={yOf(macd[crossIdx]) - 30} text="تقاطع شراء" color="#10b981" size={10} />
        </AnimatedG>
      )}
      {/* legend */}
      <g>
        <line x1={padL + 4} y1={padT + 6} x2={padL + 18} y2={padT + 6} stroke="#3b82f6" strokeWidth={2} />
        <text x={padL + 22} y={padT + 9} fontSize="10" className="fill-foreground">MACD</text>
        <line x1={padL + 70} y1={padT + 6} x2={padL + 84} y2={padT + 6} stroke="#f59e0b" strokeWidth={2} />
        <text x={padL + 88} y={padT + 9} fontSize="10" className="fill-foreground">Signal</text>
      </g>
    </svg>
  );
}

function BollingerChart() {
  const candles = generateSyntheticCandles('bollinger');
  // Compute simple SMA(20) and bands
  const period = 20;
  const closes = candles.map(c => c.c);
  const mid: (number | null)[] = closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return avg;
  });
  // For visualization, widen bands more visibly
  const upper: (number | null)[] = closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return avg + (i < 14 ? std * 0.6 + 0.3 : std * 2 + 1.5); // squeeze then expand
  });
  const lower: (number | null)[] = closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return avg - (i < 14 ? std * 0.6 + 0.3 : std * 2 + 1.5);
  });

  const lows = candles.map(c => c.l);
  const highs = candles.map(c => c.h);
  const allVals = [...lows, ...highs, ...(upper.filter(Boolean) as number[]), ...(lower.filter(Boolean) as number[])];
  const minP = Math.min(...allVals) - 1;
  const maxP = Math.max(...allVals) + 1;
  const slot = PLOT_W / candles.length;
  const xOf = (i: number) => PAD.left + i * slot + slot / 2;
  const yOf = (p: number) => PAD.top + PLOT_H - ((p - minP) / (maxP - minP)) * PLOT_H;

  const linePath = (arr: (number | null)[]) => {
    let d = '';
    let started = false;
    arr.forEach((v, i) => {
      if (v == null) return;
      d += `${started ? 'L' : 'M'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  // Squeeze zone shading
  const squeezeStart = xOf(0);
  const squeezeEnd = xOf(13);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" dir="ltr">
      {/* squeeze zone */}
      <rect
        x={squeezeStart}
        y={PAD.top}
        width={squeezeEnd - squeezeStart}
        height={PLOT_H}
        fill="#f59e0b"
        opacity={0.08}
      />
      <text x={(squeezeStart + squeezeEnd) / 2} y={PAD.top + 14} fontSize="11" fill="#f59e0b" textAnchor="middle" fontWeight="700">
        منطقة الانضغاط
      </text>

      {/* candles */}
      {candles.map((c, i) => {
        const isBull = c.c >= c.o;
        const color = isBull ? '#10b981' : '#ef4444';
        const x = xOf(i);
        const bodyW = Math.max(4, slot * 0.6);
        const bodyTop = yOf(Math.max(c.o, c.c));
        const bodyBot = yOf(Math.min(c.o, c.c));
        return (
          <g key={i}>
            <line x1={x} y1={yOf(c.h)} x2={x} y2={yOf(c.l)} stroke={color} strokeWidth={1.2} />
            <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={Math.max(1.5, bodyBot - bodyTop)} fill={color} />
          </g>
        );
      })}

      {/* Bollinger bands */}
      <motion.path
        d={linePath(upper)}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.3 }}
      />
      <motion.path
        d={linePath(mid)}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={1.2}
        strokeDasharray="4 3"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.3 }}
      />
      <motion.path
        d={linePath(lower)}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.3 }}
      />

      {/* expansion arrow */}
      <AnimatedG delay={1.4}>
        <Arrow
          from={{ x: xOf(14), y: yOf(candles[14].o) - 10 }}
          to={{ x: xOf(18), y: yOf(candles[18].c) - 18 }}
          color="#10b981"
        />
        <Label x={xOf(20)} y={yOf(candles[18].c) - 22} text="انفجار صاعد" color="#10b981" size={10} anchor="start" />
      </AnimatedG>

      {/* legend */}
      <g>
        <line x1={PAD.left + 4} y1={PAD.top + 4} x2={PAD.left + 18} y2={PAD.top + 4} stroke="#3b82f6" strokeWidth={2} />
        <text x={PAD.left + 22} y={PAD.top + 7} fontSize="10" className="fill-foreground">الباندات</text>
      </g>
    </svg>
  );
}

/* ───────────────────────── Bar Charts (FA) ──────────────── */

function BarChartFA({
  data,
  unitLabel,
}: {
  data: { label: string; bars: { name: string; value: number; color: string }[]; note?: string }[];
  unitLabel: string;
}) {
  const allVals = data.flatMap(d => d.bars.map(b => b.value));
  const maxV = Math.max(...allVals) * 1.15;
  return (
    <div className="space-y-4">
      {data.map((row, ri) => {
        const groupMax = Math.max(...row.bars.map(b => b.value)) * 1.1;
        return (
          <motion.div
            key={ri}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 * ri, duration: 0.5 }}
            className="space-y-1.5"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">{row.label}</span>
              {row.note && <Badge variant="secondary" className="text-[10px]">{row.note}</Badge>}
            </div>
            <div className="flex items-end gap-2 h-32 border-b border-border/60 pb-1">
              {row.bars.map((b, bi) => (
                <div key={bi} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(b.value / groupMax) * 100}%` }}
                    transition={{ delay: 0.2 + ri * 0.15 + bi * 0.08, duration: 0.6, ease: 'easeOut' }}
                    className="w-full rounded-t-md flex items-start justify-center pt-1"
                    style={{ backgroundColor: b.color, minHeight: 4 }}
                  >
                    <span className="text-[10px] font-bold text-white">
                      {b.value.toFixed(b.value < 10 ? 2 : 0)}
                    </span>
                  </motion.div>
                  <span className="text-[10px] text-muted-foreground">{b.name}</span>
                </div>
              ))}
            </div>
          </motion.div>
        );
      })}
      <div className="text-[10px] text-muted-foreground text-center">{`القيم بـ ${unitLabel}`}</div>
    </div>
  );
}

function PERatioChart() {
  return (
    <BarChartFA
      unitLabel="ج.م"
      data={[
        {
          label: 'البنك التجاري الدولي (CIB)',
          bars: [
            { name: 'السعر', value: 60, color: '#3b82f6' },
            { name: 'EPS', value: 10, color: '#10b981' },
          ],
          note: 'P/E = 6',
        },
        {
          label: 'أوراسكوم للتنمية (ORHD)',
          bars: [
            { name: 'السعر', value: 30, color: '#3b82f6' },
            { name: 'EPS', value: 1, color: '#10b981' },
          ],
          note: 'P/E = 30',
        },
        {
          label: 'اتصالات مصر (ETEL)',
          bars: [
            { name: 'السعر', value: 18, color: '#3b82f6' },
            { name: 'EPS', value: 1.2, color: '#10b981' },
          ],
          note: 'P/E = 15',
        },
      ]}
    />
  );
}

function PBRatioChart() {
  return (
    <BarChartFA
      unitLabel="ج.م"
      data={[
        {
          label: 'سهم يتداول تحت القيمة الدفترية',
          bars: [
            { name: 'السعر السوقي', value: 8, color: '#ef4444' },
            { name: 'القيمة الدفترية', value: 12, color: '#10b981' },
          ],
          note: 'P/B = 0.67 (رخيص)',
        },
        {
          label: 'سهم عند القيمة الدفترية',
          bars: [
            { name: 'السعر السوقي', value: 15, color: '#f59e0b' },
            { name: 'القيمة الدفترية', value: 15, color: '#10b981' },
          ],
          note: 'P/B = 1.0 (عادل)',
        },
        {
          label: 'سهم فوق القيمة الدفترية',
          bars: [
            { name: 'السعر السوقي', value: 45, color: '#3b82f6' },
            { name: 'القيمة الدفترية', value: 15, color: '#10b981' },
          ],
          note: 'P/B = 3.0 (مكلف)',
        },
      ]}
    />
  );
}

function DividendYieldChart() {
  return (
    <BarChartFA
      unitLabel="ج.م / نسبة"
      data={[
        {
          label: 'سهم سعر 50 ج.م يوزّع 2.5 ج.م',
          bars: [
            { name: 'السعر', value: 50, color: '#3b82f6' },
            { name: 'التوزيع السنوي', value: 2.5, color: '#10b981' },
          ],
          note: 'Yield = 5%',
        },
        {
          label: 'سهم سعر 100 ج.م يوزّع 3 ج.م',
          bars: [
            { name: 'السعر', value: 100, color: '#3b82f6' },
            { name: 'التوزيع السنوي', value: 3, color: '#10b981' },
          ],
          note: 'Yield = 3%',
        },
        {
          label: 'سهم سعر 20 ج.م يوزّع 0.4 ج.م',
          bars: [
            { name: 'السعر', value: 20, color: '#3b82f6' },
            { name: 'التوزيع السنوي', value: 0.4, color: '#10b981' },
          ],
          note: 'Yield = 2%',
        },
      ]}
    />
  );
}

function GrahamNumberChart() {
  // Graham = √(22.5 × EPS × BV)
  const calc = (eps: number, bv: number) => Math.sqrt(22.5 * eps * bv);
  const cases = [
    { label: 'سهم رخيص', eps: 5, bv: 40, price: 45 },
    { label: 'سهم عادل', eps: 4, bv: 30, price: 33 },
    { label: 'سهم مكلف', eps: 3, bv: 20, price: 50 },
  ];
  const data = cases.map(c => ({
    label: c.label,
    bars: [
      { name: 'السعر السوقي', value: c.price, color: '#3b82f6' },
      { name: 'Graham Number', value: calc(c.eps, c.bv), color: '#10b981' },
    ],
    note: `EPS=${c.eps} | BV=${c.bv}`,
  }));
  return (
    <div className="space-y-4">
      <BarChartFA unitLabel="ج.م" data={data} />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="rounded-lg border border-profit/40 bg-profit/5 p-3 text-center"
      >
        <div className="text-sm font-bold text-profit dark:text-profit mb-1">
          معادلة Graham
        </div>
        <div dir="ltr" className="font-mono text-base">
          Graham = √(22.5 × EPS × Book Value)
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          22.5 = (P/E=15) × (P/B=1.5) — معايير غراهام للسهم الآمن
        </div>
      </motion.div>
    </div>
  );
}

/* ───────────────────────── Chart Dispatcher ─────────────── */

function StrategyChart({ topicId }: { topicId: string }) {
  switch (topicId) {
    case 'fvg': return <FVGChart />;
    case 'order-block': return <OrderBlockChart />;
    case 'liquidity-sweep': return <LiquiditySweepChart />;
    case 'mss': return <MSSChart />;
    case 'head-shoulders': return <HeadShouldersChart />;
    case 'triangles': return <TrianglesChart />;
    case 'rsi-divergence': return <RSIDivergenceChart />;
    case 'macd-crossover': return <MACDChart />;
    case 'bollinger-squeeze': return <BollingerChart />;
    case 'pe-ratio': return <PERatioChart />;
    case 'pb-ratio': return <PBRatioChart />;
    case 'dividend-yield': return <DividendYieldChart />;
    case 'graham-number': return <GrahamNumberChart />;
    default: return <FVGChart />;
  }
}

/* ───────────────────────── Explanation Panel ────────────── */

function ExplanationPanel({ topic }: { topic: StrategyTopic }) {
  const Icon = topic.icon;
  const cat = CATEGORIES.find(c => c.id === topic.category)!;
  const CatIcon = cat.icon;
  return (
    <motion.div
      key={topic.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-4"
    >
      {/* title */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          <Icon className={cn('size-6', cat.accent)} />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{topic.nameAr}</h3>
            <Badge variant="outline" className="text-[11px]" dir="ltr">{topic.nameEn}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{topic.summary}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <CatIcon className={cn('size-3.5', cat.accent)} />
            <span className="text-[11px] text-muted-foreground">{cat.nameAr}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* explanation bullets */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="size-4 text-primary" />
          <h4 className="font-semibold text-sm">الشرح التفصيلي</h4>
        </div>
        <ul className="space-y-1.5">
          {topic.explanation.map((point, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.4 }}
              className="flex gap-2 text-sm leading-relaxed"
            >
              <span className="text-primary mt-0.5">•</span>
              <span className="text-foreground/90">{point}</span>
            </motion.li>
          ))}
        </ul>
      </div>

      {/* how to trade */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Target className="size-4 text-primary" />
          <h4 className="font-semibold text-sm">كيف تتداوله</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-[11px] font-semibold text-profit mb-0.5">✓ نقطة الدخول</div>
            <div className="text-xs text-foreground/90 leading-relaxed">{topic.howToTrade.entry}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-loss mb-0.5">✗ وقف الخسارة</div>
            <div className="text-xs text-foreground/90 leading-relaxed">{topic.howToTrade.stopLoss}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-sky-600 mb-0.5">◎ الهدف</div>
            <div className="text-xs text-foreground/90 leading-relaxed">{topic.howToTrade.target}</div>
          </div>
        </div>
      </div>

      {/* examples */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="size-4 text-warning" />
          <h4 className="font-semibold text-sm">أمثلة حقيقية</h4>
        </div>
        <div className="space-y-1.5">
          {topic.examples.map((ex, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="flex gap-2 text-xs leading-relaxed text-foreground/80 p-2 rounded-md bg-muted/40 border border-border/40"
            >
              <Badge variant="secondary" className="text-[9px] shrink-0 h-4 px-1.5">مثال</Badge>
              <span>{ex}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ───────────────────────── Main Component ───────────────── */

export function StrategySandbox() {
  const [selectedId, setSelectedId] = React.useState<string>('fvg');
  const [mobileCategory, setMobileCategory] = React.useState<'smc' | 'ta' | 'fa'>('smc');

  const selectedTopic = TOPICS.find(t => t.id === selectedId) ?? TOPICS[0];
  const selectedCat = CATEGORIES.find(c => c.id === selectedTopic.category)!;

  const goPrev = React.useCallback(() => {
    const idx = FLAT_TOPIC_IDS.indexOf(selectedId);
    const newIdx = (idx - 1 + FLAT_TOPIC_IDS.length) % FLAT_TOPIC_IDS.length;
    setSelectedId(FLAT_TOPIC_IDS[newIdx]);
  }, [selectedId]);

  const goNext = React.useCallback(() => {
    const idx = FLAT_TOPIC_IDS.indexOf(selectedId);
    const newIdx = (idx + 1) % FLAT_TOPIC_IDS.length;
    setSelectedId(FLAT_TOPIC_IDS[newIdx]);
  }, [selectedId]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const t = TOPICS.find(x => x.id === id);
    if (t) setMobileCategory(t.category);
  };

  return (
    <div dir="rtl" className="w-full space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between gap-3 flex-wrap py-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
                <Layers className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold leading-tight">مختبر الاستراتيجيات</h2>
                <p className="text-xs text-muted-foreground" dir="ltr">Strategy Chart Sandbox</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px]">
                {FLAT_TOPIC_IDS.indexOf(selectedId) + 1} / {FLAT_TOPIC_IDS.length}
              </Badge>
              <Button variant="outline" size="sm" onClick={goPrev} className="gap-1">
                <ChevronRight className="size-4" />
                السابق
              </Button>
              <Button variant="outline" size="sm" onClick={goNext} className="gap-1">
                التالي
                <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile category tabs */}
      <div className="lg:hidden">
        <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border/60 overflow-x-auto">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const isActive = mobileCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setMobileCategory(cat.id)}
                className={cn(
                  'flex-1 min-w-[100px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-background text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className={cn('size-3.5', isActive && cat.accent)} />
                {cat.nameAr}
              </button>
            );
          })}
        </div>
        {/* mobile topic chips */}
        <ScrollArea className="w-full whitespace-nowrap rounded-md mt-2">
          <div className="flex gap-1.5 p-1">
            {CATEGORIES.find(c => c.id === mobileCategory)?.topics.map(t => {
              const Icon = t.icon;
              const isActive = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-foreground hover:bg-muted'
                  )}
                >
                  <Icon className="size-3.5" />
                  {t.nameAr}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Sidebar — desktop only */}
        <Card className="hidden lg:block h-fit sticky top-4">
          <CardContent className="pt-0">
            <Accordion
              type="single"
              defaultValue={selectedCat.id}
              className="w-full"
            >
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                return (
                  <AccordionItem key={cat.id} value={cat.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('size-4', cat.accent)} />
                        <div className="text-right">
                          <div className="text-sm font-semibold">{cat.nameAr}</div>
                          <div className="text-[10px] text-muted-foreground" dir="ltr">{cat.nameEn}</div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] ml-1">{cat.topics.length}</Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-col gap-1 pt-1">
                        {cat.topics.map(t => {
                          const TIcon = t.icon;
                          const isActive = selectedId === t.id;
                          return (
                            <button
                              key={t.id}
                              onClick={() => handleSelect(t.id)}
                              className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-md text-right text-sm transition-all border',
                                isActive
                                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                  : 'bg-transparent hover:bg-accent border-transparent'
                              )}
                            >
                              <TIcon className="size-4 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="truncate">{t.nameAr}</div>
                                <div className={cn(
                                  'text-[10px] truncate',
                                  isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'
                                )} dir="ltr">{t.nameEn}</div>
                              </div>
                              {isActive && <ChevronLeft className="size-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>

        {/* Main content */}
        <Card>
          <CardContent className="pt-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
                className="space-y-4 py-2"
              >
                {/* Chart area */}
                <div className="rounded-xl border border-border/60 bg-gradient-to-b from-muted/20 to-transparent p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="size-4 text-primary" />
                      <span className="text-sm font-semibold">الشارت التوضيحي</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]" dir="ltr">
                      {selectedTopic.pattern}
                    </Badge>
                  </div>
                  <StrategyChart topicId={selectedId} />
                </div>

                {/* Explanation */}
                <ExplanationPanel topic={selectedTopic} />
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>

      {/* Footer hint */}
      <div className="text-center text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="size-3" />
          محتوى تعليمي لأغراض التعلّم فقط — ليس توقع استثمارية. تداول بمسؤوليتك الكاملة.
        </span>
      </div>
    </div>
  );
}

export default StrategySandbox;
