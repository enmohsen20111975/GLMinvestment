/**
 * 😈 Devil Filter — فلتر الشيطان للتوقعات
 *
 * الفلسفة:
 * الشيطان بيقرأ رد فعل السوق على الخبر، مش الخبر نفسه.
 * قبل ما أي توقع يتنشر، لازم يمر على الشيطان.
 *
 * القواعد:
 * 1. لو الشيطان بيقول "strong_avoid" → ارفض التوقع
 * 2. لو الشيطان بيقول "avoid" → قلل الثقة + حذّر
 * 3. لو الشيطان بيقول "wait" → قلل الثقة
 * 4. لو الشيطان بيقول "opportunity" → زوّد الثقة
 *
 * + فلتر falling knives (سهم نزل أكتر من 15% في 5 أيام = ابعد)
 * + فلتر التكرار (لو فيه توقع مفتوح على السهم، متعملش جديد)
 */

import { buildDevilCard } from './devil-orchestrator';
import { calculatePricePercentile } from './contrarian-engine';
import { getHistoricalData, getStockBySymbol } from '@/lib/data-engine-db';

export interface DevilFilterResult {
  approved: boolean;
  reason: string;
  devilLevel: 'opportunity' | 'wait' | 'avoid' | 'strong_avoid';
  devilScore: number;
  confidenceAdjustment: number; // -30 to +20
  warnings: string[];
  investorPlay?: string;
  gamblerPlay?: string;
}

// ==================== فلتر Falling Knife ====================

export function detectFallingKnife(
  historicalPrices: number[],
  lookbackDays: number = 5,
  threshold: number = -15
): { isFallingKnife: boolean; dropPercent: number; daysAnalyzed: number } {
  if (historicalPrices.length < lookbackDays + 1) {
    return { isFallingKnife: false, dropPercent: 0, daysAnalyzed: 0 };
  }

  const recent = historicalPrices.slice(-lookbackDays - 1);
  const startPrice = recent[0];
  const endPrice = recent[recent.length - 1];

  if (startPrice <= 0) {
    return { isFallingKnife: false, dropPercent: 0, daysAnalyzed: lookbackDays };
  }

  const dropPercent = ((endPrice - startPrice) / startPrice) * 100;

  return {
    isFallingKnife: dropPercent < threshold,
    dropPercent: parseFloat(dropPercent.toFixed(2)),
    daysAnalyzed: lookbackDays,
  };
}

// ==================== فلتر التكرار ====================

export interface ExistingPrediction {
  ticker: string;
  signal: string;
  prediction_date: string;
  is_closed: boolean;
}

export function isDuplicatePrediction(
  ticker: string,
  signal: string,
  existing: ExistingPrediction[],
  hoursThreshold: number = 12
): { isDuplicate: boolean; reason: string } {
  const now = new Date();
  const threshold = hoursThreshold * 60 * 60 * 1000;

  for (const p of existing) {
    if (p.ticker !== ticker) continue;
    if (p.is_closed) continue;

    const predDate = new Date(p.prediction_date);
    const ageMs = now.getTime() - predDate.getTime();

    if (ageMs < threshold) {
      // نفس الاتجاه في خلال 12 ساعة = تكرار
      const sameDirection =
        (signal.includes('BUY') && p.signal.includes('BUY')) ||
        (signal.includes('SELL') && p.signal.includes('SELL')) ||
        (signal.includes('HOLD') && p.signal.includes('HOLD'));

      if (sameDirection) {
        return {
          isDuplicate: true,
          reason: `فيه توقع ${p.signal} مفتوح على ${ticker} من ${hoursThreshold} ساعة (${predDate.toLocaleString('ar-EG')})`,
        };
      }
    }
  }

  return { isDuplicate: false, reason: '' };
}

// ==================== الفلتر الرئيسي ====================

export interface DevilFilterInput {
  ticker: string;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  existingPredictions?: ExistingPrediction[];
}

