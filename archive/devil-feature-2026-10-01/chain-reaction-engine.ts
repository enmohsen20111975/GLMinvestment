/**
 * 😈 المحرك 2: محرك السلسلة (Chain Reaction Engine)
 *
 * أي حدث كبير بيأثر على سلسلة من الأسهم والقطاعات، مش سهم واحد.
 *
 * مثال: "الدولار بيطلع 2%"
 * - بنك COMI: 🟢 بيستفيد (عنده دولار)
 * - عقار MNHD: 🔴 بيتضرر (مواد بناء مستوردة)
 * - تجارة SWDY: 🟡 مختلط (بيستورد وبيصدر)
 * - صادرات ESRS: 🟢 بيستفيد بقوة
 */

import type { ChainImpact, ChainReactionResult, MacroEventType } from './types';

// ==================== جدول تأثير الأحداث الكبرى ====================
// لكل حدث: مين بيربح، مين بيخسر، وليه

interface EventChainRule {
  event: MacroEventType;
  description: string;
  // لما الحدث يطلع (up) أو ينزل (down)
  beneficiaries: ChainImpact[];
  sufferers: ChainImpact[];
  mixed: ChainImpact[];
}

const CHAIN_RULES: EventChainRule[] = [
  // ============ الدولار / الجنيه ============
  {
    event: 'usd_egp',
    description: 'الدولار مقابل الجنيه المصري',
    beneficiaries: [
      { ticker: 'COMI', nameAr: 'البنك التجاري الدولي', sector: 'بنوك', direction: 'benefit', impactPercent: 3, reasoning: 'عنده أصول بالدولار + قروض بالجنيه' },
      { ticker: 'ETEL', nameAr: 'المصرية للاتصالات', sector: 'اتصالات', direction: 'benefit', impactPercent: 2.5, reasoning: 'إيرادات دولارية + مصاريف بالجنيه' },
      { ticker: 'SWDY', nameAr: 'السويدي الكتريك', sector: 'صناعة', direction: 'benefit', impactPercent: 4, reasoning: 'مصدّر رئيسي — إيرادات بالدولار' },
      { ticker: 'ESRS', nameAr: 'الشرقية للدخان', sector: 'تبغ', direction: 'benefit', impactPercent: 3.5, reasoning: 'مصدّر بقوة' },
      { ticker: 'FWRY', nameAr: 'فوري', sector: 'تكنولوجيا مالية', direction: 'benefit', impactPercent: 1.5, reasoning: 'إيرادات دولارية من العمليات' },
      { ticker: 'MFPC', nameAr: 'موبكو', sector: 'بتروكيماويات', direction: 'benefit', impactPercent: 4, reasoning: 'مصدّر أسمدة بالدولار' },
      { ticker: 'ABUK', nameAr: 'أبو قير للأسمدة', sector: 'أسمدة', direction: 'benefit', impactPercent: 3.5, reasoning: 'مصدّر — يكسب من فرق العملة' },
    ],
    sufferers: [
      { ticker: 'MNHD', nameAr: 'مدنى للإسكان', sector: 'عقارات', direction: 'suffer', impactPercent: -2.5, reasoning: 'مواد بناء مستوردة' },
      { ticker: 'ORAS', nameAr: 'أوراسكوم للتنمية', sector: 'عقارات', direction: 'suffer', impactPercent: -3, reasoning: 'تكاليف استيراد عالية' },
      { ticker: 'AUTO', nameAr: 'غبور للسيارات', sector: 'سيارات', direction: 'suffer', impactPercent: -4, reasoning: 'استيراد سيارات بالدولار' },
      { ticker: 'CIRA', nameAr: 'سيرا للتعليم', sector: 'تعليم', direction: 'suffer', impactPercent: -1.5, reasoning: 'مصاريف تشغيل مستوردة' },
      { ticker: 'EZZS', nameAr: 'عز الدخان', sector: 'حديد', direction: 'suffer', impactPercent: -2, reasoning: 'خامات مستوردة (خام حديد)' },
    ],
    mixed: [
      { ticker: 'TMGH', nameAr: 'طلعت مصطفى', sector: 'عقارات', direction: 'mixed', impactPercent: 0, reasoning: 'بيبيع بالجنيه بس بيشتري أراضي وأحياناً بالدولار' },
      { ticker: 'HRHO', nameAr: 'مسكن مصر الجديدة', sector: 'عقارات', direction: 'mixed', impactPercent: 0, reasoning: 'أراضي ثمينة لكن مصاريف بناء مستوردة' },
    ],
  },

  // ============ قرار الفائدة (CBE) ============
  {
    event: 'interest_rate',
    description: 'قرار البنك المركزي بشأن الفائدة',
    beneficiaries: [
      { ticker: 'COMI', nameAr: 'البنك التجاري الدولي', sector: 'بنوك', direction: 'benefit', impactPercent: 2, reasoning: 'هامش الفائدة يزيد' },
      { ticker: 'CIEB', nameAr: 'البنك الشرقي', sector: 'بنوك', direction: 'benefit', impactPercent: 2, reasoning: 'هامش الفائدة يزيد' },
      { ticker: 'ETEL', nameAr: 'المصرية للاتصالات', sector: 'اتصالات', direction: 'benefit', impactPercent: 1.5, reasoning: 'كاش ضخم بيربح من الفائدة' },
    ],
    sufferers: [
      { ticker: 'TMGH', nameAr: 'طلعت مصطفى', sector: 'عقارات', direction: 'suffer', impactPercent: -3, reasoning: 'التمويل العقاري يغلو → الطلب يقل' },
      { ticker: 'ORAS', nameAr: 'أوراسكوم للتنمية', sector: 'عقارات', direction: 'suffer', impactPercent: -2.5, reasoning: 'ديون عالية + تكلفة تمويل تزيد' },
      { ticker: 'CIRA', nameAr: 'سيرا للتعليم', sector: 'تعليم', direction: 'suffer', impactPercent: -2, reasoning: 'تمويل استثماري يغلو' },
      { ticker: 'AUTO', nameAr: 'غبور للسيارات', sector: 'سيارات', direction: 'suffer', impactPercent: -2.5, reasoning: 'الائتمان الاستهلاكي يقل' },
    ],
    mixed: [],
  },

  // ============ النفط ============
  {
    event: 'oil_price',
    description: 'سعر النفط الخام',
    beneficiaries: [
      { ticker: 'SIDI', nameAr: 'سيدي كرير', sector: 'طاقة', direction: 'benefit', impactPercent: 5, reasoning: 'إيرادات تزيد مع سعر النفط' },
      { ticker: 'GBCO', nameAr: 'الخليجية', sector: 'طاقة', direction: 'benefit', impactPercent: 4, reasoning: 'إنتاج النفط يكسب' },
    ],
    sufferers: [
      { ticker: 'MFPC', nameAr: 'موبكو', sector: 'بتروكيماويات', direction: 'suffer', impactPercent: -3, reasoning: 'الغاز مكلف → هامش يقل' },
      { ticker: 'EZZS', nameAr: 'عز الدخان', sector: 'حديد', direction: 'suffer', impactPercent: -2, reasoning: 'طاقة مكلفة' },
      { ticker: 'SWDY', nameAr: 'السويدي', sector: 'صناعة', direction: 'suffer', impactPercent: -1.5, reasoning: 'تكلفة طاقة أعلى' },
    ],
    mixed: [],
  },

  // ============ الذهب ============
  {
    event: 'gold_price',
    description: 'سعر الذهب العالمي',
    beneficiaries: [
      { ticker: 'CENT', nameAr: 'سنتيل', sector: 'ذهب', direction: 'benefit', impactPercent: 6, reasoning: 'إنتاج ذهب — ربح مباشر' },
      { ticker: 'MDRS', nameAr: 'الشمس للذهب', sector: 'ذهب', direction: 'benefit', impactPercent: 5, reasoning: 'تعدين ذهب' },
    ],
    sufferers: [],
    mixed: [],
  },

  // ============ الحرب / الصراع ============
  {
    event: 'war_conflict',
    description: 'توترات إقليمية / حرب',
    beneficiaries: [
      { ticker: 'COMI', nameAr: 'البنك التجاري الدولي', sector: 'بنوك', direction: 'benefit', impactPercent: 1, reasoning: 'ملاذ آمن محلي' },
    ],
    sufferers: [
      { ticker: 'TMGH', nameAr: 'طلعت مصطفى', sector: 'عقارات', direction: 'suffer', impactPercent: -5, reasoning: 'السياحة والعقار بيتضرروا' },
      { ticker: 'ORAS', nameAr: 'أوراسكوم', sector: 'عقارات', direction: 'suffer', impactPercent: -4, reasoning: 'استثمارات سياحية' },
      { ticker: 'EGTS', nameAr: 'السياحة', sector: 'سياحة', direction: 'suffer', impactPercent: -6, reasoning: 'السياحة تنهار' },
    ],
    mixed: [],
  },

  // ============ القمح / الأغذية ============
  {
    event: 'wheat_food',
    description: 'سعر القمح والأغذية',
    beneficiaries: [
      { ticker: 'SWDY', nameAr: 'السويدي', sector: 'صناعة', direction: 'benefit', impactPercent: 1.5, reasoning: 'مشاريع زراعية' },
    ],
    sufferers: [
      { ticker: 'OUNT', nameAr: 'يونيفر', sector: 'أغذية', direction: 'suffer', impactPercent: -3, reasoning: 'تكلفة المواد الخام تزيد' },
      { ticker: 'AJWA', nameAr: 'أجوان', sector: 'أغذية', direction: 'suffer', impactPercent: -2, reasoning: 'استيراد القمح' },
    ],
    mixed: [],
  },

  // ============ موسم الأرباح ============
  {
    event: 'earnings_season',
    description: 'بداية موسم الأرباح',
    beneficiaries: [],
    sufferers: [],
    mixed: [
      { ticker: 'ALL', nameAr: 'كل الأسهم', sector: 'متنوع', direction: 'mixed', impactPercent: 0, reasoning: 'التذبذب عالي — الأسهم اللي نتائجها كويسة بتطلع، اللي سيئة بتخسر' },
    ],
  },

  // ============ قرار تنظيمي ============
  {
    event: 'regulatory',
    description: 'قرار تنظيمي حكومي',
    beneficiaries: [],
    sufferers: [],
    mixed: [
      { ticker: 'ALL', nameAr: 'متغير', sector: 'متنوع', direction: 'mixed', impactPercent: 0, reasoning: 'يعتمد على نوع القرار والقطاع المستهدف' },
    ],
  },
];

