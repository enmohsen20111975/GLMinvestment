/**
 * Persona-Scaled Dynamic Analytics Engine — Math Library
 * =======================================================
 * P39: متغير الشخصية الاستثمارية الديناميكي (Persona Scaling Vector — $\vec{P}$)
 *
 * ينفّذ المعادلات الثلاث الأساسية من الخطة:
 *  (أ) Adaptive Engine Weight Rescaling
 *  (ب) Persona-Scaled ATR Targets (Stop Loss + Target Profit)
 *  (ج) Dynamic Position Sizing
 *
 * جميع المعادلات تحافظ على روح الديناميكية (Regime + Volatility) ولا تُلغي
 * أوزان السوق الأصلية، بل تطبق مُعامل التكيف الشخصي فوقها.
 *
 * الإعدادات الافتراضية مأخوذة حرفياً من خطة المستخدم:
 *  🛡️ Conservative: StopFactor=0.8, TargetFactor=1.2, MaxRisk%=1.0
 *  ⚖️  Balanced:     StopFactor=1.0, TargetFactor=1.0, MaxRisk%=2.0
 *  🔥 Aggressive:   StopFactor=1.5, TargetFactor=1.8, MaxRisk%=4.5
 *
 * كما نوفّر مُعاملات الشخصية لأوزان المحركات الفرعية (Sub-Engine Weight Factors):
 *  - المحافظ: يرفع Quant + Risk، يخفض SMC Breakouts.
 *  - المغامر: يرفع SMC + Momentum، يخفض Penalties.
 *  - المتوازن: معاملات متكافئة 1.0.
 */

import type { PersonaType } from '@/types/v2';
import type { MarketRegime } from '@/types/v2';

// ==================== TYPES ====================

export interface PersonaFactors {
  stopFactor: number;       // المُعامل المضروب في ATR لوقف الخسارة
  targetFactor: number;     // المُعامل المضروب في ATR للهدف
  maxRiskPercent: number;   // أقصى نسبة مخاطفة من المحفظة
  // مُعاملات تعديل أوزان المحركات الفرعية الـ 4 (Maestro: SMC, Quant, Risk, EGX Tuned)
  engineWeightFactors: {
    smc: number;
    quant: number;
    risk: number;
    egx: number;
  };
  // سقوف الأصول بالمحفظة (Wealth Allocation Matrix) كنسب مئوية
  assetCeilings: {
    egx: number;    // max % in EGX stocks
    crypto: number; // max % in crypto
    gold: number;   // max % in gold
    cash: number;   // min % cash reserve
  };
  // سلوك إنقاذ التعليقة (Dynamic Rescue & Debt Engine)
  rescueBehavior: {
    cutLossThresholdPct: number;   // لو الخسارة تجاوزت ده → CUT_LOSS فوراً
    averageDownMaxPct: number;     // أقصى متوسط مسموح به من رأس المال
    holdPatienceDays: number;      // عدد أيام الصبر قبل توصية بيع
  };
  // سداد الديون (Dynamic Debt Engine)
  debtBehavior: {
    emergencyPaydownRatio: number; // نسبة من الأرباح تُوجَّه لسداد الديون
    prioritizeHighInterest: boolean;
  };
}

export type PersonaVectorKey = 'conservative' | 'balanced' | 'aggressive';

export interface SubEngineWeights {
  smc: number;   // 0..100
  quant: number;
  risk: number;
  egx: number;
}

export interface PersonaTargets {
  stopLoss: number;
  targetProfit: number;
  riskRewardRatio: number;
}

export interface PositionSizingResult {
  maxPositionShares: number;
  maxPositionValueEGP: number;
  riskPerShare: number;
  riskAmountEGP: number;
  portfolioPercentUsed: number;
}

export interface WealthAllocationAlert {
  asset: 'egx' | 'crypto' | 'gold' | 'cash';
  currentPercent: number;
  ceilingPercent: number;
  overflow: number;     // current - ceiling (negative = under)
  severity: 'ok' | 'warning' | 'critical';
  messageAr: string;
}

// ==================== PERSONA VECTORS (Math Constants) ====================

/**
 * متجهات الشخصية الديناميكية الثلاث — تستند لخطة المستخدم حرفياً.
 * مُعاملات الـ engineWeightFactors مُشتقّة من وصف الخطة:
 *   - المحافظ: Quant×1.4, Risk×1.3, SMC×0.6, EGX×0.9
 *   - المغامر:  SMC×1.5, Quant×0.8, Risk×0.6, EGX×1.1
 *   - المتوازن: الكل = 1.0
 */
