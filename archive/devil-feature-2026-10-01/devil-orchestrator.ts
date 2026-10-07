/**
 * 😈 الـ Orchestrator — اللي بيجمع الـ 5 محركات
 *
 * يبني كارت الشيطان الكامل من كل المحركات.
 *
 * التسليم اللي لازم يتحقق:
 * 1. كارت "😈 رأي الشيطان" في صفحة السهم
 * 2. الكارت بيقول حاجة مختلفة عن "الخبر"
 * 3. فيه "السلسلة" (مين هيستفيد ومين هيخسر)
 * 4. فيه "اللعبة" (لو مستثمر اعمل إيه، لو مغامر اعمل إيه)
 * 5. القواعد الذهبية المفعّلة
 * 6. درجة الشيطان الإجمالية
 */

import type {
  DevilCard,
  DevilContext,
  DivergenceSignal,
  ChainImpact,
  ChainReactionResult,
  PreEventAnalysis,
  ContrarianSignal,
  RegimeSeasonalityResult,
  GoldenRule,
} from './types';
import { analyzeDivergence, quickDivergence } from './divergence-engine';
import { runChainReaction, detectMacroEventFromTitle, getStockImpactFromEvent } from './chain-reaction-engine';
import { runPreEventEngine } from './pre-event-engine';
import { analyzeContrarian, calculatePricePercentile, detectVolumePattern, estimateCrowdSentiment } from './contrarian-engine';
import { runRegimeEngine } from './regime-engine';
import { getUpcomingEventsForTicker } from './event-calendar';

// ==================== القواعد الذهبية الثمانية ====================

export const GOLDEN_RULES: GoldenRule[] = [
  {
    id: 1,
    name: 'السوق صح — أنا غلط',
    description: 'لو تحليلك بيقول "اشترِ" والسوق بيقول "بيع" (السهم نزل بعد خبر كويس) → السوق صح. غير رأيك فوراً',
    check: (ctx) => {
      return ctx.newsSentiment !== undefined && ctx.newsSentiment > 20 &&
             ctx.priceReaction !== undefined && ctx.priceReaction < -0.5;
    },
    message: '🚨 القاعدة 1: السوق صح، أنا غلط — خبر كويس بس السعر نزل = ابعد',
  },
  {
    id: 2,
    name: 'مفيش سهم بيطلع لوحده',
    description: 'لو السهم طالع والسوق نازل = تمرد ممكن ينقلب',
    check: (ctx) => {
      return ctx.marketRegime === 'bear' && ctx.priceReaction !== undefined && ctx.priceReaction > 1;
    },
    message: '⚠️ القاعدة 2: السهم بيت pedig لكن السوق نازل — ده "تمرد" ممكن ينقلب. احذر',
  },
  {
    id: 3,
    name: 'السيولة هي الحقيقة',
    description: 'أي حركة من غير سيولة = كذب. أي حركة مع سيولة = حقيقة',
    check: (ctx) => {
      return ctx.volumeRatio !== undefined && ctx.volumeRatio < 0.7 &&
             ctx.priceReaction !== undefined && Math.abs(ctx.priceReaction) > 1;
    },
    message: '⚠️ القاعدة 3: حركة من غير سيولة = كذب — السيولة منخفضة، الحركة مش موثوقة',
  },
  {
    id: 4,
    name: 'قبل الحدث بيومين، السوق بيتحرك',
    description: 'لو عندك حدث مهم بعد 48 ساعة → السوق بيحسبه دلوقتي. ماتستنىش الحدث',
    check: (ctx) => {
      return ctx.upcomingEventDays !== undefined && ctx.upcomingEventDays > 0 && ctx.upcomingEventDays <= 2;
    },
    message: '📅 القاعدة 4: الحدث بعد يومين — السوق بيتحرك دلوقتي. العب قبل ما يحصل',
  },
  {
    id: 5,
    name: 'بعد الحدث بـ 30 دقيقة، تعرف مين كسب',
    description: 'لو السهم نزل بعد خبر كويس → حد كبير بيبيع. ابعد',
    check: (ctx) => {
      return ctx.newsSentiment !== undefined && ctx.newsSentiment > 20 &&
             ctx.priceReaction !== undefined && ctx.priceReaction < -0.3;
    },
    message: '🚨 القاعدة 5: بعد الخبر بـ 30 دقيقة — حد كبير بيبيع. ابعد',
  },
  {
    id: 6,
    name: 'السهم في percentile 5% = إما كنز إما فخ',
    description: 'لو السهم رخيص جداً عن تاريخه → اسأل "ليه محدش بيشتريه؟" قبل ما تشترِ',
    check: (ctx) => {
      return ctx.pricePercentile !== undefined && ctx.pricePercentile <= 5;
    },
    message: '⚠️ القاعدة 6: السهم في percentile 5% — كنز ولا فخ؟ اسأل ليه محدش بيشتريه',
  },
  {
    id: 7,
    name: 'رمضان = سوق ميت',
    description: 'في رمضان، أي حركة مبالغ فيها = مش حقيقية. متقامرش',
    check: (ctx) => {
      return ctx.month === 7 || ctx.month === 6; // يونيو/يوليه (رمضان غالباً)
    },
    message: '⚠️ القاعدة 7: رمضان — السوق ميت. الحركات المبالغ فيها = مش حقيقية. متقامرش',
  },
  {
    id: 8,
    name: 'يناير = الأسهم الصغيرة بتطير',
    description: 'في يناير، الصغير بيطلع أكتر من الكبير. العكس في يونيو',
    check: (ctx) => {
      return ctx.month === 1;
    },
    message: '🟢 القاعدة 8: يناير — الأسهم الصغيرة بتطير. ابحث عن الصغير',
  },
];

