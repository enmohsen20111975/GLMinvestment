/**
 * Dynamic Analysis Engine — Gemini Strategy Implementation
 * =========================================================
 * محرك التحليل الديناميكي المتكيف
 *
 * "السوق كائن حي بيتحرك بالسيولة والنفسية، مش بكتالوج ثابت"
 *
 * This engine implements the 4 core Gemini proposals:
 * 1. Dynamic Parameter Matrix — RSI/ATR/MA periods adapt to Regime + Volatility + Sector
 * 2. ATR-Aware Structural Targets — Stop & Target based on ATR multipliers + S/R + Fib extensions
 * 3. Adaptive Weights Engine — Component weights shift based on market regime
 * 4. BB Squeeze Detection + Position Override — Squeeze triggers momentum boost; profitable positions override to TAKE_PROFIT
 *
 * Design: Pure functions, no DB, no network. Can be called from maestro.ts, gate-analyzer.ts,
 * or any API route.
 */

// ============================================================================
// TYPES
// ============================================================================

export type StockRegime = 'STRONG_BULL' | 'WEAK_BULL' | 'RANGE' | 'WEAK_BEAR' | 'STRONG_BEAR';
export type SectorSpeed = 'FAST' | 'MEDIUM' | 'SLOW';
export type VolatilityLevel = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
export type SqueezeLevel = 'NONE' | 'NARROWING' | 'SQUEEZE' | 'EXTREME_SQUEEZE';
export type SignalType = 'BUY' | 'SELL' | 'HOLD' | 'TAKE_PROFIT' | 'STRONG_BUY' | 'STRONG_SELL';

export interface DynamicParams {
  // RSI thresholds — move based on regime
  rsiOverbought: number;
  rsiOversold: number;
  rsiPeriod: number;
  // ATR
  atrPeriod: number;
  atrStopMultiplier: number;
  atrTargetMultiplier: number;
  // Swing / Structure
  swingLookback: number;
  // Risk management
  minRiskReward: number;
  // BB Squeeze
  bbSqueezeThreshold: number;  // BB Width % below this = squeeze
  // Trailing
  trailingStopPct: number;
  minProfitPct: number;
}

export interface BBSqueezeResult {
  level: SqueezeLevel;
  bbWidthPct: number;        // current BB width as % of price
  bbWidthTrend: 'narrowing' | 'stable' | 'widening';
  avgWidth20: number;        // 20-period average BB width
  squeezeScore: number;      // 0-100, higher = more squeezed
  descriptionAr: string;
}

export interface StructuralTargets {
  entry: number;
  target: number;
  stopLoss: number;
  riskReward: number;
  targetSource: 'swing_resistance' | 'fibonacci_1618' | 'fibonacci_1272' | 'atr_multiple' | 'atr_floor';
  stopSource: 'swing_support' | 'atr_multiple' | 'atr_floor';
  fibExtensionUsed: number | null;  // 1.272 or 1.618 if Fibonacci was used
  distanceToResistance: number | null;
  distanceToSupport: number | null;
}

export interface AdaptiveWeights {
  technical: number;
  fundamental: number;
  momentum: number;
  volumeProfile: number;
  supportResistance: number;
  bollingerBands: number;
  risk: number;
  // Regime context
  regime: StockRegime;
  regimeLabel: string;
  regimeMultiplier: number;
}

export interface PositionOverrideResult {
  shouldOverride: boolean;
  originalSignal: SignalType;
  overrideSignal: SignalType;
  reason: string;
  reasonAr: string;
}

export interface DynamicAnalysisResult {
  // The 4 modules
  params: DynamicParams;
  squeeze: BBSqueezeResult;
  targets: StructuralTargets | null;
  weights: AdaptiveWeights;
  positionOverride: PositionOverrideResult | null;
  // Derived
  regime: StockRegime;
  volatility: VolatilityLevel;
  sectorSpeed: SectorSpeed;
  // Context for UI
  analysisNotes: string[];
  analysisNotesAr: string[];
}

// ============================================================================
// 1. DYNAMIC PARAMETER MATRIX
// ============================================================================

const FAST_SECTORS = ['technology', 'tech', 'تكنولوجيا', 'pharma', 'أدوية', 'financial', 'مصرفي', 'banking', 'بنوك', 'services', 'خدمات', 'telecom', 'اتصالات'];
const SLOW_SECTORS = ['utilities', 'مرافق', 'real estate', 'عقارات', 'consumer staples', 'سلع استهلاكية', 'cement', 'أسمنت', 'construction', 'بناء', 'food', 'أغذية', 'healthcare', 'رعاية صحية'];

export function classifySectorSpeed(sector: string): SectorSpeed {
  const s = (sector || '').toLowerCase();
  if (FAST_SECTORS.some(f => s.includes(f))) return 'FAST';
  if (SLOW_SECTORS.some(f => s.includes(f))) return 'SLOW';
  return 'MEDIUM';
}