export const PERSONA_VECTORS: Record<PersonaVectorKey, PersonaFactors> = {
  conservative: {
    stopFactor: 0.8,
    targetFactor: 1.2,
    maxRiskPercent: 1.0,
    engineWeightFactors: {
      smc: 0.6,   // يخفض الـ SMC Breakouts
      quant: 1.4, // يرفع الـ Quant
      risk: 1.3,  // يرفع الـ Dynamic Risk
      egx: 0.9,
    },
    assetCeilings: {
      egx: 65,
      crypto: 0,     // crypto hidden
      gold: 25,
      cash: 10,      // minimum cash reserve
    },
    rescueBehavior: {
      cutLossThresholdPct: 8,    // وقف ضيق: أي خسارة >8% → قطع فوري
      averageDownMaxPct: 5,
      holdPatienceDays: 30,
    },
    debtBehavior: {
      emergencyPaydownRatio: 0.5, // 50% من الأرباح لسداد الديون
      prioritizeHighInterest: true,
    },
  },
  balanced: {
    stopFactor: 1.0,
    targetFactor: 1.0,
    maxRiskPercent: 2.0,
    engineWeightFactors: {
      smc: 1.0,
      quant: 1.0,
      risk: 1.0,
      egx: 1.0,
    },
    assetCeilings: {
      egx: 55,
      crypto: 15,
      gold: 20,
      cash: 10,
    },
    rescueBehavior: {
      cutLossThresholdPct: 15,
      averageDownMaxPct: 10,
      holdPatienceDays: 60,
    },
    debtBehavior: {
      emergencyPaydownRatio: 0.3,
      prioritizeHighInterest: true,
    },
  },
  aggressive: {
    stopFactor: 1.5,
    targetFactor: 1.8,
    maxRiskPercent: 4.5,
    engineWeightFactors: {
      smc: 1.5,    // يرفع الـ SMC Breakouts
      quant: 0.8,
      risk: 0.6,   // يخفض الـ Risk penalties
      egx: 1.1,
    },
    assetCeilings: {
      egx: 30,
      crypto: 60,
      gold: 5,
      cash: 5,
    },
    rescueBehavior: {
      cutLossThresholdPct: 25,   // يتحمّل خسارة أعمق
      averageDownMaxPct: 20,
      holdPatienceDays: 90,
    },
    debtBehavior: {
      emergencyPaydownRatio: 0.1, // أولوية أقل للديون
      prioritizeHighInterest: false,
    },
  },
};

/**
 * خرائط الـ PersonaType (النوع الموجود بالـ v2) إلى PersonaVectorKey.
 * لاحظ أنّ 'gambler' في الـ v2 يُقابل 'aggressive' في الـ persona vector.
 */
export function personaTypeToVectorKey(p: PersonaType | string): PersonaVectorKey {
  if (p === 'conservative') return 'conservative';
  if (p === 'gambler' || p === 'aggressive') return 'aggressive';
  return 'balanced';
}

export function getPersonaVector(persona: PersonaType | string): PersonaFactors {
  const key = personaTypeToVectorKey(persona);
  return PERSONA_VECTORS[key];
}

// ==================== (أ) ADAPTIVE ENGINE WEIGHT RESCALING ====================

/**
 * Final Engine Weight_i = (DynamicRegimeWeight_i × PersonaFactor_i)
 *                       / Σ_k (DynamicRegimeWeight_k × PersonaFactor_k)
 *
 * الناتج دائماً مجموعه = 100 (نسب مئوية) مع الحفاظ على النسب النسبية
 * بين المحركات كما لوّحظ في حالة السوق (Bull/Bear/Sideways).
 *
 * @param regimeWeights  الأوزان الديناميكية الحالية لكل محرك (0..100، لا يُشترط مجموع=100)
 * @param persona        الشخصية النشطة
 * @returns              أوزان نهائية normalized بحيث مجموعها = 100
 */
export function rescaleEngineWeights(
  regimeWeights: SubEngineWeights,
  persona: PersonaType | string,
): SubEngineWeights {
  const factors = getPersonaVector(persona).engineWeightFactors;
  const wSMC = regimeWeights.smc * factors.smc;
  const wQuant = regimeWeights.quant * factors.quant;
  const wRisk = regimeWeights.risk * factors.risk;
  const wEGX = regimeWeights.egx * factors.egx;
  const total = wSMC + wQuant + wRisk + wEGX;
  if (total <= 0) {
    // fallback: equal weights
    return { smc: 25, quant: 25, risk: 25, egx: 25 };
  }
  return {
    smc: Math.round((wSMC / total) * 1000) / 10,
    quant: Math.round((wQuant / total) * 1000) / 10,
    risk: Math.round((wRisk / total) * 1000) / 10,
    egx: Math.round((wEGX / total) * 1000) / 10,
  };
}