// ==================== تشغيل المحرك ====================

export function runChainReaction(
  event: MacroEventType,
  eventDirection: 'up' | 'down' = 'up',
  magnitude: number = 2
): ChainReactionResult {
  const rule = CHAIN_RULES.find(r => r.event === event);
  if (!rule) {
    return {
      event,
      eventDescription: 'حدث غير معروف',
      eventDirection,
      magnitude,
      beneficiaries: [],
      sufferers: [],
      mixed: [],
      devilVerdict: 'مفيش بيانات كافية عن هذا الحدث.',
    };
  }

  // لو الحدث نزل (مثلاً الدولار نزل)، اعكس المستفيدين والمتضررين
  let beneficiaries = [...rule.beneficiaries];
  let sufferers = [...rule.sufferers];
  let mixed = [...rule.mixed];

  if (eventDirection === 'down') {
    // عكس: اللي كان بيكسب بقى يخسر والعكس
    const temp = beneficiaries.map(b => ({ ...b, direction: 'suffer' as const, impactPercent: -b.impactPercent * 0.7 }));
    beneficiaries = sufferers.map(s => ({ ...s, direction: 'benefit' as const, impactPercent: -s.impactPercent * 0.7 }));
    sufferers = temp;
  }

  // تعديل حسب حجم الحدث
  const scale = magnitude / 2; // 2% = حجم طبيعي
  beneficiaries = beneficiaries.map(b => ({ ...b, impactPercent: b.impactPercent * scale }));
  sufferers = sufferers.map(s => ({ ...s, impactPercent: s.impactPercent * scale }));

  // ترتيب حسب التأثير
  beneficiaries.sort((a, b) => b.impactPercent - a.impactPercent);
  sufferers.sort((a, b) => a.impactPercent - b.impactPercent);

  // كلام الشيطان
  const topBenefit = beneficiaries[0];
  const topSuffer = sufferers[0];
  let devilVerdict = `${rule.description} ${eventDirection === 'up' ? 'طلع' : 'نزل'} ${magnitude.toFixed(1)}%. `;

  if (topBenefit && topSuffer) {
    devilVerdict += `أكبر مستفيد: ${topBenefit.ticker} (+${topBenefit.impactPercent.toFixed(1)}%). أكبر متضرر: ${topSuffer.ticker} (${topSuffer.impactPercent.toFixed(1)}%). `;
    devilVerdict += `اللعبة: اشترِ المستفيدين، ابتعد عن المتضررين.`;
  } else if (topBenefit) {
    devilVerdict += `المستفيدون: ${beneficiaries.map(b => b.ticker).join(', ')}. `;
  } else if (topSuffer) {
    devilVerdict += `المتضررون: ${sufferers.map(s => s.ticker).join(', ')}. `;
  }

  return {
    event,
    eventDescription: rule.description,
    eventDirection,
    magnitude,
    beneficiaries,
    sufferers,
    mixed,
    devilVerdict,
  };
}