export function classifyVolatility(atrPct: number): VolatilityLevel {
  if (atrPct > 6) return 'VERY_HIGH';
  if (atrPct > 4) return 'HIGH';
  if (atrPct > 2) return 'MEDIUM';
  if (atrPct > 1) return 'LOW';
  return 'VERY_LOW';
}

export function detectStockRegime(
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  rsi: number | null,
  adx: number | null,
  priceVsMA20: number | null,  // % above/below MA20
  priceVsMA50: number | null,  // % above/below MA50
): StockRegime {
  // Use multiple signals to determine regime strength
  const isBull = trend === 'BULLISH';
  const isBear = trend === 'BEARISH';
  const strongTrend = (adx && adx > 30) || false;
  const strongPricePosition = priceVsMA20 !== null && Math.abs(priceVsMA20) > 5;

  if (isBull) {
    if (strongTrend && strongPricePosition && priceVsMA50 !== null && priceVsMA50 > 8) {
      return 'STRONG_BULL';
    }
    return 'WEAK_BULL';
  }
  if (isBear) {
    if (strongTrend && strongPricePosition && priceVsMA50 !== null && priceVsMA50 < -8) {
      return 'STRONG_BEAR';
    }
    return 'WEAK_BEAR';
  }
  return 'RANGE';
}

export function getDynamicParams(
  regime: StockRegime,
  volatility: VolatilityLevel,
  sectorSpeed: SectorSpeed,
  baseParams?: Partial<DynamicParams>,
): DynamicParams {
  const defaults: DynamicParams = {
    rsiOverbought: 70,
    rsiOversold: 30,
    rsiPeriod: 14,
    atrPeriod: 14,
    atrStopMultiplier: 1.8,
    atrTargetMultiplier: 2.5,
    swingLookback: 20,
    minRiskReward: 1.5,
    bbSqueezeThreshold: 3.0,
    trailingStopPct: 0.05,
    minProfitPct: 0.03,
  };

  const p: DynamicParams = { ...defaults, ...baseParams };

  // ---- REGIME ADJUSTMENTS ----
  switch (regime) {
    case 'STRONG_BULL':
      // In strong bull: lower overbought (70), higher oversold (38) — strong stocks don't reach 30
      p.rsiOverbought = Math.max(55, p.rsiOverbought - 5);  // 65
      p.rsiOversold = Math.max(0, p.rsiOversold + 8);        // 38
      p.minRiskReward = Math.max(0.8, p.minRiskReward - 0.5); // 1.0 — more aggressive entries
      p.atrStopMultiplier = Math.max(1.2, p.atrStopMultiplier - 0.3); // 1.5 — tighter stops in trend
      break;
    case 'WEAK_BULL':
      p.rsiOverbought = Math.max(60, p.rsiOverbought - 3);  // 67
      p.rsiOversold = Math.max(0, p.rsiOversold + 4);        // 34
      p.minRiskReward = Math.max(1.0, p.minRiskReward - 0.2); // 1.3
      break;
    case 'RANGE':
      // In range: standard thresholds, but higher R:R requirement
      p.minRiskReward = Math.max(1.8, p.minRiskReward + 0.3); // 1.8
      p.atrStopMultiplier = Math.max(1.5, p.atrStopMultiplier + 0.2); // 2.0 — wider stops for whipsaws
      break;
    case 'WEAK_BEAR':
      p.rsiOverbought = Math.min(90, p.rsiOverbought + 5);   // 75
      p.rsiOversold = Math.max(0, p.rsiOversold - 2);         // 28
      p.minRiskReward = Math.min(10, p.minRiskReward + 0.3);  // 1.8
      break;
    case 'STRONG_BEAR':
      // In strong bear: high overbought threshold (80), lower oversold (22)
      p.rsiOverbought = Math.min(95, p.rsiOverbought + 10);  // 80
      p.rsiOversold = Math.max(0, p.rsiOversold - 8);         // 22
      p.minRiskReward = Math.min(10, p.minRiskReward + 0.5);  // 2.0 — very strict
      p.atrStopMultiplier = Math.max(1.5, p.atrStopMultiplier + 0.5); // 2.3 — very wide stops
      break;
  }

  // ---- VOLATILITY ADJUSTMENTS ----
  switch (volatility) {
    case 'VERY_HIGH':
      p.swingLookback = Math.min(100, p.swingLookback + 8);   // +8
      p.atrPeriod = Math.min(30, p.atrPeriod + 4);            // +4
      p.rsiPeriod = Math.min(28, p.rsiPeriod + 4);            // +4 — smoother RSI
      p.atrStopMultiplier = Math.max(1.5, p.atrStopMultiplier + 0.7); // +0.7 — wide stops
      p.atrTargetMultiplier = Math.max(2.0, p.atrTargetMultiplier + 0.5);
      p.trailingStopPct = Math.min(0.15, p.trailingStopPct + 0.03);
      break;
    case 'HIGH':
      p.swingLookback = Math.min(80, p.swingLookback + 5);    // +5
      p.atrPeriod = Math.min(25, p.atrPeriod + 2);            // +2
      p.rsiPeriod = Math.min(25, p.rsiPeriod + 2);            // +2
      p.atrStopMultiplier = Math.max(1.5, p.atrStopMultiplier + 0.4);
      p.atrTargetMultiplier = Math.max(2.0, p.atrTargetMultiplier + 0.3);
      break;
    case 'LOW':
      p.swingLookback = Math.max(8, p.swingLookback - 4);     // -4
      p.atrPeriod = Math.max(7, p.atrPeriod - 2);             // -2
      p.rsiPeriod = Math.max(7, p.rsiPeriod - 1);             // -1
      p.atrStopMultiplier = Math.max(1.2, p.atrStopMultiplier - 0.2);
      break;
    case 'VERY_LOW':
      p.swingLookback = Math.max(6, p.swingLookback - 6);     // -6
      p.atrPeriod = Math.max(5, p.atrPeriod - 3);             // -3
      p.rsiPeriod = Math.max(5, p.rsiPeriod - 2);             // -2
      p.atrStopMultiplier = Math.max(1.0, p.atrStopMultiplier - 0.3);
      break;
    // MEDIUM: no adjustment
  }

  // ---- SECTOR SPEED ADJUSTMENTS ----
  switch (sectorSpeed) {
    case 'FAST':
      p.swingLookback = Math.max(5, p.swingLookback - 3);     // -3 — faster reaction
      p.atrPeriod = Math.max(5, p.atrPeriod - 2);             // -2
      p.rsiPeriod = Math.max(7, p.rsiPeriod - 2);             // -2
      break;
    case 'SLOW':
      p.swingLookback = Math.min(100, p.swingLookback + 4);   // +4 — more patience
      p.atrPeriod = Math.min(25, p.atrPeriod + 2);            // +2
      p.rsiPeriod = Math.min(25, p.rsiPeriod + 2);            // +2
      break;
    // MEDIUM: no adjustment
  }

  return p;
}

