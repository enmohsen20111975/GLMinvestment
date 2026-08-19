/**
 * 🧠 Expert Filter (Node.js side) — فلتر الخبير للتوقعات
 *
 * الفلسفة:
 * الخبير بيقرأ رد فعل السوق على الخبر، مش الخبر نفسه.
 * قبل ما أي توقع يتنشر، لازم يمر على الخبير.
 *
 * ملاحظة معمارية:
 * - الـ Quality Gate الكامل (5 اختبارات + 8 قواعد ذهبية) موجود في Python
 *   في vps-service/analyzers/expert_quality_gate.py
 * - ده مجرد فلتر بسيط على الـ Node.js side للأسواق اللي مش بتمر على Python
 * - الفلاتر الأساسية:
 *   1. Falling Knife (سهم نزل أكتر من 15% في 5 أيام = ابعد)
 *   2. Duplicate (لو فيه توقع مفتوح، متعملش جديد)
 *   3. ثقة منخفضة (تحت 40 = ارفض)
 */

import Database from 'better-sqlite3';
import path from 'path';

export interface ExpertFilterResult {
  approved: boolean;
  reason: string;
  expertLevel: 'opportunity' | 'wait' | 'avoid' | 'strong_avoid';
  expertScore: number;
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
    dropPercent: Math.round(dropPercent * 100) / 100,
    daysAnalyzed: lookbackDays,
  };
}

// ==================== فلتر التكرار ====================

export function isDuplicatePrediction(ticker: string, days = 7): boolean {
  try {
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    const db = new Database(dbPath, { readonly: true, timeout: 2000 });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Check predictions table
    const row = db.prepare(
      `SELECT 1 FROM predictions WHERE ticker = ? AND prediction_date >= ? AND signal IN ('BUY', 'STRONG_BUY') LIMIT 1`
    ).get(ticker, cutoffStr) as any;

    db.close();
    return !!row;
  } catch {
    return false;
  }
}

// ==================== فلتر الخبير السريع ====================

/**
 * فحص سريع للتوقع قبل النشر — الفحص الكامل في Python
 *
 * المعطيات:
 * - ticker: رمز السهم
 * - signal: التوصية (BUY, SELL, HOLD, etc.)
 * - confidence: الثقة الأصلية (0-100)
 * - entryPrice, targetPrice, stopLoss
 * - historicalPrices: تاريخ الأسعار (آخر 30 يوم)
 *
 * المخرجات:
 * - approved: هل التوقع مقبول؟
 * - confidenceAdjustment: تعديل الثقة (-30 إلى +20)
 * - warnings: تحذيرات
 */
