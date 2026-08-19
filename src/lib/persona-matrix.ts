/**
 * Persona Scaling Vector Matrix & Dynamic Engine Helper
 * ======================================================
 * Defines Investor Personas as dynamic scaling factors (Persona Vectors)
 * that adjust sub-engine weights, ATR stop/target multipliers, asset allocation caps,
 * and position sizing WITHOUT hardcoding static values.
 */

export type PersonaId = 'conservative' | 'balanced' | 'aggressive';

export interface WealthAllocationCap {
  stocksMinPct: number;
  stocksMaxPct: number;
  cryptoMaxPct: number;
  goldMinPct: number;
  goldMaxPct: number;
  cashMaxPct: number;
  forexMaxPct: number;
}

export interface PersonaProfile {
  id: PersonaId;
  nameAr: string;
  badgeColor: string;
  descriptionAr: string;
  // ATR Multipliers
  stopLossAtrFactor: number;    // Multiplier for ATR stop loss
  targetProfitAtrFactor: number;// Multiplier for ATR target profit
  // Risk Limits
  maxRiskPerTradePct: number;   // Max % of total portfolio risked per trade
  // Sub-Engine Scaling Vectors (Multipliers applied to Regime Weights)
  smcWeightFactor: number;      // Multiplier for SMC Breakout Engine
  quantWeightFactor: number;    // Multiplier for Quant Z-Score Engine
  riskWeightFactor: number;     // Multiplier for Dynamic Risk Engine
  egxWeightFactor: number;      // Multiplier for EGX Tuned Engine
  // Wealth Allocation Caps
  wealthCaps: WealthAllocationCap;
}

export const PERSONA_PROFILES: Record<PersonaId, PersonaProfile> = {
  conservative: {
    id: 'conservative',
    nameAr: '🛡️ المحافظ (Conservative)',
    badgeColor: 'emerald',
    descriptionAr: 'الحفاظ الصارم على رأس المال بأقل تراجع، مع عوائد منخفضة المخاطر.',
    stopLossAtrFactor: 0.8,
    targetProfitAtrFactor: 1.2,
    maxRiskPerTradePct: 1.0,
    smcWeightFactor: 0.4,
    quantWeightFactor: 1.8,
    riskWeightFactor: 1.6,
    egxWeightFactor: 1.2,
    wealthCaps: {
      stocksMinPct: 30,
      stocksMaxPct: 40,
      cryptoMaxPct: 5,   // Max 5% crypto
      goldMinPct: 25,
      goldMaxPct: 35,
      cashMaxPct: 30,
      forexMaxPct: 15,
    },
  },
  balanced: {
    id: 'balanced',
    nameAr: '⚖️ المتوازن (Balanced)',
    badgeColor: 'blue',
    descriptionAr: 'نمو متوازن ومدروس يجمع بين فرص الربح والحماية الفعالة.',
    stopLossAtrFactor: 1.0,
    targetProfitAtrFactor: 1.0,
    maxRiskPerTradePct: 2.0,
    smcWeightFactor: 1.0,
    quantWeightFactor: 1.0,
    riskWeightFactor: 1.0,
    egxWeightFactor: 1.0,
    wealthCaps: {
      stocksMinPct: 45,
      stocksMaxPct: 55,
      cryptoMaxPct: 15,  // Max 15% crypto
      goldMinPct: 15,
      goldMaxPct: 20,
      cashMaxPct: 15,
      forexMaxPct: 15,
    },
  },
  aggressive: {
    id: 'aggressive',
    nameAr: '🔥 المغامر / المضارب (Aggressive / Scalper)',
    badgeColor: 'rose',
    descriptionAr: 'اقتناص اختراقات الزخم والفرص السريعة لأقصى نمو رأس مالي.',
    stopLossAtrFactor: 1.5,
    targetProfitAtrFactor: 1.8,
    maxRiskPerTradePct: 4.5,
    smcWeightFactor: 2.0,
    quantWeightFactor: 0.5,
    riskWeightFactor: 0.5,
    egxWeightFactor: 0.8,
    wealthCaps: {
      stocksMinPct: 50,
      stocksMaxPct: 65,
      cryptoMaxPct: 35,  // Up to 35% crypto
      goldMinPct: 5,
      goldMaxPct: 10,
      cashMaxPct: 10,
      forexMaxPct: 10,
    },
  },
};