// ============================================================================
// 2. BB SQUEEZE DETECTOR
// ============================================================================

/**
 * Detect Bollinger Band Squeeze.
 * BB Squeeze = BB Width is significantly below its recent average.
 * When squeeze is active, expect a big move (explosion) — direction is unknown
 * but momentum/volume will tell.
 *
 * Formula:
 *   BB Width = (4 * SD) / MA20  (as % of price)
 *   Squeeze = BB Width < avg(BB Width, 20 periods) * 0.6
 */
export function detectBBSqueeze(
  bbWidthPct: number | null,         // current BB width as % of price
  bbWidthHistory: number[] = [],     // recent BB width values (up to 50 periods)
): BBSqueezeResult {
  const empty: BBSqueezeResult = {
    level: 'NONE',
    bbWidthPct: 0,
    bbWidthTrend: 'stable',
    avgWidth20: 0,
    squeezeScore: 0,
    descriptionAr: 'بيانات غير كافية',
  };

  if (bbWidthPct === null || bbWidthPct <= 0) return empty;

  // Calculate average of recent BB widths
  const history = bbWidthHistory.length > 0 ? bbWidthHistory : [bbWidthPct];
  const avgWidth = history.reduce((a, b) => a + b, 0) / history.length;

  // Determine trend: compare recent 5 vs previous 10
  const recent5 = history.slice(-5);
  const prev10 = history.slice(-15, -5);
  let trend: 'narrowing' | 'stable' | 'widening' = 'stable';
  if (recent5.length > 0 && prev10.length > 0) {
    const avgRecent = recent5.reduce((a, b) => a + b, 0) / recent5.length;
    const avgPrev = prev10.reduce((a, b) => a + b, 0) / prev10.length;
    if (avgPrev > 0) {
      const change = (avgRecent - avgPrev) / avgPrev;
      if (change < -0.15) trend = 'narrowing';
      else if (change > 0.15) trend = 'widening';
    }
  }

  // Squeeze detection
  const ratio = avgWidth > 0 ? bbWidthPct / avgWidth : 1;
  let level: SqueezeLevel;
  let squeezeScore: number;
  let descriptionAr: string;

  if (ratio < 0.4) {
    level = 'EXTREME_SQUEEZE';
    squeezeScore = 95;
    descriptionAr = 'انضغاط بولنجر شديد — انفجار سعري وشيك جداً';
  } else if (ratio < 0.6) {
    level = 'SQUEEZE';
    squeezeScore = 75;
    descriptionAr = 'انضغاط بولنجر — احتمال حركة قوية قريبة';
  } else if (ratio < 0.8 && trend === 'narrowing') {
    level = 'NARROWING';
    squeezeScore = 50;
    descriptionAr = 'النطاق بيتضيق تدريجياً — راقب الكسر';
  } else {
    level = 'NONE';
    squeezeScore = Math.round(Math.max(0, (1 - ratio) * 50));
    descriptionAr = 'لا يوجد انضغاط';
  }

  // Boost score if actively narrowing
  if (trend === 'narrowing' && level !== 'NONE') {
    squeezeScore = Math.min(100, squeezeScore + 10);
  }

  return {
    level,
    bbWidthPct: Math.round(bbWidthPct * 100) / 100,
    bbWidthTrend: trend,
    avgWidth20: Math.round(avgWidth * 100) / 100,
    squeezeScore,
    descriptionAr,
  };
}

