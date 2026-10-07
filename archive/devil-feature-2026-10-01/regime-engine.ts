/**
 * 😈 المحرك 5: محرك السياق (Regime + Seasonality Engine)
 *
 * نفس الخبر معناه حاجة مختلفة حسب وضع السوق والشهر.
 *
 * | وضع السوق | الخبر الكويس | الخبر السيء |
 * |-----------|-------------|-------------|
 * | Bull      | 🟢 اشتري    | 🟢 اشتري (فرصة) |
 * | Bear      | 🔴 ابعد     | 🔴 ابعد     |
 * | Range     | 🟡 انتظر    | 🟡 انتظر    |
 */

import type { MarketRegime, RegimeSeasonalityResult, SeasonalityFactor } from './types';

// ==================== الموسمية المصرية ====================

const SEASONALITY_TABLE: SeasonalityFactor[] = [
  {
    month: 1, // يناير
    factorName: 'January Effect',
    description: 'الأسهم الصغيرة بتطير — تأثير يناير الشهير. الصغير بيتحرك أكتر من الكبير.',
    effect: 'positive',
    strength: 0.7,
  },
  {
    month: 2,
    factorName: 'بداية النشاط',
    description: 'السوق بيستعيد نشاطه بعد العطلات. سيولة معتدلة.',
    effect: 'positive',
    strength: 0.4,
  },
  {
    month: 3, // مارس
    factorName: 'موسم الأرباح السنوية',
    description: 'شركات كتير بتعلن نتائج السنة المالية. تذبذب عالي قبل وبعد الإعلانات.',
    effect: 'caution',
    strength: 0.8,
  },
  {
    month: 4,
    factorName: 'ما بعد الموسم',
    description: 'استقرار نسبي بعد موسم الأرباح. السوق بيختار اتجاهه.',
    effect: 'neutral',
    strength: 0.3,
  },
  {
    month: 5,
    factorName: 'ربيع هادي',
    description: 'أقل تذبذب. السوق عرضي غالباً.',
    effect: 'neutral',
    strength: 0.3,
  },
  {
    month: 6, // رمضان غالباً يبدأ
    factorName: 'بداية رمضان / نهاية ربع',
    description: 'نهاية الربع الثاني + بداية رمضان. سيولة بتقل تدريجياً. profit taking شائع.',
    effect: 'negative',
    strength: 0.6,
  },
  {
    month: 7, // رمضان كامل
    factorName: 'رمضان — سوق ميت',
    description: 'رمضان = سيولة منخفضة جداً. أي حركة مبالغ فيها = مش حقيقية. متقامرش.',
    effect: 'caution',
    strength: 0.9,
  },
  {
    month: 8, // عيد + بداية موسم
    factorName: 'ما بعد رمضان',
    description: 'السيولة بترجع تدريجياً بعد العيد. فرص بتظهر في النص التاني.',
    effect: 'positive',
    strength: 0.5,
  },
  {
    month: 9,
    factorName: 'العودة للنشاط',
    description: 'السوق بيرجع لشغله. سيولة كويسة. موسم العقارات يبدأ.',
    effect: 'positive',
    strength: 0.6,
  },
  {
    month: 10,
    factorName: 'أكتوبر — شهر التقلبات',
    description: 'تاريخياً شهر تقلبات. احذر الفخاخ. أخبار عالمية كتير.',
    effect: 'caution',
    strength: 0.7,
  },
  {
    month: 11,
    factorName: 'استقرار شتوي',
    description: 'السوق بيستقر. سيولة كويسة. توزيعات بدأ.',
    effect: 'positive',
    strength: 0.5,
  },
  {
    month: 12, // Window dressing
    factorName: 'Window Dressing',
    description: 'الصناديق بتظبط محافظها قبل نهاية السنة. أسهم "الزرقة" بتطلع.',
    effect: 'positive',
    strength: 0.6,
  },
];

// ==================== كشف الموسمية ====================

export function getSeasonality(date: Date = new Date()): SeasonalityFactor {
  const month = date.getMonth() + 1; // 1-12
  return SEASONALITY_TABLE.find(s => s.month === month) || SEASONALITY_TABLE[0];
}