/** Get persona profile safely with fallback to 'balanced' */
export function getPersonaProfile(id?: string | null): PersonaProfile {
  if (id === 'conservative' || id === 'balanced' || id === 'aggressive') {
    return PERSONA_PROFILES[id];
  }
  return PERSONA_PROFILES.balanced;
}

/**
 * Rescales dynamic sub-engine weights according to the user's persona vector.
 * Sum of returned weights equals 1.0 (100%).
 */
export function calculateRescaledEngineWeights(
  regimeWeights: { smc: number; quant: number; risk: number; egx: number },
  personaId: PersonaId = 'balanced'
): { smc: number; quant: number; risk: number; egx: number } {
  const profile = getPersonaProfile(personaId);

  const rawSmc = regimeWeights.smc * profile.smcWeightFactor;
  const rawQuant = regimeWeights.quant * profile.quantWeightFactor;
  const rawRisk = regimeWeights.risk * profile.riskWeightFactor;
  const rawEgx = regimeWeights.egx * profile.egxWeightFactor;

  const total = rawSmc + rawQuant + rawRisk + rawEgx || 1.0;

  return {
    smc: Number((rawSmc / total).toFixed(4)),
    quant: Number((rawQuant / total).toFixed(4)),
    risk: Number((rawRisk / total).toFixed(4)),
    egx: Number((rawEgx / total).toFixed(4)),
  };
}

/**
 * Computes ATR Stop Loss & Target Profit scaled dynamically by persona.
 */
export function calculatePersonaDynamicTargets(
  entryPrice: number,
  atrValue: number,
  baseStopMultiplier: number = 1.5,
  baseTargetMultiplier: number = 2.5,
  personaId: PersonaId = 'balanced'
): { stopLoss: number; stopLossPct: number; targetPrice: number; targetProfitPct: number; riskRewardRatio: number } {
  const profile = getPersonaProfile(personaId);

  const effectiveStopMult = baseStopMultiplier * profile.stopLossAtrFactor;
  const effectiveTargetMult = baseTargetMultiplier * profile.targetProfitAtrFactor;

  const stopLoss = Math.max(0.01, Number((entryPrice - atrValue * effectiveStopMult).toFixed(2)));
  const targetPrice = Number((entryPrice + atrValue * effectiveTargetMult).toFixed(2));

  const stopLossPct = Number((((entryPrice - stopLoss) / entryPrice) * 100).toFixed(2));
  const targetProfitPct = Number((((targetPrice - entryPrice) / entryPrice) * 100).toFixed(2));

  const riskRewardRatio = stopLossPct > 0 ? Number((targetProfitPct / stopLossPct).toFixed(2)) : 2.0;

  return {
    stopLoss,
    stopLossPct,
    targetPrice,
    targetProfitPct,
    riskRewardRatio,
  };
}

/**
 * Calculates max position size (in currency units) for a trade based on portfolio net worth
 * and persona risk tolerance.
 */
export function calculatePersonaPositionSize(
  portfolioNetWorth: number,
  entryPrice: number,
  stopLossPrice: number,
  personaId: PersonaId = 'balanced'
): { maxAllocationAmount: number; maxShares: number; riskAmount: number } {
  const profile = getPersonaProfile(personaId);
  const maxRiskAmount = (portfolioNetWorth * profile.maxRiskPerTradePct) / 100;

  const riskPerShare = Math.max(0.01, entryPrice - stopLossPrice);
  const rawShares = Math.floor(maxRiskAmount / riskPerShare);
  const maxAllocationAmount = Math.min(portfolioNetWorth * 0.3, rawShares * entryPrice);

  return {
    maxAllocationAmount: Number(maxAllocationAmount.toFixed(2)),
    maxShares: rawShares,
    riskAmount: Number(maxRiskAmount.toFixed(2)),
  };
}