// ============================================================================
// 3. ATR-AWARE STRUCTURAL TARGETS
// ============================================================================

/**
 * Calculate dynamic stop-loss and target based on:
 * 1. Primary: ATR multipliers (adaptive to volatility)
 * 2. Secondary: Structural S/R levels
 * 3. Tertiary: Fibonacci extensions (for breakout trades)
 *
 * Stop Loss = Entry - (ATR * DynamicMultiplier)
 * Target = max(Structural Resistance, ATR * TargetMultiplier, Fib Extension)
 */
export function calculateStructuralTargets(options: {
  entry: number;
  atr: number;
  signal: 'BUY' | 'SELL';
  support: number | null;
  resistance: number | null;
  farSupport: number | null;
  farResistance: number | null;
  recentSwingHighs: number[];
  recentSwingLows: number[];
  minRiskReward: number;
  atrStopMultiplier: number;
  atrTargetMultiplier: number;
  bbSqueezeLevel: SqueezeLevel;
}): StructuralTargets | null {
  // ALPHA-FAB-FIX-DYN-ANALYSIS-001: return type دلوقتي nullable — لو stop غير صالح → null (Rule 27+20).
  const {
    entry, atr, signal,
    support, resistance, farSupport, farResistance,
    recentSwingHighs, recentSwingLows,
    minRiskReward, atrStopMultiplier, atrTargetMultiplier,
    bbSqueezeLevel,
  } = options;

  const isBuy = signal === 'BUY';
  const atrPct = entry > 0 ? (atr / entry) * 100 : 0;

  // ---- STEP 1: Dynamic ATR Stop ----
  // Base stop from ATR with volatility-adaptive multiplier
  let stopAtrDist = atr * atrStopMultiplier;

  // In squeeze, widen the stop slightly (explosion can be violent)
  if (bbSqueezeLevel === 'SQUEEZE' || bbSqueezeLevel === 'EXTREME_SQUEEZE') {
    stopAtrDist *= 1.2;
  }

  let stopLoss: number;
  let stopSource: StructuralTargets['stopSource'] = 'atr_multiple';

  if (isBuy) {
    stopLoss = entry - stopAtrDist;
    // If there's a structural support that's closer (tighter stop = better R:R)
    if (support && support > 0 && support < entry) {
      const supportDist = entry - support;
      // Use support if it's between 0.5x and 1.5x ATR (not too tight, not too wide)
      if (supportDist >= atr * 0.5 && supportDist <= atr * 2.5) {
        stopLoss = support * 0.995; // tiny buffer below support
        stopSource = 'swing_support';
      }
    }
  } else {
    stopLoss = entry + stopAtrDist;
    if (resistance && resistance > entry) {
      const resDist = resistance - entry;
      if (resDist >= atr * 0.5 && resDist <= atr * 2.5) {
        stopLoss = resistance * 1.005;
        stopSource = 'swing_support'; // reusing label for symmetry
      }
    }
  }

  // Floor: ensure stop is at least 0.5% away
  const minStopDist = entry * 0.005;
  if (Math.abs(stopLoss - entry) < minStopDist) {
    stopLoss = isBuy ? entry - minStopDist : entry + minStopDist;
    stopSource = 'atr_floor';
  }

  // ALPHA-FAB-FIX-DYN-ANALYSIS-001: removed entry*0.97/1.03 fabrication (Rule 27+20).
  // لو stop غير صالح → return null (سياسة الفراغ). الـ stop من Python فقط.
  if (stopLoss <= 0 || (isBuy && stopLoss >= entry) || (!isBuy && stopLoss <= entry)) {
    return null;
  }

  // ---- STEP 2: Structural Target ----
  let target: number;
  let targetSource: StructuralTargets['targetSource'] = 'atr_multiple';
  let fibExtensionUsed: number | null = null;

  const riskDist = Math.abs(entry - stopLoss);
  const minTargetDist = riskDist * minRiskReward;

  // Candidate 1: ATR-based target
  let targetAtrDist = atr * atrTargetMultiplier;
  // In squeeze, target can be bigger (explosive moves)
  if (bbSqueezeLevel === 'SQUEEZE') targetAtrDist *= 1.15;
  if (bbSqueezeLevel === 'EXTREME_SQUEEZE') targetAtrDist *= 1.3;

  let candidateTarget: number;
  if (isBuy) {
    candidateTarget = entry + targetAtrDist;
  } else {
    candidateTarget = entry - targetAtrDist;
  }

  // Candidate 2: Structural resistance/support
  if (isBuy) {
    // Try nearest resistance first
    const nearRes = resistance || (recentSwingHighs.length > 0 ? recentSwingHighs[recentSwingHighs.length - 1] : null);
    if (nearRes && nearRes > entry) {
      const resDist = nearRes - entry;
      if (resDist >= minTargetDist) {
        candidateTarget = nearRes;
        targetSource = 'swing_resistance';
      }
    }
    // If no resistance ahead (Blue Sky Breakout), use Fibonacci 1.618
    if (targetSource === 'atr_multiple' && !resistance && farResistance === null && recentSwingHighs.length === 0) {
      // Use the most recent significant swing low → high range
      if (recentSwingLows.length > 0 && recentSwingHighs.length > 0) {
        const lastLow = Math.min(...recentSwingLows.slice(-3));
        const lastHigh = Math.max(...recentSwingHighs.slice(-3));
        const range = lastHigh - lastLow;
        if (range > 0) {
          const fib1618 = entry + range * 0.618; // extension from entry
          const fib1272 = entry + range * 0.272;
          if (fib1272 >= minTargetDist + entry) {
            candidateTarget = fib1618 > candidateTarget ? fib1618 : candidateTarget;
            targetSource = 'fibonacci_1618';
            fibExtensionUsed = 1.618;
          }
        }
      }
    }
  } else {
    // For SELL: target towards support
    const nearSup = support || (recentSwingLows.length > 0 ? recentSwingLows[recentSwingLows.length - 1] : null);
    if (nearSup && nearSup < entry) {
      const supDist = entry - nearSup;
      if (supDist >= minTargetDist) {
        candidateTarget = nearSup;
        targetSource = 'swing_resistance'; // symmetric label
      }
    }
  }

  // Ensure minimum R:R
  if (isBuy) {
    if (candidateTarget - entry < minTargetDist) {
      candidateTarget = entry + minTargetDist;
      targetSource = 'atr_floor';
    }
    target = candidateTarget;
  } else {
    if (entry - candidateTarget < minTargetDist) {
      candidateTarget = entry - minTargetDist;
      targetSource = 'atr_floor';
    }
    target = candidateTarget;
  }

  // ISSUE-3 FIX: removed fabricated entry*1.05/entry*0.95 fallback.
  // If no real target found, leave as 0 — caller should handle NULL.
  // (Previous: if (target <= 0) target = isBuy ? entry * 1.05 : entry * 0.95;)

  // ---- STEP 3: Calculate R:R ----
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(target - entry);
  const riskReward = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;

  return {
    entry: Math.round(entry * 10000) / 10000,
    target: Math.round(target * 10000) / 10000,
    stopLoss: Math.round(stopLoss * 10000) / 10000,
    riskReward,
    targetSource,
    stopSource,
    fibExtensionUsed,
    distanceToResistance: resistance ? Math.round(((resistance - entry) / entry) * 10000) / 100 : null,
    distanceToSupport: support ? Math.round(((entry - support) / entry) * 10000) / 100 : null,
  };
}