export function quickExpertCheck(params: {
  ticker: string;
  signal: string;
  confidence: number;
  entryPrice: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  historicalPrices?: number[];
}): ExpertFilterResult {
  const { ticker, signal, confidence, entryPrice, targetPrice, stopLoss, historicalPrices = [] } = params;

  const warnings: string[] = [];
  let confidenceAdjustment = 0;
  let expertScore = 0;
  let expertLevel: ExpertFilterResult['expertLevel'] = 'wait';
  let reason = 'فحص سريع — الخبير الكامل في Python';

  const isBuy = ['BUY', 'STRONG_BUY', 'ACCUMULATE'].includes(signal);

  // 1. Falling Knife check
  if (isBuy && historicalPrices.length >= 6) {
    const fk = detectFallingKnife(historicalPrices);
    if (fk.isFallingKnife) {
      return {
        approved: false,
        reason: `🔴 Falling Knife: السهم نزل ${fk.dropPercent}% في ${fk.daysAnalyzed} أيام — ابعد`,
        expertLevel: 'strong_avoid',
        expertScore: -50,
        confidenceAdjustment: -50,
        warnings: [`Falling Knife ${fk.dropPercent}%`],
        investorPlay: `لو مستثمر: ابعد عن ${ticker} — السهم بينهار`,
        gamblerPlay: `لو مغامر: لو عندك ${ticker} — بيع. لو لسه — متدخلش`,
      };
    }
  }

  // 2. Stop loss sanity check
  if (isBuy && stopLoss && entryPrice > 0) {
    const stopPercent = ((stopLoss - entryPrice) / entryPrice) * 100;
    // 🧠 الخبير: وقف أضيق من -3% = مضمون الإصطياد
    if (stopPercent > -3) {
      warnings.push(`وقف ضيق جداً (${stopPercent.toFixed(1)}%) — هيتصطاد`);
      confidenceAdjustment -= 15;
      expertScore -= 20;
    }
    // وقف واسع جداً (أكتر من -20%) = مخاطرة عالية
    if (stopPercent < -20) {
      warnings.push(`وقف واسع جداً (${stopPercent.toFixed(1)}%) — مخاطرة عالية`);
      confidenceAdjustment -= 10;
    }
  }

  // 3. Target sanity check
  if (isBuy && targetPrice && entryPrice > 0) {
    const targetPercent = ((targetPrice - entryPrice) / entryPrice) * 100;
    // 🧠 الخبير: هدف أقل من +3% = مفيش ربح
    if (targetPercent < 3) {
      warnings.push(`هدف صغير (${targetPercent.toFixed(1)}%) — مفيش ربح`);
      confidenceAdjustment -= 10;
    }
    // R/R check
    if (stopLoss && targetPrice) {
      const stopPercent = Math.abs((stopLoss - entryPrice) / entryPrice) * 100;
      const rr = targetPercent / stopPercent;
      if (rr < 0.5) {
        warnings.push(`R/R ضعيف (${rr.toFixed(2)}) — المخاطرة أكبر من الربح`);
        confidenceAdjustment -= 15;
      }
    }
  }

  // 4. Duplicate check
  if (isBuy && isDuplicatePrediction(ticker)) {
    warnings.push(`فيه توقع BUY مفتوح على ${ticker} في آخر 7 أيام`);
    confidenceAdjustment -= 10;
  }

  // 5. Low confidence rejection
  const adjustedConfidence = confidence + confidenceAdjustment;
  if (adjustedConfidence < 40) {
    return {
      approved: false,
      reason: `🚫 الثقة بعد تعديل الخبير منخفضة (${adjustedConfidence.toFixed(0)})`,
      expertLevel: 'avoid',
      expertScore: -30,
      confidenceAdjustment,
      warnings,
    };
  }

  // Determine level
  if (expertScore >= 10 && confidenceAdjustment >= 0) {
    expertLevel = 'opportunity';
    reason = 'الخبير موافق — فرصة كويسة';
  } else if (expertScore >= -10) {
    expertLevel = 'wait';
    reason = 'الخبير محايد — ادخل بحذر';
  } else if (expertScore >= -30) {
    expertLevel = 'avoid';
    reason = 'الخبيق بيقول انتظر';
  } else {
    expertLevel = 'strong_avoid';
    reason = 'الخبير بيقول ابعد';
  }

  return {
    approved: true,
    reason,
    expertLevel,
    expertScore,
    confidenceAdjustment,
    warnings,
    investorPlay: expertLevel === 'opportunity'
      ? `لو مستثمر: اشترِ ${ticker} على دفعتين`
      : `لو مستثمر: انتظر ${ticker}`,
    gamblerPlay: expertLevel === 'opportunity'
      ? `لو مغامر: ادخل ${ticker} بمخاطرة محسوبة`
      : `لو مغامر: متدخلش ${ticker} دلوقتي`,
  };
}

// ==================== Run Expert Filter (alias) ====================

export async function runExpertFilter(params: {
  ticker: string;
  signal: string;
  confidence: number;
  entryPrice: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  historicalPrices?: number[];
}): Promise<ExpertFilterResult> {
  // Sync check wrapped in async for API compatibility
  return quickExpertCheck(params);
}