// ==================== كشف الحدث من نص الخبر ====================

export function detectMacroEventFromTitle(
  title: string
): { event: MacroEventType; direction: 'up' | 'down'; magnitude: number } | null {
  const lower = title.toLowerCase();

  // الدولار
  if (lower.includes('دولار') || lower.includes('dollar') || lower.includes('usd') || lower.includes('جنيه')) {
    if (lower.includes('نزل') || lower.includes('انخفض') || lower.includes('down') || lower.includes('fall')) {
      return { event: 'usd_egp', direction: 'down', magnitude: 1.5 };
    }
    return { event: 'usd_egp', direction: 'up', magnitude: 1.5 };
  }

  // الفائدة
  if (lower.includes('فائدة') || lower.includes('interest') || lower.includes('cbe') || lower.includes('مركزي')) {
    if (lower.includes('خفض') || lower.includes('cut') || lower.includes('lower')) {
      return { event: 'interest_rate', direction: 'down', magnitude: 1 };
    }
    return { event: 'interest_rate', direction: 'up', magnitude: 1 };
  }

  // النفط
  if (lower.includes('نفط') || lower.includes('oil') || lower.includes('بترول')) {
    if (lower.includes('نزل') || lower.includes('انخفض')) {
      return { event: 'oil_price', direction: 'down', magnitude: 2 };
    }
    return { event: 'oil_price', direction: 'up', magnitude: 2 };
  }

  // الذهب
  if (lower.includes('ذهب') || lower.includes('gold')) {
    if (lower.includes('نزل') || lower.includes('انخفض')) {
      return { event: 'gold_price', direction: 'down', magnitude: 1.5 };
    }
    return { event: 'gold_price', direction: 'up', magnitude: 1.5 };
  }

  return null;
}

// ==================== تأثير سهم معين من حدث ====================

export function getStockImpactFromEvent(
  ticker: string,
  event: MacroEventType,
  eventDirection: 'up' | 'down' = 'up'
): ChainImpact | null {
  const result = runChainReaction(event, eventDirection);
  const all = [...result.beneficiaries, ...result.sufferers, ...result.mixed];
  return all.find(c => c.ticker === ticker) || null;
}