// ============================================================================
// 4. ADAPTIVE WEIGHTS ENGINE
// ============================================================================

/**
 * Calculate analysis component weights based on market regime.
 * In different market conditions, different indicators are more/less important.
 *
 * STRONG_BULL: Momentum + Volume drive → higher technical/momentum weights
 * RANGE: Fundamental + S/R drive → higher fundamental/SR weights
 * STRONG_BEAR: Risk management dominates → higher risk weight
 */
export function getAdaptiveWeights(regime: StockRegime): AdaptiveWeights {
  const REGIME_CONFIGS: Record<StockRegime, {
    weights: AdaptiveWeights;
    label: string;
    multiplier: number;
  }> = {
    STRONG_BULL: {
      weights: {
        technical: 0.25,
        fundamental: 0.15,
        momentum: 0.20,
        volumeProfile: 0.18,
        supportResistance: 0.10,
        bollingerBands: 0.07,
        risk: 0.05,
        regime: 'STRONG_BULL',
        regimeLabel: 'صاعد قوي — السيولة والزخم هما الملك',
        regimeMultiplier: 1.2,
      },
      label: 'صاعد قوي',
      multiplier: 1.2,
    },
    WEAK_BULL: {
      weights: {
        technical: 0.22,
        fundamental: 0.18,
        momentum: 0.15,
        volumeProfile: 0.15,
        supportResistance: 0.15,
        bollingerBands: 0.08,
        risk: 0.07,
        regime: 'WEAK_BULL',
        regimeLabel: 'صاعد ضعيف — تأكد من الدعم قبل الدخول',
        regimeMultiplier: 1.1,
      },
      label: 'صاعد ضعيف',
      multiplier: 1.1,
    },
    RANGE: {
      weights: {
        technical: 0.15,
        fundamental: 0.22,
        momentum: 0.10,
        volumeProfile: 0.10,
        supportResistance: 0.22,
        bollingerBands: 0.13,
        risk: 0.08,
        regime: 'RANGE',
        regimeLabel: 'عرضي — الدعم والمقاومة والبولنجر هما المرجع',
        regimeMultiplier: 0.9,
      },
      label: 'عرضي',
      multiplier: 0.9,
    },
    WEAK_BEAR: {
      weights: {
        technical: 0.18,
        fundamental: 0.20,
        momentum: 0.12,
        volumeProfile: 0.12,
        supportResistance: 0.12,
        bollingerBands: 0.10,
        risk: 0.16,
        regime: 'WEAK_BEAR',
        regimeLabel: 'هابط ضعيف — حذر من الفخاخ والارتدادات',
        regimeMultiplier: 0.8,
      },
      label: 'هابط ضعيف',
      multiplier: 0.8,
    },
    STRONG_BEAR: {
      weights: {
        technical: 0.15,
        fundamental: 0.15,
        momentum: 0.10,
        volumeProfile: 0.10,
        supportResistance: 0.10,
        bollingerBands: 0.10,
        risk: 0.30,
        regime: 'STRONG_BEAR',
        regimeLabel: 'هابط قوي — إدارة المخاطر أولاً والابتعاد أفضل',
        regimeMultiplier: 0.6,
      },
      label: 'هابط قوي',
      multiplier: 0.6,
    },
  };

  const config = REGIME_CONFIGS[regime];
  return { ...config.weights };
}