export async function runDevilFilter(input: DevilFilterInput): Promise<DevilFilterResult> {
  const { ticker, signal, confidence, existingPredictions = [] } = input;

  const warnings: string[] = [];
  let confidenceAdjustment = 0;

  // ============ 1. فلتر التكرار ============
  const dupCheck = isDuplicatePrediction(ticker, signal, existingPredictions);
  if (dupCheck.isDuplicate) {
    return {
      approved: false,
      reason: `🚫 مرفوض — تكرار: ${dupCheck.reason}`,
      devilLevel: 'wait',
      devilScore: 0,
      confidenceAdjustment: 0,
      warnings: [dupCheck.reason],
    };
  }

  // ============ 2. جلب بيانات السهم والتاريخ ============
  const stock = getStockBySymbol(ticker);
  const history = getHistoricalData(ticker, 60);
  const historicalPrices = history.map(h => Number(h.close || 0)).filter(p => p > 0);

  const currentChange = stock ? Number((stock as any).change_percent || 0) : 0;
  const currentVolume = stock ? Number((stock as any).volume || 0) : 0;
  const recentVolumes = history.slice(-20).map(h => Number(h.volume || 0));
  const avgVolume = recentVolumes.length > 0
    ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length
    : currentVolume || 1;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // ============ 3. فلتر Falling Knife ============
  const fallingKnife = detectFallingKnife(historicalPrices);
  if (fallingKnife.isFallingKnife) {
    warnings.push(`🔴 Falling Knife: السهم نزل ${fallingKnife.dropPercent}% في آخر ${fallingKnife.daysAnalyzed} أيام`);

    // لو التوقع شراء على falling knife = ارفض
    if (signal.includes('BUY')) {
      return {
        approved: false,
        reason: `🚫 مرفوض — falling knife: السهم نزل ${fallingKnife.dropPercent}% في ${fallingKnife.daysAnalyzed} أيام. شراء = قمار.`,
        devilLevel: 'strong_avoid',
        devilScore: -80,
        confidenceAdjustment: -50,
        warnings,
      };
    }
    // لو توقع بيع = صح، زوّد الثقة
    if (signal.includes('SELL')) {
      confidenceAdjustment += 10;
      warnings.push(`🟢 توقع بيع على سهم نازل — منطقي`);
    }
  }

  // ============ 4. كارت الشيطان الكامل ============
  const card = await buildDevilCard({
    ticker,
    nameAr: stock ? (stock as any).name_ar : undefined,
    price: input.entryPrice,
    currentChange,
    volumeRatio,
    historicalPrices,
    currentVolume,
    averageVolume: avgVolume,
  });

  // ============ 5. تعديل الثقة حسب قرار الشيطان ============
  switch (card.devilLevel) {
    case 'opportunity':
      confidenceAdjustment += 15;
      warnings.push(`🟢 الشيطان موافق: ${card.devilSays}`);
      break;
    case 'wait':
      confidenceAdjustment -= 10;
      warnings.push(`🟡 الشيطان حذر: ${card.devilSays}`);
      break;
    case 'avoid':
      confidenceAdjustment -= 25;
      warnings.push(`🔴 الشيطان غير موافق: ${card.devilSays}`);
      break;
    case 'strong_avoid':
      // لو التوقع شراء والشيطان بيقول strong_avoid = ارفض
      if (signal.includes('BUY')) {
        return {
          approved: false,
          reason: `🚫 مرفوض — الشيطان بيقول "ابعد بقوة": ${card.devilSays}`,
          devilLevel: card.devilLevel,
          devilScore: card.devilScore,
          confidenceAdjustment: -40,
          warnings: [...warnings, ...card.goldenRules],
          investorPlay: card.investorPlay,
          gamblerPlay: card.gamblerPlay,
        };
      }
      confidenceAdjustment -= 35;
      warnings.push(`🔴🔴 الشيطان بيحذر بقوة: ${card.devilSays}`);
      break;
  }

  // ============ 6. القواعد الذهبية الحاسمة ============
  for (const rule of card.goldenRules) {
    // لو فيه قاعدة "السوق صح — أنا غلط" والتوقع شراء = ارفض
    if (rule.includes('السوق صح') && signal.includes('BUY')) {
      return {
        approved: false,
        reason: `🚫 مرفوض — القاعدة الذهبية: ${rule}`,
        devilLevel: 'strong_avoid',
        devilScore: card.devilScore,
        confidenceAdjustment: -40,
        warnings: [...warnings, rule],
        investorPlay: card.investorPlay,
        gamblerPlay: card.gamblerPlay,
      };
    }
    // لو فيه قاعدة "رمضان" = قلل الثقة
    if (rule.includes('رمضان')) {
      confidenceAdjustment -= 15;
      warnings.push(rule);
    }
    // لو فيه قاعدة "percentile 5%" = حذّر
    if (rule.includes('percentile 5%')) {
      confidenceAdjustment -= 10;
      warnings.push(rule);
    }
  }

  // ============ 7. القرار النهائي ============
  const adjustedConfidence = confidence + confidenceAdjustment;
  const approved = adjustedConfidence >= 40; // الحد الأدنى للنشر

  const reason = approved
    ? `✅ موافق — الشيطان: ${card.devilSays} (الثقة بعد التعديل: ${adjustedConfidence.toFixed(0)})`
    : `🚫 مرفوض — الثقة بعد تعديل الشيطان منخفضة جداً (${adjustedConfidence.toFixed(0)})`;

  return {
    approved,
    reason,
    devilLevel: card.devilLevel,
    devilScore: card.devilScore,
    confidenceAdjustment,
    warnings,
    investorPlay: card.investorPlay,
    gamblerPlay: card.gamblerPlay,
  };
}

// ==================== نسخة مبسطة (للاستخدام السريع) ====================

export function quickDevilCheck(
  ticker: string,
  signal: 'BUY' | 'SELL' | 'HOLD',
  recentPrices: number[]
): { approved: boolean; reason: string } {
  // فلتر falling knife فقط
  const fk = detectFallingKnife(recentPrices);
  if (fk.isFallingKnife && signal === 'BUY') {
    return {
      approved: false,
      reason: `🚫 Falling Knife: نزل ${fk.dropPercent}% في ${fk.daysAnalyzed} أيام`,
    };
  }
  return { approved: true, reason: '✅ عدى الفلتر السريع' };
}
