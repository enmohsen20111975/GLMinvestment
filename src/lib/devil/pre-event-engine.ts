/**
 * 😈 المحرك 3: محرك اللعب قبل الحدث (Pre-Event Engine)
 *
 * قبل الحدث المهم (اجتماع CBE، تقارير أرباح، انتخابات)،
 * احسب القيمة المتوقعة (Expected Value).
 *
 * مثال: CBE بعد 3 أيام
 * - احتمال يرفع: 40% → السهم ينزل 5%
 * - احتمال يسيبها: 40% → السهم يعرض +1%
 * - احتمال يخفض: 20% → السهم يطلع 8%
 * - EV = (40% × -5%) + (40% × +1%) + (20% × +8%) = -0.8%
 * - EV سالبة → انتظر
 */

import type { PreEventAnalysis, ScenarioOutcome } from './types';

// ==================== سيناريوهات الأحداث المعروفة ====================

interface EventScenarioTemplate {
  eventType: 'cbe_meeting' | 'earnings' | 'agm' | 'regulatory' | 'ipo';
  scenarios: ScenarioOutcome[];
  investorPlayTemplate: string;
  gamblerPlayTemplate: string;
}

const SCENARIO_TEMPLATES: Record<string, EventScenarioTemplate> = {
  cbe_meeting: {
    eventType: 'cbe_meeting',
    scenarios: [
      { name: 'رفع الفائدة 100 نقطة', probability: 0.40, priceImpact: -5 },
      { name: 'إبقاء الفائدة', probability: 0.45, priceImpact: 1 },
      { name: 'خفض الفائدة 100 نقطة', probability: 0.15, priceImpact: 8 },
    ],
    investorPlayTemplate: 'انتظر قرار CBE — القيمة المتوقعة سالبة. اشترِ بعد القرار لو خفض.',
    gamblerPlayTemplate: 'لو مغامر: باع بنوك قبل القرار بيومين، اشترِ ESRS و ORWE لو خفض الفائدة.',
  },
  earnings: {
    eventType: 'earnings',
    scenarios: [
      { name: 'نتائج أفضل من المتوقع', probability: 0.30, priceImpact: 6 },
      { name: 'نتائج مطابقة', probability: 0.45, priceImpact: 0 },
      { name: 'نتائج أضعف من المتوقع', probability: 0.25, priceImpact: -7 },
    ],
    investorPlayTemplate: 'انتظر النتائج — القيمة المتوقعة ضعيفة. اشترِ بعدها لو كويسة.',
    gamblerPlayTemplate: 'لو مغامر: العب على المفاجأة — اشترِ لو السهم نزل 15% قبل التقرير (قمة التشاؤم).',
  },
  agm: {
    eventType: 'agm',
    scenarios: [
      { name: 'توزيع أعلى من المتوقع', probability: 0.35, priceImpact: 4 },
      { name: 'توزيع مطابق', probability: 0.50, priceImpact: 1 },
      { name: 'توزيع أقل / لا توزيع', probability: 0.15, priceImpact: -5 },
    ],
    investorPlayTemplate: 'الجمعية فرصة للتوزيع — القيمة المتوقعة موجبة. اشترِ قبلها بأسبوع.',
    gamblerPlayTemplate: 'لو مغامر: اشترِ قبل الجمعية بيومين وبع بيع يوم الجمعية (Buy the rumor, sell the news).',
  },
  regulatory: {
    eventType: 'regulatory',
    scenarios: [
      { name: 'قرار إيجابي', probability: 0.25, priceImpact: 10 },
      { name: 'قرار محايد', probability: 0.40, priceImpact: 0 },
      { name: 'قرار سلبي', probability: 0.35, priceImpact: -8 },
    ],
    investorPlayTemplate: 'القرار التنظيمي = مخاطرة عالية. انتظر الوضوح.',
    gamblerPlayTemplate: 'لو مغامر: العب قبل القرار بيوم — لكن احط وقف خسارة قوي.',
  },
  ipo: {
    eventType: 'ipo',
    scenarios: [
      { name: 'ارتفاع أول يوم 20%+', probability: 0.30, priceImpact: 20 },
      { name: 'ارتفاع معتدل', probability: 0.40, priceImpact: 5 },
      { name: 'نزول تحت سعر الاكتتاب', probability: 0.30, priceImpact: -10 },
    ],
    investorPlayTemplate: 'الاكتتابات الجديدة مخاطرة — انتظر 30 يوم للاستقرار.',
    gamblerPlayTemplate: 'لو مغامر: اشترِ أول يوم بس احط وقف خسارة 5%.',
  },
};

// ==================== حساب القيمة المتوقعة ====================

export function calculateExpectedValue(scenarios: ScenarioOutcome[]): number {
  return scenarios.reduce((ev, s) => ev + s.probability * s.priceImpact, 0);
}