// ============================================================================
// 5. POSITION OVERRIDE ENGINE
// ============================================================================

/**
 * Override the generated signal based on the user's existing position state.
 * Key rule: If the user is already in profit and indicators show exhaustion,
 * flip the signal to TAKE_PROFIT regardless of what the model says.
 *
 * Example from Gemini proposal:
 * "لو السهم جايب ربح 15% والـ RSI تضخم، المنظومة تقلب الإشارة لـ TAKE_PROFIT
 *  فوراً بدل ما تفضل تقوله BUY بناءً على الزخم القديم"
 */
export function applyPositionOverride(options: {
  currentSignal: SignalType;
  userPositionPnl: number | null;  // % profit/loss (e.g. 15.5 or -3.2), null if no position
  rsi: number | null;
  rsiOverbought: number;
  rsiOversold: number;
  bollingerWidthPct: number | null;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  priceVsMA20: number | null;  // % above/below MA20
}): PositionOverrideResult | null {
  const {
    currentSignal, userPositionPnl, rsi, rsiOverbought, rsiOversold,
    bollingerWidthPct, trend, priceVsMA20,
  } = options;

  // No position = no override
  if (userPositionPnl === null) return null;

  const noOverride: PositionOverrideResult = {
    shouldOverride: false,
    originalSignal: currentSignal,
    overrideSignal: currentSignal,
    reason: '',
    reasonAr: '',
  };

  // ---- PROFITABLE LONG POSITION ----
  if (userPositionPnl > 0) {
    // Rule 1: Significant profit + RSI overbought = TAKE_PROFIT
    if (userPositionPnl >= 10 && rsi !== null && rsi >= rsiOverbought) {
      return {
        shouldOverride: true,
        originalSignal: currentSignal,
        overrideSignal: 'TAKE_PROFIT',
        reason: `Position +${userPositionPnl.toFixed(1)}% with RSI ${rsi.toFixed(0)} >= ${rsiOverbought} (overbought)`,
        reasonAr: `المركز رابح ${userPositionPnl.toFixed(1)}% والـ RSI ${rsi.toFixed(0)} في تشبع شرائي — جني أرباح`,
      };
    }

    // Rule 2: Big profit + bearish trend reversal = TAKE_PROFIT
    if (userPositionPnl >= 15 && trend === 'BEARISH') {
      return {
        shouldOverride: true,
        originalSignal: currentSignal,
        overrideSignal: 'TAKE_PROFIT',
        reason: `Position +${userPositionPnl.toFixed(1)}% but trend reversed to BEARISH`,
        reasonAr: `المركز رابح ${userPositionPnl.toFixed(1)}% لكن الاتجاه انعكس هابط — جني أرباح فوراً`,
      };
    }

    // Rule 3: Big profit + price dropped below MA20 = TAKE_PROFIT
    if (userPositionPnl >= 12 && priceVsMA20 !== null && priceVsMA20 < -2) {
      return {
        shouldOverride: true,
        originalSignal: currentSignal,
        overrideSignal: 'TAKE_PROFIT',
        reason: `Position +${userPositionPnl.toFixed(1)}% but price ${priceVsMA20.toFixed(1)}% below MA20`,
        reasonAr: `المركز رابح ${userPositionPnl.toFixed(1)}% لكن السعر نزل تحت المتوسط — جني أرباح`,
      };
    }

    // Rule 4: Moderate profit + BB very wide (exhaustion) = TAKE_PROFIT
    if (userPositionPnl >= 8 && bollingerWidthPct !== null && bollingerWidthPct > 8) {
      return {
        shouldOverride: true,
        originalSignal: currentSignal,
        overrideSignal: 'TAKE_PROFIT',
        reason: `Position +${userPositionPnl.toFixed(1)}% with BB width ${bollingerWidthPct.toFixed(1)}% (exhaustion)`,
        reasonAr: `المركز رابح ${userPositionPnl.toFixed(1)}% والبولنجر متسع جداً (إرهاق) — جني أرباح`,
      };
    }

    // Rule 5: Huge profit (>20%) — always suggest taking at least partial profit
    if (userPositionPnl >= 20 && currentSignal !== 'TAKE_PROFIT') {
      return {
        shouldOverride: true,
        originalSignal: currentSignal,
        overrideSignal: 'TAKE_PROFIT',
        reason: `Position +${userPositionPnl.toFixed(1)}% — profit protection trigger at 20%`,
        reasonAr: `المركز رابح ${userPositionPnl.toFixed(1)}% — حماية الأرباح (تجاوز 20%)`,
      };
    }
  }

  // ---- LOSING POSITION ----
  if (userPositionPnl < 0) {
    // Rule 6: Significant loss + RSI oversold in downtrend = DON'T override to BUY
    // (prevent catching falling knives when already losing)
    if (userPositionPnl <= -8 && trend === 'BEARISH' && rsi !== null && rsi <= rsiOversold && currentSignal === 'BUY') {
      return {
        shouldOverride: true,
        originalSignal: 'BUY',
        overrideSignal: 'HOLD',
        reason: `Position -${Math.abs(userPositionPnl).toFixed(1)}% in BEARISH trend — avoid adding to loser (catching falling knife)`,
        reasonAr: `خسارة ${Math.abs(userPositionPnl).toFixed(1)}% في اتجاه هابط — مفيش حاجة تضيف على خاسر`,
      };
    }
  }

  return noOverride;
}

