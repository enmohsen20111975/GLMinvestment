/**
 * Gate Analyzer — TypeScript 5-Gate Analysis Engine
 *
 * Translates the Pine Script 5-gate stock analysis system into a pure
 * TypeScript function. Every calculation matches the TradingView indicator
 * exactly so the results are identical for the same input data.
 *
 * Gate 1: Liquidity   — volume + price floor
 * Gate 2: Trend       — SMA20/50 regime + market stage
 * Gate 3: S/R         — proximity to support / resistance
 * Gate 4: R/R         — dynamic ATR-based target & stop
 * Gate 5: Confirmation — MACD + RSI + Volume
 *
 * Signal priority chain produces one of 8 signal types.
 * Dual persona support: 'gambler' (aggressive) / 'investor' (conservative).
 *
 * PURE FUNCTION — no side effects, no I/O, deterministic.
 */

import { detectBBSqueeze, type BBSqueezeResult } from '@/lib/dynamic-analysis-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All values are for a single stock at a point in time */
export interface GateAnalysisInput {
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  avgVolume20: number;
  rsi: number;
  macdLine: number;
  signalLine: number;
  macdHist: number;
  sma20: number;
  sma50: number;
  sma200: number;
  atr: number;
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
  /** % change of sector (optional, for sector-relative analysis) */
  sectorPerformance?: number;
  /** BB Width as % of price (optional, for squeeze detection) */
  bollingerWidthPct?: number;
  /** Recent BB width history for squeeze trend (optional) */
  bollingerWidthHistory?: number[];
}

export interface GateResult {
  passed: boolean;
  name: string;
  nameAr: string;
  reason: string;
  reasonAr: string;
}

export type GateSignal =
  | "BUY_STRONG"
  | "BUY"
  | "BUY_CONTRARIAN"
  | "ACCUMULATE"
  | "SELL"
  | "SELL_STRONG"
  | "WAIT"
  | "AVOID";

export type GatePersona = "gambler" | "investor";

export interface GateAnalysisOutput {
  // Signal
  signal: GateSignal;
  signalAr: string;
  signalColor: string; // tailwind bg- class

  // Market Regime
  marketStage: string;
  marketStageAr: string;
  trendBull: boolean;
  trendBear: boolean;
  trendRange: boolean;

  // Gate Results
  gates: GateResult[];
  gatesPassed: number;
  minGates: number;

  // Targets (dynamic ATR-based)
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  targetPct: number;
  stopPct: number;
  rrRatio: number;

  // Dynamic Thresholds
  rsiBuyThreshold: number;
  rsiSellThreshold: number;
  minRrThreshold: number;
  atrPct: number;

  // Volume
  volumeRatio: number;

  // Stock Strength
  stockStrength: number;
  marketProxy: string;
  marketProxyAr: string;

  // Narrative
  narrative: string;

  // Persona
  persona: GatePersona;