// ==================== فحص القواعد ====================

export function checkGoldenRules(ctx: DevilContext): string[] {
  const triggered: string[] = [];
  for (const rule of GOLDEN_RULES) {
    try {
      if (rule.check(ctx)) {
        triggered.push(rule.message);
      }
    } catch {
      // skip if check fails
    }
  }
  return triggered;
}

// ==================== بناء كارت الشيطان الكامل ====================

export interface DevilCardInput {
  ticker: string;
  nameAr?: string;
  price?: number;
  currentChange?: number; // % تغير اليوم
  volumeRatio?: number;   // نسبة السيولة
  newsSentiment?: 'positive' | 'negative' | 'neutral';
  newsTitle?: string;
  historicalPrices?: number[]; // لحساب percentile
  averageVolume?: number;
  currentVolume?: number;
  egx30Change30d?: number;
  egx30Change5d?: number;
  egx30ChangeToday?: number;
  gainers?: number;
  losers?: number;
}

export async function buildDevilCard(input: DevilCardInput): Promise<DevilCard> {
  const {
    ticker,
    nameAr,
    price,
    currentChange = 0,
    volumeRatio = 1,
    newsSentiment = 'neutral',
    newsTitle,
    historicalPrices = [],
    egx30Change30d = 0,
    egx30Change5d = 0,
  } = input;

  const now = new Date();
  const month = now.getMonth() + 1;

  // ============ 1. محرك السياق (Regime + Seasonality) ============
  const regime: RegimeSeasonalityResult = runRegimeEngine(
    egx30Change30d,
    egx30Change5d,
    newsSentiment
  );

  // ============ 2. محرك التناقض (Divergence) ============
  let divergence: DivergenceSignal | undefined;
  if (newsTitle && input.currentChange !== undefined) {
    divergence = quickDivergence(newsSentiment, currentChange, volumeRatio);
  }

  // ============ 3. محرك السلسلة (Chain Reaction) ============
  let chainReaction: ChainReactionResult | undefined;
  let chainBeneficiaries: ChainImpact[] = [];
  let chainSufferers: ChainImpact[] = [];

  if (newsTitle) {
    const detected = detectMacroEventFromTitle(newsTitle);
    if (detected) {
      chainReaction = runChainReaction(detected.event, detected.direction, detected.magnitude);
      chainBeneficiaries = chainReaction.beneficiaries;
      chainSufferers = chainReaction.sufferers;
    }
  }

  // ============ 4. محرك اللعب قبل الحدث (Pre-Event) ============
  let preEvent: PreEventAnalysis | undefined;
  try {
    preEvent = await runPreEventEngine(ticker);
  } catch {
    // skip if fails
  }

  // ============ 5. محرك العكسية (Contrarian) ============
  let contrarian: ContrarianSignal | undefined;
  if (historicalPrices.length > 0 && price) {
    const pricePercentile = calculatePricePercentile(price, historicalPrices);
    const volumePattern = detectVolumePattern(
      input.currentVolume || 100,
      input.averageVolume || 100
    );
    const crowdSentiment = estimateCrowdSentiment(
      newsTitle ? [{ sentiment: newsSentiment }] : []
    );
    contrarian = analyzeContrarian(crowdSentiment, pricePercentile, volumePattern);
  }

  // ============ فحص القواعد الذهبية ============
  const upcomingEvents = getUpcomingEventsForTicker(ticker);
  const nearestEventDays = upcomingEvents.length > 0 ? upcomingEvents[0].daysUntil : undefined;

  const ctx: DevilContext = {
    ticker,
    price,
    newsSentiment: newsSentiment === 'positive' ? 50 : newsSentiment === 'negative' ? -50 : 0,
    priceReaction: currentChange,
    marketRegime: regime.regime,
    pricePercentile: contrarian?.pricePercentile,
    volumeRatio,
    upcomingEventDays: nearestEventDays,
    month,
  };

  const goldenRules = checkGoldenRules(ctx);

  // ============ حساب درجة الشيطان الإجمالية ============
  let devilScore = 0;

  if (divergence) devilScore += divergence.signalScore * 0.3;
  if (contrarian) {
    const cScore = contrarian.signal === 'strong_buy' ? 40 : contrarian.signal === 'buy' ? 20 :
                   contrarian.signal === 'sell' ? -20 : contrarian.signal === 'strong_sell' ? -40 : 0;
    devilScore += cScore * 0.25;
  }
  if (preEvent) devilScore += preEvent.expectedValue * 3 * 0.2; // EV * 3 (scale) * weight
  if (regime.regime === 'bull') devilScore += 10;
  else if (regime.regime === 'bear') devilScore -= 15;

  if (regime.seasonality.effect === 'positive') devilScore += 5;
  else if (regime.seasonality.effect === 'negative') devilScore -= 5;

  // لو في تأثير سلسلة على السهم
  if (chainReaction) {
    const stockImpact = getStockImpactFromEvent(ticker, chainReaction.event, chainReaction.eventDirection);
    if (stockImpact) {
      devilScore += stockImpact.impactPercent * 2 * 0.15;
    }
  }

  devilScore = Math.round(Math.max(-100, Math.min(100, devilScore)));

  // ============ تحديد مستوى الشيطان ============
  let devilLevel: DevilCard['devilLevel'];
  if (devilScore >= 25) devilLevel = 'opportunity';
  else if (devilScore >= -10) devilLevel = 'wait';
  else if (devilScore >= -40) devilLevel = 'avoid';
  else devilLevel = 'strong_avoid';

  // ============ العناوين ============
  const headline = newsTitle || `تحليل ${ticker}`;
  const crowdThinks = newsSentiment === 'positive' ? '🟢 اشترِ' : newsSentiment === 'negative' ? '🔴 ابعد' : '⚪ محايد';

  let marketDid = '';
  if (currentChange > 0.3) marketDid = `🟢 ${ticker} طلع ${currentChange.toFixed(2)}%`;
  else if (currentChange < -0.3) marketDid = `🔴 ${ticker} نزل ${Math.abs(currentChange).toFixed(2)}%`;
  else marketDid = `⚪ ${ticker} عرضي`;

  const devilSaysMap: Record<DevilCard['devilLevel'], string> = {
    opportunity: '🟢 فرصة — الشيطان بيقول اشترِ',
    wait: '🟡 انتظر — الشيطان مش متأكد',
    avoid: '🔴 ابعد — الشيطان بيقول لا',
    strong_avoid: '🔴🔴 ابعد بقوة — الشيطان بيحذر',
  };

  // ============ اللعبة لكل شخصية ============
  let investorPlay = '';
  let gamblerPlay = '';

  if (preEvent) {
    investorPlay = preEvent.investorPlay;
    gamblerPlay = preEvent.gamblerPlay;
  } else if (devilLevel === 'opportunity') {
    investorPlay = `لو مستثمر: اشترِ ${ticker} على دفعتين. وقف خسارة تحت آخر قاع`;
    gamblerPlay = `لو مغامر: ادخل بمخاطرة محسوبة. هدف +${Math.abs(devilScore / 3).toFixed(0)}%`;
  } else if (devilLevel === 'strong_avoid') {
    investorPlay = `لو مستثمر: ابعد تماماً عن ${ticker}. فيه خطر نزول حاد`;
    gamblerPlay = `لو مغامر: لو عندك ${ticker} — بيع. لو لسه — متدخلش`;
  } else if (devilLevel === 'avoid') {
    investorPlay = `لو مستثمر: انتظر ${ticker} لحد ما السوق يوضح`;
    gamblerPlay = `لو مغامر: فيه فرصة بيع مكشوفة بس مخاطرة عالية`;
  } else {
    investorPlay = `لو مستثمر: راقب ${ticker}. مفيش إشارة قوية للشراء أو البيع`;
    gamblerPlay = `لو مغامر: السوق عرضي — مفيش لعبة واضحة`;
  }

  // إضافة توقع السلسلة لو موجودة
  if (chainBeneficiaries.find(b => b.ticker === ticker)) {
    investorPlay += ` ✅ ${ticker} مستفيد من الحدث`;
  } else if (chainSufferers.find(s => s.ticker === ticker)) {
    investorPlay += ` ⚠️ ${ticker} متضرر من الحدث`;
  }

  return {
    ticker,
    nameAr,
    price,
    generatedAt: now.toISOString(),
    headline,
    crowdThinks,
    marketDid,
    devilSays: devilSaysMap[devilLevel],
    devilLevel,
    divergence,
    chainReaction,
    preEvent,
    contrarian,
    regime,
    chainBeneficiaries,
    chainSufferers,
    investorPlay,
    gamblerPlay,
    goldenRules,
    devilScore,
  };
}
