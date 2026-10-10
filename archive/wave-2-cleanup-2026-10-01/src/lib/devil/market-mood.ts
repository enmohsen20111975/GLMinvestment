/**
 * 😈 مقياس السوق (Market Mood)
 *
 * حرارة السوق النهاردة: 🟡 دافئة (مش ساخنة ولا باردة)
 *
 * المدخلات:
 * - EGX30 change
 * - عدد الصاعدين vs الهابطين
 * - مستوى السيولة
 *
 * المخرج: القرار النهائي للسوق كله
 */

import type { MarketMood } from './types';
import type { MarketRegime } from './types';
import { detectMarketRegime, getSeasonality, REGIME_AR } from './regime-engine';

// ==================== حساب حرارة السوق ====================

export function calculateMarketMood(
  egx30Change: number = 0,
  egx30Change5d: number = 0,
  egx30Change30d: number = 0,
  gainers: number = 0,
  losers: number = 0,
  totalVolume: number = 0,
  averageVolume: number = 0
): MarketMood {
  // ============ الحرارة ============
  let temperature: MarketMood['temperature'] = 'warm';
  let temperatureAr = 'دافئة';
  let temperatureEmoji = '🟡';

  const absChange = Math.abs(egx30Change);
  if (egx30Change > 1.5) {
    temperature = 'hot';
    temperatureAr = 'ساخنة';
    temperatureEmoji = '🔥';
  } else if (egx30Change > 0.3) {
    temperature = 'warm';
    temperatureAr = 'دافئة';
    temperatureEmoji = '🟡';
  } else if (egx30Change > -0.3) {
    temperature = 'cool';
    temperatureAr = 'باردة';
    temperatureEmoji = '🔵';
  } else {
    temperature = 'cold';
    temperatureAr = 'باردة جداً';
    temperatureEmoji = '❄️';
  }

  // ============ السيولة ============
  const volumeRatio = averageVolume > 0 ? totalVolume / averageVolume : 1;
  let liquidity: MarketMood['liquidity'] = 'normal';
  let liquidityAr = 'عادية';
  if (volumeRatio > 1.3) {
    liquidity = 'high';
    liquidityAr = 'عالية';
  } else if (volumeRatio < 0.7) {
    liquidity = 'low';
    liquidityAr = 'منخفضة';
  }

  // ============ وضع السوق ============
  const regime = detectMarketRegime(egx30Change30d, egx30Change5d);
  const seasonality = getSeasonality();

  // ============ القرار النهائي ============
  let verdict = '';
  let verdictLevel: MarketMood['verdictLevel'] = 'neutral';
  let devilScore = 0;

  // الحساب: موجب = فرصة، سالب = ابعد
  const breadth = gainers - losers; // موجب = صاعدين أكتر
  const breadthScore = Math.max(-30, Math.min(30, breadth * 0.5));
  const momentumScore = egx30Change * 5; // 1% = 5 نقاط
  const liquidityScore = (volumeRatio - 1) * 20; // 1.5x = +10
  const seasonalityScore = seasonality.effect === 'positive' ? 10 : seasonality.effect === 'negative' ? -10 : 0;

  devilScore = Math.round(breadthScore + momentumScore + liquidityScore + seasonalityScore);
  devilScore = Math.max(-100, Math.min(100, devilScore));

  if (temperature === 'hot' && liquidity === 'high' && breadth > 20) {
    verdict = '🔥 السوق ساخن والسيولة عالية والصاعدين كتير — فرص قوية. بس احذر "الفقاعة"';
    verdictLevel = devilScore > 30 ? 'opportunity' : 'neutral';
  } else if (temperature === 'cold' && liquidity === 'low') {
    verdict = '❄️ السوق بارد والسيولة منخفضة — مفيش فرص. لو عندك فلوس، قعد على جنب';
    verdictLevel = 'stay_away';
  } else if (regime === 'bear') {
    verdict = '🐻 السوق هابط — الارتدادات مؤقتة. قلل المخاطرة. ابعد عن الأسهم الضعيفة';
    verdictLevel = 'caution';
  } else if (seasonality.effect === 'caution') {
    verdict = `⚠️ ${seasonality.factorName} — ${seasonality.description}. الحركات مش حقيقية`;
    verdictLevel = 'caution';
  } else if (breadth < -20) {
    verdict = '🔴 الهابطين أكتر من الصاعدين — السوق ضعيف. انتظر';
    verdictLevel = 'caution';
  } else {
    verdict = `🟡 السوق ${temperatureAr} — ${REGIME_AR[regime]}. مفيش فرص قوية. لو عندك فلوس، قعد على جنب`;
    verdictLevel = 'neutral';
  }

  return {
    temperature,
    temperatureAr,
    temperatureEmoji,
    egx30Change,
    gainers,
    losers,
    liquidity,
    liquidityAr,
    regime,
    regimeAr: REGIME_AR[regime],
    verdict,
    verdictLevel,
    devilScore,
  };
}

// ==================== نسخة مبسطة بدون بيانات كاملة ====================

export function quickMarketMood(
  egx30Change: number = 0,
  gainers: number = 0,
  losers: number = 0
): MarketMood {
  return calculateMarketMood(
    egx30Change,
    egx30Change,
    egx30Change,
    gainers,
    losers,
    100,
    100
  );
}