// ============================================================================
// 6. MAIN ENTRY POINT — TIE EVERYTHING TOGETHER
// ============================================================================

export interface DynamicAnalysisInput {
  // Price data
  close: number;
  atr: number | null;
  rsi: number | null;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  adx: number | null;
  // S/R
  support: number | null;
  resistance: number | null;
  farSupport: number | null;
  farResistance: number | null;
  recentSwingHighs: number[];
  recentSwingLows: number[];
  // BB
  bollingerWidthPct: number | null;
  bollingerWidthHistory: number[];
  // Fundamentals
  sector: string;
  // Position
  userPositionPnl: number | null;
  // Signal (from existing pipeline)
  currentSignal: SignalType;
  // Price vs MAs
  priceVsMA20: number | null;
  priceVsMA50: number | null;
}

export function runDynamicAnalysis(input: DynamicAnalysisInput): DynamicAnalysisResult {
  const notes: string[] = [];
  const notesAr: string[] = [];

  // ---- Step 1: Classify market context ----
  const regime = detectStockRegime(input.trend, input.rsi, input.adx, input.priceVsMA20, input.priceVsMA50);
  const atrPct = input.atr && input.close > 0 ? (input.atr / input.close) * 100 : 2;
  const volatility = classifyVolatility(atrPct);
  const sectorSpeed = classifySectorSpeed(input.sector);

  notes.push(`Regime=${regime}, Vol=${volatility}, Sector=${sectorSpeed}`);
  notesAr.push(`الوضع: ${regimeLabelAr(regime)}, التقلب: ${volatilityLabelAr(volatility)}, القطاع: ${sectorSpeedLabelAr(sectorSpeed)}`);

  // ---- Step 2: Dynamic Parameter Matrix ----
  const params = getDynamicParams(regime, volatility, sectorSpeed);
  notes.push(`RSI: ${params.rsiOversold}/${params.rsiOverbought}, ATR Stop: ${params.atrStopMultiplier}x, Min R:R: ${params.minRiskReward}`);
  notesAr.push(`RSI: ${params.rsiOversold}/${params.rsiOverbought}, وقف: ${params.atrStopMultiplier}×ATR, حد R:R: ${params.minRiskReward}`);

  // ---- Step 3: BB Squeeze ----
  const squeeze = detectBBSqueeze(input.bollingerWidthPct, input.bollingerWidthHistory);
  if (squeeze.level !== 'NONE') {
    notes.push(`BB Squeeze: ${squeeze.level} (score: ${squeeze.squeezeScore})`);
    notesAr.push(`انضغاط بولنجر: ${squeeze.level} (مستوى: ${squeeze.squeezeScore})`);
  }

  // ---- Step 4: Structural Targets ----
  let targets: StructuralTargets | null = null;
  if (input.atr && input.atr > 0 && (input.currentSignal === 'BUY' || input.currentSignal === 'SELL')) {
    targets = calculateStructuralTargets({
      entry: input.close,
      atr: input.atr,
      signal: input.currentSignal === 'BUY' || input.currentSignal === 'STRONG_BUY' ? 'BUY' : 'SELL',
      support: input.support,
      resistance: input.resistance,
      farSupport: input.farSupport,
      farResistance: input.farResistance,
      recentSwingHighs: input.recentSwingHighs,
      recentSwingLows: input.recentSwingLows,
      minRiskReward: params.minRiskReward,
      atrStopMultiplier: params.atrStopMultiplier,
      atrTargetMultiplier: params.atrTargetMultiplier,
      bbSqueezeLevel: squeeze.level,
    });
    if (targets) {
      notes.push(`Target: ${targets.target.toFixed(2)} (${targets.targetSource}), Stop: ${targets.stopLoss.toFixed(2)} (${targets.stopSource}), R:R: ${targets.riskReward}`);
      notesAr.push(`هدف: ${targets.target.toFixed(2)} (${targetSourceLabelAr(targets.targetSource)}), وقف: ${targets.stopLoss.toFixed(2)} (${targets.stopSource}), نسبة: ${targets.riskReward}`);
    }
  }

  // ---- Step 5: Adaptive Weights ----
  const weights = getAdaptiveWeights(regime);
  notes.push(`Weights: Tech=${(weights.technical * 100).toFixed(0)}% Fund=${(weights.fundamental * 100).toFixed(0)}% Mom=${(weights.momentum * 100).toFixed(0)}% Risk=${(weights.risk * 100).toFixed(0)}%`);
  notesAr.push(`الأوزان: فني=${(weights.technical * 100).toFixed(0)}% أساسي=${(weights.fundamental * 100).toFixed(0)}% زخم=${(weights.momentum * 100).toFixed(0)}% مخاطر=${(weights.risk * 100).toFixed(0)}%`);

  // ---- Step 6: Position Override ----
  let positionOverride: PositionOverrideResult | null = null;
  if (input.userPositionPnl !== null) {
    positionOverride = applyPositionOverride({
      currentSignal: input.currentSignal,
      userPositionPnl: input.userPositionPnl,
      rsi: input.rsi,
      rsiOverbought: params.rsiOverbought,
      rsiOversold: params.rsiOversold,
      bollingerWidthPct: input.bollingerWidthPct,
      trend: input.trend,
      priceVsMA20: input.priceVsMA20,
    });
    if (positionOverride && positionOverride.shouldOverride) {
      notes.push(`OVERRIDE: ${positionOverride.originalSignal} → ${positionOverride.overrideSignal}: ${positionOverride.reason}`);
      notesAr.push(`تجاوز: ${signalLabelAr(positionOverride.originalSignal)} → ${signalLabelAr(positionOverride.overrideSignal)}: ${positionOverride.reasonAr}`);
    }
  }

  return {
    params,
    squeeze,
    targets,
    weights,
    positionOverride,
    regime,
    volatility,
    sectorSpeed,
    analysisNotes: notes,
    analysisNotesAr: notesAr,
  };
}