// ==================== (ب) PERSONA-SCALED ATR TARGETS ====================

/**
 * Dynamic Stop Loss = Entry - (ATR × RegimeVolatilityMultiplier × PersonaStopFactor)
 * Dynamic Target Profit = Entry + (ATR × StructureExtensionMultiplier × PersonaTargetFactor)
 *
 * @param entry                 سعر الدخول
 * @param atr                   قيمة ATR الحالية
 * @param regimeVolMult         مُضاعف تقلب السوق (Bull=1.0, Bear=1.3, Sideways=0.8 مثلاً)
 * @param structureExtMult      مُضاعف امتداد البنية (افتراضي 2.0)
 * @param persona               الشخصية النشطة
 */
export function computePersonaScaledTargets(
  entry: number,
  atr: number,
  regimeVolMult: number,
  structureExtMult: number,
  persona: PersonaType | string,
): PersonaTargets {
  const v = getPersonaVector(persona);
  const stopDistance = atr * regimeVolMult * v.stopFactor;
  const targetDistance = atr * structureExtMult * v.targetFactor;
  const stopLoss = entry - stopDistance;
  const targetProfit = entry + targetDistance;
  const riskRewardRatio = stopDistance > 0 ? targetDistance / stopDistance : 0;
  return {
    stopLoss,
    targetProfit,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
  };
}

/**
 * Helper: يحسب مُضاعف تقلب السوق (Regime Volatility Multiplier)
 * بناءً على حالة السوق + مستوى ATR/Z-Score.
 *
 * Bull  → 1.0 (تقلب طبيعي)
 * Bear  → 1.3 (وقف أوسع لأنّ التقلب أعلى)
 * Sideways → 0.8 (وقف أضيق لأنّ التقلب منخفض)
 */
export function regimeVolatilityMultiplier(regime: MarketRegime | string): number {
  if (regime === 'bull') return 1.0;
  if (regime === 'bear') return 1.3;
  return 0.8; // neutral / sideways
}

// ==================== (ج) DYNAMIC POSITION SIZING ====================

/**
 * Max Position Size = (PortfolioNetWorth × AssetRegimeWeight% × PersonaMaxRisk%)
 *                   / (Entry - DynamicStopLoss)
 *
 * @param portfolioNetWorthEGP   صافي قيمة المحفظة بالجنيه
 * @param assetRegimeWeight      وزن الأصل المسموح به من المحفظة (0..1)
 * @param entry                  سعر الدخول
 * @param dynamicStopLoss        وقف الخسارة الديناميكي (من computePersonaScaledTargets)
 * @param persona                الشخصية النشطة
 */
export function computeDynamicPositionSize(
  portfolioNetWorthEGP: number,
  assetRegimeWeight: number,
  entry: number,
  dynamicStopLoss: number,
  persona: PersonaType | string,
): PositionSizingResult {
  const v = getPersonaVector(persona);
  const riskPerShare = Math.max(0, entry - dynamicStopLoss);
  if (riskPerShare <= 0 || portfolioNetWorthEGP <= 0) {
    return {
      maxPositionShares: 0,
      maxPositionValueEGP: 0,
      riskPerShare,
      riskAmountEGP: 0,
      portfolioPercentUsed: 0,
    };
  }
  const maxRiskAmount = portfolioNetWorthEGP * (v.maxRiskPercent / 100) * Math.max(0, Math.min(1, assetRegimeWeight));
  const maxShares = Math.floor(maxRiskAmount / riskPerShare);
  const maxPositionValue = maxShares * entry;
  return {
    maxPositionShares: maxShares,
    maxPositionValueEGP: Math.round(maxPositionValue * 100) / 100,
    riskPerShare: Math.round(riskPerShare * 1000) / 1000,
    riskAmountEGP: Math.round(maxRiskAmount * 100) / 100,
    portfolioPercentUsed: Math.round((maxPositionValue / portfolioNetWorthEGP) * 10000) / 100,
  };
}

// ==================== WEALTH ALLOCATION MATRIX ====================

/**
 * يحسب التنبيهات لسقوف الأصول بالمحفظة بناءً على متغير الشخصية.
 *
 * @param currentValuesEGP   { egx, crypto, gold, cash } بالجنيه
 * @param portfolioNetWorth  إجمالي قيمة المحفظة بالجنيه
 * @param persona            الشخصية النشطة
 */