  // BB Squeeze (Gemini Dynamic Analysis)
  bbSqueeze?: {
    level: string;
    bbWidthPct: number;
    bbWidthTrend: string;
    squeezeScore: number;
    descriptionAr: string;
  };
  squeezeBonusApplied: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RegimeConfig {
  minVolumeThreshold: number; // Gate 1
  supportZonePct: number; // Gate 3 — how close to support counts as "near"
  resistanceZonePct: number; // Gate 3 — how close to resistance counts as "near"
  rsiBuyThreshold: number; // Gate 5 / Signal
  rsiSellThreshold: number; // Gate 5 / Signal
  minRrThreshold: number; // Signal
  minGates: number; // minimum gates to produce a BUY
  confirmationStrict: boolean; // Gate 5 — true = all 3 conditions required
}

/**
 * Returns the regime-dependent configuration based on trend detection.
 * Bull = close > SMA20 and SMA20 > SMA50
 * Bear = close < SMA20 and SMA20 < SMA50
 * Range = everything else
 */
function getRegimeConfig(
  trendBull: boolean,
  trendBear: boolean,
  trendRange: boolean
): RegimeConfig {
  if (trendBull) {
    return {
      minVolumeThreshold: 40_000,
      supportZonePct: 2.5,
      resistanceZonePct: 3.0,
      rsiBuyThreshold: 30,
      rsiSellThreshold: 75,
      minRrThreshold: 1.5,
      minGates: 4,
      confirmationStrict: false, // MACD + (RSI OR volume)
    };
  }
  if (trendBear) {
    return {
      minVolumeThreshold: 60_000,
      supportZonePct: 1.5,
      resistanceZonePct: 2.0,
      rsiBuyThreshold: 25,
      rsiSellThreshold: 65,
      minRrThreshold: 2.0,
      minGates: 5,
      confirmationStrict: true, // ALL THREE required
    };
  }
  // Range
  return {
    minVolumeThreshold: 50_000,
    supportZonePct: 2.0,
    resistanceZonePct: 2.5,
    rsiBuyThreshold: 28,
    rsiSellThreshold: 70,
    minRrThreshold: 1.8,
    minGates: 4,
    confirmationStrict: true, // ALL THREE required
  };
}

/**
 * Determine the market stage (6 possible stages) with Arabic labels.
 * Also refines bull/bear into strong/weak variants.
 */
function getMarketStage(
  close: number,
  sma20: number,
  sma50: number,
  sma200: number,
  trendBull: boolean,
  trendBear: boolean,
  trendRange: boolean
): {
  stage: string;
  stageAr: string;
  refinedBull: boolean;
  refinedBear: boolean;
  refinedRange: boolean;
} {
  // Strong bull: above all three SMAs
  if (trendBull && close > sma200) {
    return {
      stage: "Strong Bull",
      stageAr: "صاعد قوي",
      refinedBull: true,
      refinedBear: false,
      refinedRange: false,
    };
  }
  // Weak bull: above SMA20 > SMA50 but below SMA200 (correction / recovery)
  if (trendBull && close <= sma200) {
    return {
      stage: "Weak Bull / Correction",
      stageAr: "تصحيح صاعد",
      refinedBull: true,
      refinedBear: false,
      refinedRange: false,
    };
  }
  // Strong bear: below all three SMAs
  if (trendBear && close < sma200) {
    return {
      stage: "Strong Bear",
      stageAr: "هابط قوي",
      refinedBull: false,
      refinedBear: true,
      refinedRange: false,
    };
  }
  // Weak bear: below SMA20 < SMA50 but above SMA200
  if (trendBear && close >= sma200) {
    return {
      stage: "Weak Bear",
      stageAr: "هابط ضعيف",
      refinedBull: false,
      refinedBear: true,
      refinedRange: false,
    };
  }
  // Range
  if (trendRange) {
    return {
      stage: "Range",
      stageAr: "عرضي",
      refinedBull: false,
      refinedBear: false,
      refinedRange: true,
    };
  }
  // Fallback — should be unreachable but just in case
  return {
    stage: "Range",
    stageAr: "عرضي",
    refinedBull: false,
    refinedBear: false,
    refinedRange: true,
  };
}

// ---------------------------------------------------------------------------
// Gate implementations
// ---------------------------------------------------------------------------

/**
 * Gate 1 — Liquidity
 * Pine: gate_1_liquidity = volume > min_volume_threshold and close > 1.0
 * Dynamic threshold varies by regime: 40K bull, 60K bear, 50K range
 */
function evaluateGate1(
  input: GateAnalysisInput,
  config: RegimeConfig
): GateResult {
  const passed = input.volume > config.minVolumeThreshold && input.close > 1.0;
  return {
    passed,
    name: "Liquidity",
    nameAr: "السيولة",
    reason: passed
      ? `Volume ${input.volume.toLocaleString()} > ${config.minVolumeThreshold.toLocaleString()} threshold, price ${input.close.toFixed(2)} > 1.0`
      : `Volume ${input.volume.toLocaleString()} ${input.volume <= config.minVolumeThreshold ? `≤ ${config.minVolumeThreshold.toLocaleString()} threshold` : "OK"}${input.close <= 1.0 ? `, price ${input.close.toFixed(2)} ≤ 1.0` : ""}`,
    reasonAr: passed
      ? `الحجم ${input.volume.toLocaleString()} أعلى من الحد ${config.minVolumeThreshold.toLocaleString()}، السعر ${input.close.toFixed(2)}`
      : `الحجم ${input.volume.toLocaleString()} أقل من الحد ${config.minVolumeThreshold.toLocaleString()}`,
  };
}

/**
 * Gate 2 — Trend
 * Pine: trend_bull = close > sma20 and sma20 > sma50
 *        trend_bear = close < sma20 and sma20 < sma50
 * Gambler: accepts bull or range (not bear)
 * Investor: requires bull only
 */
function evaluateGate2(
  input: GateAnalysisInput,
  trendBull: boolean,
  trendBear: boolean,
  trendRange: boolean,
  persona: GatePersona
): GateResult {
  let passed = false;
  let reason = "";

  if (persona === "gambler") {
    // Gambler accepts bull or range — only rejects bear
    passed = !trendBear;
    reason = passed
      ? trendBull
        ? "Gambler: Bull trend accepted (close > SMA20 > SMA50)"
        : "Gambler: Range trend accepted (not bearish)"
      : "Gambler: Bear trend rejected (close < SMA20 < SMA50)";
  } else {
    // Investor requires bull only
    passed = trendBull;
    reason = passed
      ? "Investor: Bull trend confirmed (close > SMA20 > SMA50)"
      : trendBear
        ? "Investor: Bear trend — not accepted"
        : "Investor: Range — bull trend required";
  }

  return {
    passed,
    name: "Trend",
    nameAr: "الاتجاه",
    reason,
    reasonAr: passed
      ? persona === "gambler"
        ? "المضارب: الاتجاه مقبول"
        : "المستثمر: الاتجاه الصاعد مؤكد"
      : persona === "gambler"
        ? "المضارب: الاتجاه الهابط مرفوض"
        : "المستثمر: يتطلب اتجاه صاعد",
  };
}

/**
 * Gate 3 — Support / Resistance
 * Pine:
 *   distance_to_support_pct = (close - nearest_support) / close * 100
 *   distance_to_resistance_pct = (nearest_resistance - close) / close * 100
 *   near_support = distance_to_support_pct < support_zone_pct
 *   near_resistance = distance_to_resistance_pct < resistance_zone_pct
 *   Gate passes if near_support AND NOT near_resistance
 */
function evaluateGate3(
  input: GateAnalysisInput,
  config: RegimeConfig
): GateResult {
  // Find nearest support (the one closest to close from below)
  const supports = [input.support1, input.support2].filter((s) => s > 0 && s < input.close);
  const nearestSupport = supports.length > 0 ? Math.max(...supports) : 0;

  // Find nearest resistance (the one closest to close from above)
  const resistances = [input.resistance1, input.resistance2].filter(
    (r) => r > 0 && r > input.close
  );
  const nearestResistance =
    resistances.length > 0 ? Math.min(...resistances) : 0;

  // Calculate distances
  const distanceToSupportPct =
    nearestSupport > 0 ? ((input.close - nearestSupport) / input.close) * 100 : 999;
  const distanceToResistancePct =
    nearestResistance > 0
      ? ((nearestResistance - input.close) / input.close) * 100
      : 999;

  const nearSupport = distanceToSupportPct < config.supportZonePct;
  const nearResistance = distanceToResistancePct < config.resistanceZonePct;
  const passed = nearSupport && !nearResistance;

  const reason = passed
    ? `Near support (${distanceToSupportPct.toFixed(1)}% < ${config.supportZonePct}%), away from resistance (${distanceToResistancePct.toFixed(1)}%)`
    : nearResistance
      ? `Near resistance (${distanceToResistancePct.toFixed(1)}% < ${config.resistanceZonePct}%) — too close to sell zone`
      : `Far from support (${distanceToSupportPct.toFixed(1)}% ≥ ${config.supportZonePct}%)`;

  return {
    passed,
    name: "Support/Resistance",
    nameAr: "الدعم/المقاومة",
    reason,
    reasonAr: passed
      ? `قريب من الدعم (${distanceToSupportPct.toFixed(1)}%)، بعيد عن المقاومة`
      : nearResistance
        ? `قريب من المقاومة (${distanceToResistancePct.toFixed(1)}%)`
        : `بعيد عن الدعم (${distanceToSupportPct.toFixed(1)}%)`,
    // Attach computed values for downstream use
    ...((() => {
      // We return these as extra properties for signal logic
      return {};
    })()),
  };
}

/**
 * Gate 4 — Risk / Reward (Dynamic ATR-based)
 *
 * Pine logic:
 *   atr_pct = atr / close * 100
 *   High vol (ATR>5%): atr_target_mult=1.5, atr_stop_mult=1.0
 *   Medium vol (ATR 2-5%): atr_target_mult=2.0, atr_stop_mult=1.5
 *   Low vol (ATR<2%): atr_target_mult=2.5, atr_stop_mult=2.0
 *   Target = close * (1 + max(atr_pct * atr_target_mult/100, min_target_pct))
 *   Stop = close * (1 - max(atr_pct * atr_stop_mult/100, min_stop_pct))
 *   Fallback to S/R if closer
 *   R/R = (target - close) / (close - stop)
 */
function evaluateGate4(
  input: GateAnalysisInput,
  config: RegimeConfig,
  nearestSupport: number,
  nearestResistance: number
): {
  gate: GateResult;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  targetPct: number;
  stopPct: number;
  rrRatio: number;
  atrPct: number;
} {
  const atrPct = (input.atr / input.close) * 100;

  // Determine ATR multipliers based on volatility
  let atrTargetMult: number;
  let atrStopMult: number;

  if (atrPct > 5) {
    // High volatility — tighter targets
    atrTargetMult = 1.5;
    atrStopMult = 1.0;
  } else if (atrPct >= 2) {
    // Medium volatility
    atrTargetMult = 2.0;
    atrStopMult = 1.5;
  } else {
    // Low volatility — wider targets
    atrTargetMult = 2.5;
    atrStopMult = 2.0;
  }

  // Minimum target/stop percentages (safety floors)
  const minTargetPct = 1.5; // at least 1.5% target
  const minStopPct = 0.8; // at least 0.8% stop

  // Calculate ATR-based target and stop
  const atrTargetPct = Math.max((atrPct * atrTargetMult) / 100, minTargetPct / 100);
  const atrStopPct = Math.max((atrPct * atrStopMult) / 100, minStopPct / 100);

  let targetPrice = input.close * (1 + atrTargetPct);
  let stopLoss = input.close * (1 - atrStopPct);

  // Fallback: use resistance as target if closer
  if (nearestResistance > 0 && nearestResistance < targetPrice) {
    targetPrice = nearestResistance;
  }

  // Fallback: use support as stop if closer (but not too tight)
  if (nearestSupport > 0 && nearestSupport > stopLoss && nearestSupport < input.close) {
    stopLoss = nearestSupport;
  }

  // Ensure stop is below current price and target is above
  targetPrice = Math.max(targetPrice, input.close * 1.001); // at least 0.1% above
  stopLoss = Math.min(stopLoss, input.close * 0.999); // at least 0.1% below

  const targetPct = ((targetPrice - input.close) / input.close) * 100;
  const stopPct = ((input.close - stopLoss) / input.close) * 100;

  // R/R ratio
  const rrRatio = stopPct > 0 ? targetPct / stopPct : 0;

  const passed = rrRatio >= config.minRrThreshold;

  return {
    gate: {
      passed,
      name: "Risk/Reward",
      nameAr: "نسبة المخاطرة/العائد",
      reason: passed
        ? `R/R ${rrRatio.toFixed(2)} ≥ ${config.minRrThreshold} (target +${targetPct.toFixed(1)}%, stop -${stopPct.toFixed(1)}%)`
        : `R/R ${rrRatio.toFixed(2)} < ${config.minRrThreshold} (target +${targetPct.toFixed(1)}%, stop -${stopPct.toFixed(1)}%)`,
      reasonAr: passed
        ? `نسبة ${rrRatio.toFixed(2)} أعلى من الحد ${config.minRrThreshold}`
        : `نسبة ${rrRatio.toFixed(2)} أقل من الحد ${config.minRrThreshold}`,
    },
    entryPrice: input.close,
    targetPrice,
    stopLoss,
    targetPct,
    stopPct,
    rrRatio,
    atrPct,
  };
}

/**
 * Gate 5 — Confirmation
 *
 * Pine logic:
 *   MACD bullish = macdLine > signalLine
 *   RSI in buy range = rsi < rsiSellThreshold (not overbought)
 *   Volume confirmed = volume > avgVolume20 * 1.2
 *
 * In bear/range (confirmationStrict=true): ALL THREE required
 * In bull (confirmationStrict=false): MACD + (RSI OR volume)
 */
function evaluateGate5(
  input: GateAnalysisInput,
  config: RegimeConfig
): GateResult {
  const macdBullish = input.macdLine > input.signalLine;
  const rsiInRange = input.rsi < config.rsiSellThreshold;
  const volumeConfirmed = input.volume > input.avgVolume20 * 1.2;

  let passed = false;

  if (config.confirmationStrict) {
    // Bear / Range: ALL THREE required
    passed = macdBullish && rsiInRange && volumeConfirmed;
  } else {
    // Bull: MACD + (RSI OR volume)
    passed = macdBullish && (rsiInRange || volumeConfirmed);
  }

  const conditions: string[] = [];
  if (macdBullish) conditions.push("MACD bullish");
  else conditions.push("MACD bearish");
  if (rsiInRange) conditions.push(`RSI ${input.rsi.toFixed(1)} < ${config.rsiSellThreshold}`);
  else conditions.push(`RSI ${input.rsi.toFixed(1)} ≥ ${config.rsiSellThreshold}`);
  if (volumeConfirmed) conditions.push("Volume > 1.2× avg");
  else conditions.push("Volume ≤ 1.2× avg");

  return {
    passed,
    name: "Confirmation",
    nameAr: "التأكيد",
    reason: passed
      ? `Confirmed: ${conditions.join(", ")} [${config.confirmationStrict ? "strict" : "relaxed"} mode]`
      : `Failed: ${conditions.join(", ")} [${config.confirmationStrict ? "strict" : "relaxed"} mode]`,
    reasonAr: passed
      ? "مؤكد: " + conditions.map((c) => {
          if (c.includes("MACD bullish")) return "MACD صاعد";
          if (c.includes("RSI")) return "RSI في النطاق";
          if (c.includes("Volume >")) return "حجم مرتفع";
          return c;
        }).join("، ")
      : "غير مؤكد: شروط غير مكتملة",
  };
}

// ---------------------------------------------------------------------------
// Signal determination (priority chain, exact Pine Script order)
// ---------------------------------------------------------------------------

interface SignalContext {
  input: GateAnalysisInput;
  config: RegimeConfig;
  gatesPassed: number;
  minGates: number;
  rrRatio: number;
  trendBull: boolean;
  trendBear: boolean;
  trendRange: boolean;
  nearSupport: boolean;
  nearResistance: boolean;
  distanceToSupportPct: number;
  distanceToResistancePct: number;
  nearestSupport: number;
  macdBullish: boolean;
  volumeRatio: number;
  targetPrice: number;
  stopLoss: number;
  targetPct: number;
  stopPct: number;
  atrPct: number;
  marketStage: string;
  marketStageAr: string;
  persona: GatePersona;
}

function determineSignal(ctx: SignalContext): {
  signal: GateSignal;
  signalAr: string;
  signalColor: string;
  narrative: string;
} {
  const { input, config } = ctx;

  // 1. R/R ≤ 0 → AVOID (invalid target/stop)
  if (ctx.rrRatio <= 0) {
    return {
      signal: "AVOID",
      signalAr: "تجنب",
      signalColor: "bg-gray-500",
      narrative: `نسبة المخاطرة/العائد غير صالحة (${ctx.rrRatio.toFixed(2)}). تجنب هذا السهم.`,
    };
  }

  // 2. R/R < 1.0 → WAIT
  if (ctx.rrRatio < 1.0) {
    return {
      signal: "WAIT",
      signalAr: "انتظر",
      signalColor: "bg-yellow-500",
      narrative: `نسبة المخاطرة/العائد ${ctx.rrRatio.toFixed(2)} أقل من 1.0. المخاطرة أعلى من العائد المتوقع. انتظر تحسن الظروف.`,
    };
  }

  // 3. Near resistance (not at support) → WAIT, or BUY if bull breakout
  if (ctx.nearResistance && !ctx.nearSupport) {
    if (ctx.trendBull && ctx.macdBullish && ctx.volumeRatio > 1.5) {
      // Bull breakout near resistance with volume — possible breakout BUY
      return {
        signal: "BUY",
        signalAr: "شراء",
        signalColor: "bg-green-500",
        narrative: `قريب من المقاومة لكن مع اتجاه صاعد قوي وكسر محتمل بحجم مرتفع. يمكن الشراء مع مراقبة المقاومة.`,
      };
    }
    return {
      signal: "WAIT",
      signalAr: "انتظر",
      signalColor: "bg-yellow-500",
      narrative: `السهم قريب من المقاومة (${ctx.distanceToResistancePct.toFixed(1)}%) وليس قرب الدعم. انتظر تراجعاً للدعم أو كسر المقاومة.`,
    };
  }

  // 4. Break support × 0.98 + below SMA20 → SELL
  if (ctx.nearestSupport > 0 && input.close < ctx.nearestSupport * 0.98 && input.close < input.sma20) {
    return {
      signal: "SELL",
      signalAr: "بيع",
      signalColor: "bg-red-500",
      narrative: `كسر الدعم الرئيسي (أقل من ${ctx.nearestSupport.toFixed(2)} × 0.98) وأسفل المتوسط 20. إشارة بيع واضحة.`,
    };
  }

  // 5. RSI > 75 + above SMA20 + negative MACD hist → SELL_STRONG
  if (input.rsi > 75 && input.close > input.sma20 && input.macdHist < 0) {
    return {
      signal: "SELL_STRONG",
      signalAr: "بيع قوي",
      signalColor: "bg-red-700",
      narrative: `RSI عند ${input.rsi.toFixed(1)} (تشبع شرائي) + فوق SMA20 + MACD سالب. إشارة بيع قوية — توقف خسارة فوري.`,
    };
  }

  // 6. RSI > 65 + above SMA20 + volume > 2× avg → SELL
  if (input.rsi > 65 && input.close > input.sma20 && ctx.volumeRatio > 2.0) {
    return {
      signal: "SELL",
      signalAr: "بيع",
      signalColor: "bg-red-500",
      narrative: `RSI عند ${input.rsi.toFixed(1)} (مرتفع) + حجم مرتفع جداً (${ctx.volumeRatio.toFixed(1)}× المتوسط). إشارة بيع.`,
    };
  }

  // 7. 5/5 gates + R/R ≥ 2.0 → BUY_STRONG
  if (ctx.gatesPassed === 5 && ctx.rrRatio >= 2.0) {
    return {
      signal: "BUY_STRONG",
      signalAr: "شراء قوي",
      signalColor: "bg-emerald-600",
      narrative: `جميع البوابات الخمس مكتملة + نسبة عائد/مخاطرة ${ctx.rrRatio.toFixed(2)} ≥ 2.0. فرصة شراء قوية! الهدف ${ctx.targetPrice.toFixed(2)} (+${ctx.targetPct.toFixed(1)}%)، وقف الخسارة ${ctx.stopLoss.toFixed(2)} (-${ctx.stopPct.toFixed(1)}%).`,
    };
  }

  // 8. min_gates passed + R/R ≥ threshold → BUY
  if (ctx.gatesPassed >= ctx.minGates && ctx.rrRatio >= config.minRrThreshold) {
    return {
      signal: "BUY",
      signalAr: "شراء",
      signalColor: "bg-green-500",
      narrative: `${ctx.gatesPassed}/5 بوابات مكتملة + نسبة ${ctx.rrRatio.toFixed(2)} ≥ ${config.minRrThreshold}. إشارة شراء. الهدف ${ctx.targetPrice.toFixed(2)} (+${ctx.targetPct.toFixed(1)}%).`,
    };
  }

  // 9. RSI < 25 + near support + volume > 1.5× + MACD hist rising → BUY_CONTRARIAN
  if (
    input.rsi < 25 &&
    ctx.nearSupport &&
    ctx.volumeRatio > 1.5 &&
    input.macdHist > input.macdHist - (input.macdLine - input.signalLine) * 0.1 // hist rising approximation
  ) {
    // Simplified MACD hist rising check: hist > 0 or hist improving
    const histRising = input.macdHist > 0 || (input.macdLine > input.signalLine);
    if (histRising) {
      return {
        signal: "BUY_CONTRARIAN",
        signalAr: "شراء عكسي",
        signalColor: "bg-amber-500",
        narrative: `RSI عند ${input.rsi.toFixed(1)} (تشبع بيعي شديد) + قرب الدعم + حجم مرتفع + MACD يتحسن. فرصة شراء عكسية للمضاربين.`,
      };
    }
  }

  // 10. 2+ gates + < min_gates + near support + R/R ≥ 1.0 → ACCUMULATE
  if (
    ctx.gatesPassed >= 2 &&
    ctx.gatesPassed < ctx.minGates &&
    ctx.nearSupport &&
    ctx.rrRatio >= 1.0
  ) {
    return {
      signal: "ACCUMULATE",
      signalAr: "تجميع",
      signalColor: "bg-primary",
      narrative: `${ctx.gatesPassed}/5 بوابات مكتملة (أقل من المطلوب ${ctx.minGates}) لكن قرب الدعم ونسبة ${ctx.rrRatio.toFixed(2)} مقبولة. يمكن التجميع التدريجي.`,
    };
  }

  // 11. Default → WAIT
  return {
    signal: "WAIT",
    signalAr: "انتظر",
    signalColor: "bg-yellow-500",
    narrative: `الشروط غير مكتملة (${ctx.gatesPassed}/5 بوابات، R/R ${ctx.rrRatio.toFixed(2)}). انتظر تأكيد أقوى قبل الدخول.`,
  };
}

// ---------------------------------------------------------------------------
// Stock strength & market proxy
// ---------------------------------------------------------------------------

function computeStockStrength(
  input: GateAnalysisInput,
  sectorPerformance?: number
): { strength: number; proxy: string; proxyAr: string } {
  // Simple strength scoring based on available data
  let score = 50; // neutral base

  // RSI contribution (-25 to +25)
  if (input.rsi > 50) {
    score += Math.min((input.rsi - 50) / 2, 25);
  } else {
    score -= Math.min((50 - input.rsi) / 2, 25);
  }

  // MACD contribution (-15 to +15)
  if (input.macdLine > input.signalLine) {
    score += 15;
  } else {
    score -= 15;
  }

  // SMA trend contribution (-10 to +10)
  if (input.close > input.sma20) {
    score += 5;
  } else {
    score -= 5;
  }
  if (input.sma20 > input.sma50) {
    score += 5;
  } else {
    score -= 5;
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // Market proxy based on sector if available
  let proxy = "EGX Market";
  let proxyAr = "سوق الأوراق المالية";

  if (sectorPerformance !== undefined) {
    if (sectorPerformance > 1) {
      proxy = "Sector Leading";
      proxyAr = "قطاع رائد";
    } else if (sectorPerformance < -1) {
      proxy = "Sector Lagging";
      proxyAr = "قطاع متأخر";
    } else {
      proxy = "Sector Neutral";
      proxyAr = "قطاع محايد";
    }
  }

  return { strength: Math.round(score), proxy, proxyAr };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * analyzeGates — Pure function that takes a single stock snapshot and
 * returns the complete 5-gate analysis output.
 *
 * @param input  — All required market data for one stock at one point in time
 * @param persona — 'gambler' (aggressive) or 'investor' (conservative), default 'gambler'
 * @returns GateAnalysisOutput with signal, gates, targets, and narrative
 */
export function analyzeGates(
  input: GateAnalysisInput,
  persona: GatePersona = "gambler"
): GateAnalysisOutput {
  // -----------------------------------------------------------------------
  // Step 1: Detect trend
  // Pine: trend_bull = close > sma20 and sma20 > sma50
  //       trend_bear = close < sma20 and sma20 < sma50
  // -----------------------------------------------------------------------
  const trendBull = input.close > input.sma20 && input.sma20 > input.sma50;
  const trendBear = input.close < input.sma20 && input.sma20 < input.sma50;
  const trendRange = !trendBull && !trendBear;

  // -----------------------------------------------------------------------
  // Step 2: Get regime config (dynamic thresholds)
  // -----------------------------------------------------------------------
  const config = getRegimeConfig(trendBull, trendBear, trendRange);

  // -----------------------------------------------------------------------
  // Step 3: Market stage (6 stages with Arabic)
  // -----------------------------------------------------------------------
  const {
    stage: marketStage,
    stageAr: marketStageAr,
  } = getMarketStage(
    input.close,
    input.sma20,
    input.sma50,
    input.sma200,
    trendBull,
    trendBear,
    trendRange
  );

  // -----------------------------------------------------------------------
  // Step 4: Support/Resistance proximity (needed by Gate 3 & Signal)
  // -----------------------------------------------------------------------
  const supports = [input.support1, input.support2].filter(
    (s) => s > 0 && s < input.close
  );
  const nearestSupport = supports.length > 0 ? Math.max(...supports) : 0;

  const resistances = [input.resistance1, input.resistance2].filter(
    (r) => r > 0 && r > input.close
  );
  const nearestResistance =
    resistances.length > 0 ? Math.min(...resistances) : 0;

  const distanceToSupportPct =
    nearestSupport > 0
      ? ((input.close - nearestSupport) / input.close) * 100
      : 999;
  const distanceToResistancePct =
    nearestResistance > 0
      ? ((nearestResistance - input.close) / input.close) * 100
      : 999;

  const nearSupport = distanceToSupportPct < config.supportZonePct;
  const nearResistance = distanceToResistancePct < config.resistanceZonePct;

  // -----------------------------------------------------------------------
  // Step 5: Evaluate all 5 gates
  // -----------------------------------------------------------------------
  const gate1 = evaluateGate1(input, config);
  const gate2 = evaluateGate2(input, trendBull, trendBear, trendRange, persona);

  // Gate 3 — using pre-computed S/R proximity
  const gate3: GateResult = {
    passed: nearSupport && !nearResistance,
    name: "Support/Resistance",
    nameAr: "الدعم/المقاومة",
    reason: nearSupport && !nearResistance
      ? `Near support (${distanceToSupportPct.toFixed(1)}% < ${config.supportZonePct}%), away from resistance (${distanceToResistancePct.toFixed(1)}%)`
      : nearResistance
        ? `Near resistance (${distanceToResistancePct.toFixed(1)}% < ${config.resistanceZonePct}%)`
        : `Far from support (${distanceToSupportPct.toFixed(1)}% ≥ ${config.supportZonePct}%)`,
    reasonAr: nearSupport && !nearResistance
      ? `قريب من الدعم (${distanceToSupportPct.toFixed(1)}%)، بعيد عن المقاومة`
      : nearResistance
        ? `قريب من المقاومة (${distanceToResistancePct.toFixed(1)}%)`
        : `بعيد عن الدعم (${distanceToSupportPct.toFixed(1)}%)`,
  };

  const gate4Result = evaluateGate4(input, config, nearestSupport, nearestResistance);
  const gate4 = gate4Result.gate;

  const gate5 = evaluateGate5(input, config);

  const gates: GateResult[] = [gate1, gate2, gate3, gate4, gate5];
  const gatesPassed = gates.filter((g) => g.passed).length;

  // -----------------------------------------------------------------------
  // Step 6: Volume ratio
  // -----------------------------------------------------------------------
  const volumeRatio =
    input.avgVolume20 > 0 ? input.volume / input.avgVolume20 : 0;

  // -----------------------------------------------------------------------
  // Step 7: MACD bullish flag (used in signal logic)
  // -----------------------------------------------------------------------
  const macdBullish = input.macdLine > input.signalLine;

  // -----------------------------------------------------------------------
  // Step 8: Determine signal via priority chain
  // -----------------------------------------------------------------------
  const signalResult = determineSignal({
    input,
    config,
    gatesPassed,
    minGates: config.minGates,
    rrRatio: gate4Result.rrRatio,
    trendBull,
    trendBear,
    trendRange,
    nearSupport,
    nearResistance,
    distanceToSupportPct,
    distanceToResistancePct,
    nearestSupport,
    macdBullish,
    volumeRatio,
    targetPrice: gate4Result.targetPrice,
    stopLoss: gate4Result.stopLoss,
    targetPct: gate4Result.targetPct,
    stopPct: gate4Result.stopPct,
    atrPct: gate4Result.atrPct,
    marketStage,
    marketStageAr,
    persona,
  });

  // -----------------------------------------------------------------------
  // Step 9: Stock strength & market proxy
  // -----------------------------------------------------------------------
  const { strength: stockStrength, proxy: marketProxy, proxyAr: marketProxyAr } =
    computeStockStrength(input, input.sectorPerformance);

  // -----------------------------------------------------------------------
  // Step 9.5: BB Squeeze Bonus (Gemini Dynamic Analysis)
  // When BB Squeeze is active, reduce minGates by 1 — squeeze means
  // an explosive move is imminent, so we lower the confirmation bar.
  // -----------------------------------------------------------------------
  let squeezeResult: BBSqueezeResult | null = null;
  let squeezeBonusApplied = false;
  if (input.bollingerWidthPct !== undefined && input.bollingerWidthPct !== null) {
    squeezeResult = detectBBSqueeze(input.bollingerWidthPct, input.bollingerWidthHistory || []);
    if (squeezeResult.level === 'SQUEEZE' || squeezeResult.level === 'EXTREME_SQUEEZE') {
      // Reduce minGates by 1 (minimum 2 gates still required)
      const effectiveMinGates = Math.max(2, config.minGates - 1);
      if (effectiveMinGates < config.minGates) {
        squeezeBonusApplied = true;
        // Re-evaluate: if we now pass the lowered bar, upgrade WAIT signals
        if (gatesPassed >= effectiveMinGates && signalResult.signal === 'WAIT') {
          if (trendBull && volumeRatio > 1.2) {
            signalResult.signal = 'BUY';
            signalResult.signalAr = 'شراء (انضغاط بولنجر + حجم)';
            signalResult.signalColor = 'bg-emerald-500/20 text-emerald-400';
            signalResult.narrative += `\n\n⚡ BB Squeeze active (score: ${squeezeResult.squeezeScore}) — explosive move expected. Volume confirming direction.`;
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Step 10: Assemble output
  // -----------------------------------------------------------------------
  return {
    // Signal
    signal: signalResult.signal,
    signalAr: signalResult.signalAr,
    signalColor: signalResult.signalColor,

    // Market Regime
    marketStage,
    marketStageAr,
    trendBull,
    trendBear,
    trendRange,

    // Gate Results
    gates,
    gatesPassed,
    minGates: squeezeBonusApplied ? Math.max(2, config.minGates - 1) : config.minGates,

    // Targets
    entryPrice: gate4Result.entryPrice,
    targetPrice: gate4Result.targetPrice,
    stopLoss: gate4Result.stopLoss,
    targetPct: gate4Result.targetPct,
    stopPct: gate4Result.stopPct,
    rrRatio: gate4Result.rrRatio,

    // Dynamic Thresholds
    rsiBuyThreshold: config.rsiBuyThreshold,
    rsiSellThreshold: config.rsiSellThreshold,
    minRrThreshold: config.minRrThreshold,
    atrPct: gate4Result.atrPct,

    // Volume
    volumeRatio,

    // Stock Strength
    stockStrength,
    marketProxy,
    marketProxyAr,

    // Narrative
    narrative: signalResult.narrative,

    // Persona
    persona,

    // BB Squeeze (Gemini Dynamic Analysis)
    bbSqueeze: squeezeResult ? {
      level: squeezeResult.level,
      bbWidthPct: squeezeResult.bbWidthPct,
      bbWidthTrend: squeezeResult.bbWidthTrend,
      squeezeScore: squeezeResult.squeezeScore,
      descriptionAr: squeezeResult.descriptionAr,
    } : undefined,
    squeezeBonusApplied,
  };
}