/**
 * 😈 المحرك 4: محرك العكسية (Contrarian Engine)
 *
 * لما الكل بيقول حاجة، اعكسها لو السعر في مكان خطر.
 *
 * - الكل بيقول "اشتري" + السعر في percentile 90% + سيولة منخفضة = 🔴 بيع
 * - الكل بيقول "ابعد" + السعر في percentile 10% + سيولة عالية = 🟢 اشترِ
 *
 * القاعدة 6: "السهم في percentile 5% = إما كنز إما فخ"
 * القاعدة 3: "السيولة هي الحقيقة"
 */

import type { ContrarianSignal } from './types';

// ==================== تحليل الإشارة العكسية ====================

export function analyzeContrarian(
  crowdSentiment: number,   // -100 (الكل بيع) to +100 (الكل شترى)
  pricePercentile: number,  // 0-100
  volumePattern: 'high' | 'normal' | 'low'
): ContrarianSignal {
  let signal: ContrarianSignal['signal'] = 'neutral';
  let reasoning = '';

  // القاعدة 6: السهم رخيص جداً (percentile 5%)
  const isExtremelyCheap = pricePercentile <= 5;
  const isVeryCheap = pricePercentile <= 10;
  const isVeryExpensive = pricePercentile >= 90;
  const isExtremelyExpensive = pricePercentile >= 95;

  // الكل متفائل + السعر قرب القمة + سيولة منخفضة = بيع
  if (crowdSentiment > 50 && isVeryExpensive && volumePattern === 'low') {
    signal = 'strong_sell';
    reasoning = 'الكل بيقول "اشترِ" + السعر في القمة (percentile 90%+) + سيولة منخفضة = 🔴 مفيش حد جديد يشتري. "خلاص" — ابعد.';
  }
  // الكل متفائل + السعر غالي = بيع
  else if (crowdSentiment > 40 && isVeryExpensive) {
    signal = 'sell';
    reasoning = 'الكل متفائل + السعر قرب القمة = 🔴 مفيش مجال للصعود. العكسية تقول: بيع.';
  }
  // الكل متشائم + السعر قرب القاع + سيولة عالية = اشترِ (تراكم)
  else if (crowdSentiment < -50 && isVeryCheap && volumePattern === 'high') {
    signal = 'strong_buy';
    reasoning = 'الكل بيقول "ابعد" + السعر في القاع (percentile 10%) + سيولة عالية = 🟢 حد كبير بيجمع من العامة. فرصة.';
  }
  // الكل متشائم + السعر رخيص = اشترِ
  else if (crowdSentiment < -40 && isVeryCheap) {
    signal = 'buy';
    reasoning = 'الكل متشائم + السعر رخيص = 🟢 فرصة عكسية. الكل باع، الحق بقي للشارين.';
  }
  // رخيص جداً (percentile 5%)
  else if (isExtremelyCheap) {
    signal = volumePattern === 'high' ? 'buy' : 'neutral';
    reasoning = volumePattern === 'high'
      ? '⚠️ السهم في percentile 5% + سيولة عالية = 🟢 ممكن يكون كنز (حد بيجمع).'
      : '⚠️ السهم في percentile 5% + سيولة منخفضة = 🔴 ممكن يكون فخ (محدش بيشتري لسبب). اسأل: ليه محدش بيشتريه؟';
  }
  // غالي جداً (percentile 95%)
  else if (isExtremelyExpensive) {
    signal = 'sell';
    reasoning = '⚠️ السهم في percentile 95% = 🔴 قرب القمة. العكسية تقول: ابعد.';
  }
  // الحالة الطبيعية
  else {
    signal = 'neutral';
    reasoning = 'لا في تطرف في التفاؤل ولا في السعر. مفيش إشارة عكسية قوية.';
  }

  // تعديل حسب السيولة (القاعدة 3)
  if (volumePattern === 'low' && signal === 'buy') {
    reasoning += ' ⚠️ بس السيولة منخفضة — الإشارة ضعيفة.';
    signal = 'neutral';
  } else if (volumePattern === 'low' && signal === 'strong_buy') {
    reasoning += ' ⚠️ بس السيولة منخفضة — الإشارة أضعف.';
    signal = 'buy';
  }

  // كلام الشيطان
  const crowdAr = crowdSentiment > 30 ? 'الكل متفائل (بيشتري)' : crowdSentiment < -30 ? 'الكل متشائم (بيبيع)' : 'الكل محايد';
  const priceAr = isVeryExpensive ? 'قرب القمة' : isVeryCheap ? 'قرب القاع' : 'في النص';
  const volumeAr = volumePattern === 'high' ? 'عالية' : volumePattern === 'low' ? 'منخفضة' : 'عادية';

  const devilVerdict = `الكل بيقول: ${crowdAr}. السعر: ${priceAr} (percentile ${pricePercentile.toFixed(0)}%). السيولة: ${volumeAr}. `;

  const finalVerdict = devilVerdict + (signal.includes('buy') ? 'الشيطان بيقول: 🟢 اشترِ (العكسية).' :
    signal.includes('sell') ? 'الشيطان بيقول: 🔴 ابعد (العكسية).' :
    'الشيطان بيقول: ⚪ محايد.');

  return {
    crowdSentiment,
    pricePercentile,
    volumePattern,
    signal,
    reasoning,
    devilVerdict: finalVerdict,
  };
}

// ==================== حساب price percentile من تاريخ الأسعار ====================

export function calculatePricePercentile(
  currentPrice: number,
  historicalPrices: number[],
  window: number = 252 // سنة تقريباً
): number {
  const prices = historicalPrices.slice(-window);
  if (prices.length === 0) return 50;

  const below = prices.filter(p => p < currentPrice).length;
  return (below / prices.length) * 100;
}

// ==================== كشف نمط السيولة ====================

export function detectVolumePattern(
  currentVolume: number,
  averageVolume: number
): 'high' | 'normal' | 'low' {
  const ratio = currentVolume / averageVolume;
  if (ratio > 1.5) return 'high';
  if (ratio < 0.7) return 'low';
  return 'normal';
}

// ==================== تقدير crowd sentiment من الأخبار ====================

export function estimateCrowdSentiment(
  newsTitles: { sentiment: 'positive' | 'negative' | 'neutral' }[]
): number {
  if (newsTitles.length === 0) return 0;

  let score = 0;
  for (const news of newsTitles) {
    if (news.sentiment === 'positive') score += 20;
    else if (news.sentiment === 'negative') score -= 20;
  }

  // clamp
  return Math.max(-100, Math.min(100, score));
}