export function checkWealthAllocationMatrix(
  currentValuesEGP: { egx: number; crypto: number; gold: number; cash: number },
  portfolioNetWorth: number,
  persona: PersonaType | string,
): WealthAllocationAlert[] {
  const v = getPersonaVector(persona).assetCeilings;
  if (portfolioNetWorth <= 0) return [];
  const currentPct = {
    egx: (currentValuesEGP.egx / portfolioNetWorth) * 100,
    crypto: (currentValuesEGP.crypto / portfolioNetWorth) * 100,
    gold: (currentValuesEGP.gold / portfolioNetWorth) * 100,
    cash: (currentValuesEGP.cash / portfolioNetWorth) * 100,
  };
  const out: WealthAllocationAlert[] = [];
  const labels: Record<keyof typeof currentPct, string> = {
    egx: 'الأسهم المصرية',
    crypto: 'العملات الرقمية',
    gold: 'الذهب',
    cash: 'السيولة',
  };
  (Object.keys(currentPct) as Array<keyof typeof currentPct>).forEach((k) => {
    const ceiling = v[k];
    const cur = currentPct[k];
    const overflow = Math.round((cur - ceiling) * 100) / 100;
    let severity: WealthAllocationAlert['severity'] = 'ok';
    let messageAr = `ضمن الحد المسموح (${cur.toFixed(1)}% / ${ceiling}%)`;
    if (k === 'cash') {
      // cash is a minimum floor, not a ceiling
      if (cur < ceiling) {
        severity = cur < ceiling * 0.5 ? 'critical' : 'warning';
        messageAr = `🚨 السيولة منخفضة: ${cur.toFixed(1)}% (الحد الأدنى ${ceiling}%) — أوقف الشراء حتى تعويض السيولة`;
      }
    } else if (overflow > 0) {
      severity = overflow > ceiling * 0.2 ? 'critical' : 'warning';
      messageAr = `🚨 تجاوز سقف ${labels[k]}: ${cur.toFixed(1)}% (الحد ${ceiling}%) — وجوب إعادة توازن فورية`;
    } else if (overflow > -ceiling * 0.1) {
      // قريب من السقف (within 10%)
      messageAr = `⚠️ قرب الوصول لسقف ${labels[k]}: ${cur.toFixed(1)}% / ${ceiling}%`;
    }
    out.push({
      asset: k,
      currentPercent: Math.round(cur * 100) / 100,
      ceilingPercent: ceiling,
      overflow,
      severity,
      messageAr,
    });
  });
  return out;
}

// ==================== DYNAMIC RESCUE & DEBT ENGINE ====================

/**
 * يحسب التوصية المكيّفة للشخصية لإنقاذ السهم المزنوق.
 *
 * @param lossPct        نسبة الخسارة الحالية (سالب إذا ربح)
 * @param holdingDays    عدد أيام الاحتفاظ
 * @param persona        الشخصية النشطة
 * @returns              توصية + ملاحظة بالعربية
 */
export function computePersonaRescueAdvice(
  lossPct: number,
  holdingDays: number,
  persona: PersonaType | string,
): { recommendation: 'HOLD' | 'AVERAGE_DOWN' | 'CUT_LOSS'; noteAr: string } {
  const v = getPersonaVector(persona).rescueBehavior;
  // CUT_LOSS فوري لو الخسارة تجاوزت الحد الشخصي
  if (lossPct <= -v.cutLossThresholdPct) {
    return {
      recommendation: 'CUT_LOSS',
      noteAr: `🛑 الخسارة ${Math.abs(lossPct).toFixed(1)}% تجاوزت حدّك الشخصي (${v.cutLossThresholdPct}%) — القطع فوراً يحمي باقي رأس المال.`,
    };
  }
  // AVERAGE_DOWN لو الخسارة متوسطة + ضمن حد المتوسط المسموح + ما تجاوزش صبر الأيام
  if (lossPct <= -v.cutLossThresholdPct * 0.5 && holdingDays < v.holdPatienceDays) {
    return {
      recommendation: 'AVERAGE_DOWN',
      noteAr: `📉 الخسارة ${Math.abs(lossPct).toFixed(1)}% ضمن نطاق المتوسط المسموح (حتى ${v.averageDownMaxPct}% من رأس المال) — متوسط السهم عند الدعم لتقليل متوسط التكلفة.`,
    };
  }
  // HOLD لو لسه في الصبر
  if (holdingDays < v.holdPatienceDays) {
    return {
      recommendation: 'HOLD',
      noteAr: `⏳ الخسارة ${Math.abs(lossPct).toFixed(1)}% ضمن حدود الصبر (${v.holdPatienceDays} يوم) — التزم بالوقف الديناميكي ولا تتسرّع.`,
    };
  }
  // تجاوز صبر الأيام
  return {
    recommendation: 'CUT_LOSS',
    noteAr: `⏰ تجاوزت فترة الصبر (${v.holdPatienceDays} يوم) والخسارة ${Math.abs(lossPct).toFixed(1)}% — أغلق المركز وأعد توجيه رأس المال لفرصة أفضل.`,
  };
}