// ============================================================================
// LABEL HELPERS
// ============================================================================

export function regimeLabelAr(regime: StockRegime): string {
  const labels: Record<StockRegime, string> = {
    STRONG_BULL: 'صاعد قوي 🐂',
    WEAK_BULL: 'صاعد ضعيف 📈',
    RANGE: 'عرضي ➡️',
    WEAK_BEAR: 'هابط ضعيف 📉',
    STRONG_BEAR: 'هابط قوي 🐻',
  };
  return labels[regime];
}

export function volatilityLabelAr(vol: VolatilityLevel): string {
  const labels: Record<VolatilityLevel, string> = {
    VERY_LOW: 'منخفض جداً',
    LOW: 'منخفض',
    MEDIUM: 'متوسط',
    HIGH: 'عالي',
    VERY_HIGH: 'عالي جداً',
  };
  return labels[vol];
}

export function sectorSpeedLabelAr(speed: SectorSpeed): string {
  const labels: Record<SectorSpeed, string> = {
    FAST: 'سريع ⚡',
    MEDIUM: 'متوسط',
    SLOW: 'بطيء 🐢',
  };
  return labels[speed];
}

function targetSourceLabelAr(source: string): string {
  const labels: Record<string, string> = {
    swing_resistance: 'مقاومة هيكلية',
    fibonacci_1618: 'فيبوناتشي 161.8%',
    fibonacci_1272: 'فيبوناتشي 127.2%',
    atr_multiple: 'مضاعف ATR',
    atr_floor: 'حد أدنى ATR',
    swing_support: 'دعم هيكلي',
    atr_multiple: 'مضاعف ATR',
    atr_floor: 'حد أدنى ATR',
  };
  return labels[source] || source;
}

function signalLabelAr(signal: SignalType): string {
  const labels: Record<SignalType, string> = {
    BUY: 'شراء',
    SELL: 'بيع',
    HOLD: 'انتظار',
    TAKE_PROFIT: 'جني أرباح',
    STRONG_BUY: 'شراء قوي',
    STRONG_SELL: 'بيع قوي',
  };
  return labels[signal] || signal;
}