// ==================== تحديد وضع السوق (Regime) ====================

export function detectMarketRegime(
  egx30Change30d: number,
  egx30Change5d: number
): MarketRegime {
  // لو السوق طلع أكتر من 3% في 30 يوم = Bull
  if (egx30Change30d > 3) return 'bull';
  // لو نزل أكتر من 3% في 30 يوم = Bear
  if (egx30Change30d < -3) return 'bear';
  // لو التغير بين -3% و +3% = Range
  if (Math.abs(egx30Change30d) <= 3) {
    // لو في تحول حاد في 5 أيام = Transition
    if (Math.abs(egx30Change5d) > 2) return 'transition';
    return 'range';
  }
  return 'range';
}

// ==================== تفسير الخبر حسب السياق ====================

export function interpretNewsInContext(
  newsSentiment: 'positive' | 'negative' | 'neutral',
  regime: MarketRegime
): 'buy' | 'wait' | 'avoid' {
  const table: Record<MarketRegime, Record<string, 'buy' | 'wait' | 'avoid'>> = {
    bull: {
      positive: 'buy',   // الاتجاه معاك
      negative: 'buy',   // التراجع فرصة في السوق الصاعد
      neutral: 'wait',
    },
    bear: {
      positive: 'avoid', // الارتداد مؤقت
      negative: 'avoid', // الاتجاه ضدك
      neutral: 'avoid',
    },
    range: {
      positive: 'wait',  // ممكن يكسر فوق
      negative: 'wait',  // ممكن يكسر تحت
      neutral: 'wait',
    },
    transition: {
      positive: 'wait',
      negative: 'wait',
      neutral: 'wait',
    },
  };

  return table[regime][newsSentiment] || 'wait';
}

// ==================== المحرك الكامل ====================

export function runRegimeEngine(
  egx30Change30d: number = 0,
  egx30Change5d: number = 0,
  newsSentiment: 'positive' | 'negative' | 'neutral' = 'neutral'
): RegimeSeasonalityResult {
  const regime = detectMarketRegime(egx30Change30d, egx30Change5d);
  const seasonality = getSeasonality();
  const newsInterpretation = interpretNewsInContext(newsSentiment, regime);

  const regimeDescriptions: Record<MarketRegime, string> = {
    bull: 'السوق صاعد (Bull) — الاتجاه مع المشترين. الأخبار الكويسة بتتحرك، والسيئة بتعدي.',
    bear: 'السوق هابط (Bear) — الاتجاه مع البائعين. الارتدادات مؤقتة. احذر.',
    range: 'السوق عرضي (Range) — مفيش اتجاه واضح. انتظر الكسر.',
    transition: 'السوق في تحول (Transition) — التذبذب عالي. انتظر الوضوح.',
  };

  const regimeAr: Record<MarketRegime, string> = {
    bull: 'صاعد 🐂',
    bear: 'هابط 🐻',
    range: 'عرضي ➡️',
    transition: 'تحول 🔄',
  };

  let devilVerdict = `السوق ${regimeAr[regime]} — ${seasonality.factorName}. `;

  if (seasonality.effect === 'caution') {
    devilVerdict += `⚠️ ${seasonality.description} `;
  }

  if (regime === 'bull') {
    devilVerdict += 'الأخبار الكويسة = اشترِ. الأخبار السيئة = فرصة شراء.';
  } else if (regime === 'bear') {
    devilVerdict += 'الأخبار الكويسة = فخ. الأخبار السيئة = ابعد.';
  } else {
    devilVerdict += 'انتظر الكسر (فوق للشراء، تحت للابتعاد).';
  }

  return {
    regime,
    regimeDescription: regimeDescriptions[regime],
    seasonality,
    newsInterpretation,
    devilVerdict,
  };
}

export const REGIME_AR: Record<MarketRegime, string> = {
  bull: 'صاعد',
  bear: 'هابط',
  range: 'عرضي',
  transition: 'تحول',
};