/**
 * يحسب نسبة من الأرباح ينبغي توجيهها لسداد الديون حسب الشخصية.
 */
export function computeDebtPaydownRatio(
  profitEGP: number,
  persona: PersonaType | string,
): { ratio: number; amountEGP: number; noteAr: string } {
  const v = getPersonaVector(persona).debtBehavior;
  const amount = Math.max(0, profitEGP * v.emergencyPaydownRatio);
  return {
    ratio: v.emergencyPaydownRatio,
    amountEGP: Math.round(amount * 100) / 100,
    noteAr: v.emergencyPaydownRatio >= 0.3
      ? `💰 وجّه ${v.emergencyPaydownRatio * 100}% من أرباحك (${Math.round(amount).toLocaleString('ar-EG')} ج.م) لسداد الديون ${v.prioritizeHighInterest ? '— ابدأ بأعلى فائدة' : ''}.`
      : `💎 أرباحك لك — خصّص ${v.emergencyPaydownRatio * 100}% فقط (${Math.round(amount).toLocaleString('ar-EG')} ج.م) لسداد الدين وادّخر الباقي.`,
  };
}

// ==================== RISK TOLERANCE SCORE → PERSONA ====================

/**
 * Risk Tolerance Score (1..100) → Persona mapping.
 *  1-35   → conservative
 *  36-65  → balanced
 *  66-100 → aggressive (gambler)
 */
export function scoreToPersona(score: number): PersonaType {
  if (score <= 35) return 'conservative';
  if (score <= 65) return 'balanced';
  return 'gambler';
}

export function personaLabelAr(p: PersonaType | string): string {
  if (p === 'conservative') return '🛡️ المحافظ';
  if (p === 'aggressive' || p === 'gambler') return '🔥 المغامر';
  return '⚖️ المتوازن';
}

// ==================== MULTI-PERSONA SCENARIO CARD ====================

/**
 * يحسب سيناريوهات الشخصيات الثلاث لنفس السهم دفعة واحدة.
 * يُستخدم في الـ Multi-Persona Dynamic Card على شاشة الشارت.
 */
export interface PersonaScenario {
  persona: PersonaVectorKey;
  labelAr: string;
  emoji: string;
  color: string;
  stopLoss: number;
  targetProfit: number;
  riskRewardRatio: number;
  maxPositionShares: number;
  maxPositionValueEGP: number;
  personaMaxRiskPct: number;
}

export function computeMultiPersonaScenarios(
  entry: number,
  atr: number,
  regime: MarketRegime | string,
  portfolioNetWorthEGP: number,
  assetRegimeWeight: number,
): PersonaScenario[] {
  const regimeVolMult = regimeVolatilityMultiplier(regime);
  const structureExtMult = 2.0;
  const labels: Record<PersonaVectorKey, { ar: string; emoji: string; color: string }> = {
    conservative: { ar: 'المحافظ', emoji: '🛡️', color: '#3b82f6' },
    balanced: { ar: 'المتوازن', emoji: '⚖️', color: '#eab308' },
    aggressive: { ar: 'المغامر', emoji: '🔥', color: '#ef4444' },
  };
  return (Object.keys(PERSONA_VECTORS) as PersonaVectorKey[]).map((k) => {
    const v = PERSONA_VECTORS[k];
    const targets = computePersonaScaledTargets(entry, atr, regimeVolMult, structureExtMult, k);
    const sizing = computeDynamicPositionSize(portfolioNetWorthEGP, assetRegimeWeight, entry, targets.stopLoss, k);
    return {
      persona: k,
      labelAr: labels[k].ar,
      emoji: labels[k].emoji,
      color: labels[k].color,
      stopLoss: Math.round(targets.stopLoss * 1000) / 1000,
      targetProfit: Math.round(targets.targetProfit * 1000) / 1000,
      riskRewardRatio: targets.riskRewardRatio,
      maxPositionShares: sizing.maxPositionShares,
      maxPositionValueEGP: sizing.maxPositionValueEGP,
      personaMaxRiskPct: v.maxRiskPercent,
    };
  });
}