// ==================== تحديد القرار من EV ====================

export function verdictFromEV(ev: number): PreEventAnalysis['verdict'] {
  if (ev > 1.5) return 'buy_before';
  if (ev < -1.5) return 'wait';
  if (ev < -3) return 'sell_before';
  return 'neutral';
}

// ==================== تشغيل المحرك لسهم معين ====================

export async function runPreEventEngine(ticker: string): Promise<PreEventAnalysis | null> {
  // نجيب الأحداث الجاية للسهم
  const upcomingEvents = await checkUpcomingEvents(ticker, 30);

  if (upcomingEvents.length === 0) {
    return null;
  }

  // نختار أقرب حدث
  const nearestEvent = upcomingEvents.sort((a, b) => {
    return new Date(a.event_date).getTime() - new Date(b.event_date).getTime();
  })[0];

  const eventDate = new Date(nearestEvent.event_date);
  const now = new Date();
  const daysUntil = Math.ceil((eventDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  // نختار القالب المناسب
  let templateKey: string;
  if (nearestEvent.event_type === 'earnings') templateKey = 'earnings';
  else if (nearestEvent.event_type === 'corporate_action') templateKey = 'agm';
  else if (nearestEvent.event_type === 'regulatory') templateKey = 'regulatory';
  else if (nearestEvent.event_type === 'ipo') templateKey = 'ipo';
  else templateKey = 'earnings'; // default

  const template = SCENARIO_TEMPLATES[templateKey];

  // لو الحدث إتنين أقل → القاعدة 4: السوق بيتحرك قبل الحدث بيومين
  let adjustedScenarios = template.scenarios;
  let extraNote = '';

  if (daysUntil <= 2 && daysUntil > 0) {
    extraNote = ' ⚠️ السوق بيحسب الحدث دلوقتي — تحرك قبل ما يحصل.';
    // مضاعفة التأثير لأن السوق بيتسعر
    adjustedScenarios = template.scenarios.map(s => ({ ...s, priceImpact: s.priceImpact * 1.3 }));
  } else if (daysUntil <= 0) {
    extraNote = ' ⚠️ الحدث حصل — السوق بيتسعر النتيجة.';
  }

  const ev = calculateExpectedValue(adjustedScenarios);
  const verdict = verdictFromEV(ev);

  let devilVerdict = `الحدث: ${nearestEvent.title} (بعد ${daysUntil} يوم). `;
  devilVerdict += `القيمة المتوقعة: ${ev.toFixed(2)}%. `;

  if (verdict === 'buy_before') {
    devilVerdict += `🟢 اللعبة: اشترِ قبل الحدث.`;
  } else if (verdict === 'wait') {
    devilVerdict += `🟡 اللعبة: انتظر.`;
  } else if (verdict === 'sell_before') {
    devilVerdict += `🔴 اللعبة: بيع قبل الحدث.`;
  } else {
    devilVerdict += `⚪ اللعبة: محايد — مش فرصة قوية.`;
  }

  devilVerdict += extraNote;

  return {
    eventName: nearestEvent.title,
    eventDate: nearestEvent.event_date,
    daysUntil,
    scenarios: adjustedScenarios,
    expectedValue: parseFloat(ev.toFixed(2)),
    verdict,
    devilVerdict,
    investorPlay: template.investorPlayTemplate + extraNote,
    gamblerPlay: template.gamblerPlayTemplate + extraNote,
  };
}

// ==================== محرك مبسط لحدث CBE عام ====================

export function runCBEScenario(stockType: 'bank' | 'real_estate' | 'exporter' | 'importer'): PreEventAnalysis {
  const scenarios: ScenarioOutcome[] = [
    { name: 'رفع الفائدة 200 نقطة', probability: 0.35, priceImpact: stockType === 'bank' ? 3 : -5 },
    { name: 'رفع 100 نقطة', probability: 0.30, priceImpact: stockType === 'bank' ? 1.5 : -2.5 },
    { name: 'إبقاء الفائدة', probability: 0.25, priceImpact: 0.5 },
    { name: 'خفض 100 نقطة', probability: 0.10, priceImpact: stockType === 'bank' ? -2 : 6 },
  ];

  const ev = calculateExpectedValue(scenarios);
  const verdict = verdictFromEV(ev);

  return {
    eventName: 'اجتماع البنك المركزي المصري (CBE)',
    eventDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    daysUntil: 3,
    scenarios,
    expectedValue: parseFloat(ev.toFixed(2)),
    verdict,
    devilVerdict: `CBE بعد 3 أيام. القيمة المتوقعة: ${ev.toFixed(2)}%.`,
    investorPlay: verdict === 'wait' ? 'انتظر قرار CBE' : 'اشترِ بعد القرار',
    gamblerPlay: 'لو مغامر: باع بنوك، اشترِ صادرات لو خفض الفائدة',
  };
}
