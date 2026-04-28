/**
 * V2 Quality Engine — Layer 2: 5-Factor Weighted Scoring System
 *
 * Total = Profitability × W1 + Growth × W2 + Safety × W3 + Efficiency × W4 + Valuation × W5
 *
 * All scores clamped 0-100, rounded to integers.
 * Arabic details provided for each factor.
 */

import type {
  QualityScore,
  ProfitabilityScore,
  GrowthScore,
  FinancialSafetyScore,
  EfficiencyScore,
  ValuationScore,
} from './types';
import { getWeight, getSectorAverage } from './config-service';

// ==================== HELPERS ====================

/** Safely convert unknown to number with fallback */
function toNum(v: unknown, fallback: number = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp a number between min and max */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Round to integer and clamp 0-100 */
function score(val: number): number {
  return clamp(Math.round(val), 0, 100);
}

/**
 * Calculate CAGR from price history.
 * Uses the first and last close prices over `days` lookback.
 * Returns annualized growth rate as decimal (e.g. 0.15 for 15%).
 */
function calcCAGR(history: Array<Record<string, unknown>>, days: number): number {
  if (history.length < 2) return 0;
  const slice = history.slice(-days);
  if (slice.length < 2) return 0;

  const startPrice = toNum(slice[0].close_price, 0);
  const endPrice = toNum(slice[slice.length - 1].close_price, 0);
  if (startPrice <= 0 || endPrice <= 0) return 0;

  // Approximate years from trading days
  const years = Math.max(slice.length / 252, 0.01);
  const cagr = Math.pow(endPrice / startPrice, 1 / years) - 1;
  return Number.isFinite(cagr) ? cagr : 0;
}

/**
 * Calculate simple return over N recent days.
 */
function calcReturn(history: Array<Record<string, unknown>>, days: number): number {
  if (history.length < days + 1) return 0;
  const idx = history.length - 1 - days;
  if (idx < 0) return 0;

  const startPrice = toNum(history[idx].close_price, 0);
  const endPrice = toNum(history[history.length - 1].close_price, 0);
  if (startPrice <= 0) return 0;

  return (endPrice - startPrice) / startPrice;
}

/**
 * Coefficient of variation of close prices over last N points.
 */
function coefficientOfVariation(history: Array<Record<string, unknown>>, days: number): number {
  const slice = history.slice(-days);
  if (slice.length < 2) return 1;

  const closes = slice.map(d => toNum(d.close_price, 0)).filter(p => p > 0);
  if (closes.length < 2) return 1;

  const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
  if (mean === 0) return 1;

  const variance = closes.reduce((s, v) => s + (v - mean) ** 2, 0) / closes.length;
  const stdDev = Math.sqrt(variance);

  return stdDev / mean;
}

/**
 * Estimate market cap percentile using log scale.
 * EGX market caps range ~0.4B to ~1000B EGP.
 * Uses log10 mapping to approximate percentile within sector.
 */
function estimateMarketCapPercentile(marketCap: number): number {
  if (marketCap <= 0) return 0;
  // Log10 scale: 8.5 (400M) → 0%, 11.0 (1T) → 100%
  const logMc = Math.log10(marketCap);
  const minLog = 8.5;
  const maxLog = 11.0;
  const pct = ((logMc - minLog) / (maxLog - minLog)) * 100;
  return clamp(pct, 0, 100);
}

/**
 * Percentage of positive days in last N data points.
 */
function positiveDayPercent(history: Array<Record<string, unknown>>, days: number): number {
  const slice = history.slice(-days);
  if (slice.length < 2) return 50;

  let positive = 0;
  for (let i = 1; i < slice.length; i++) {
    const prev = toNum(slice[i - 1].close_price, 0);
    const curr = toNum(slice[i].close_price, 0);
    if (curr > prev) positive++;
  }

  return (positive / (slice.length - 1)) * 100;
}

// ==================== FACTOR 1: PROFITABILITY ====================

function calculateProfitability(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
): ProfitabilityScore {
  const sector = String(stock.sector || '');
  const sectorAvg = getSectorAverage(sector);

  const roe = toNum(stock.roe, 0); // percentage
  const debtToEquity = toNum(stock.debt_to_equity, 1);
  const cagr = calcCAGR(priceHistory, Math.min(priceHistory.length, 252));

  // --- ROE vs Sector Average ---
  let roePoints = 0;
  if (roe > sectorAvg.avgROE * 1.3) {
    roePoints = 40;
  } else if (roe > sectorAvg.avgROE * 1.1) {
    roePoints = 25;
  } else if (roe > sectorAvg.avgROE * 0.9) {
    roePoints = 15;
  } else if (roe > 0) {
    roePoints = 10;
  } else {
    roePoints = 0;
  }

  // --- Net Margin Proxy (ROE + Debt) ---
  let marginPoints = 0;
  if (roe > 20 && debtToEquity < 0.5) {
    marginPoints = 30;
  } else if (roe > 15) {
    marginPoints = 20;
  } else if (roe > 10) {
    marginPoints = 15;
  } else {
    marginPoints = 5;
  }

  // --- EPS Growth Proxy (Price CAGR) ---
  let epsGrowthPoints = 0;
  if (cagr > 0.15) {
    epsGrowthPoints = 30;
  } else if (cagr > 0.05) {
    epsGrowthPoints = 15;
  } else {
    epsGrowthPoints = 5;
  }

  const total = roePoints + marginPoints + epsGrowthPoints;

  // Arabic details
  const details = buildArabicDetails([
    {
      label: `العائد على حقوق المساهمين ${roe.toFixed(1)}% مقابل متوسط القطاع ${sectorAvg.avgROE.toFixed(1)}%`,
      points: roePoints,
      max: 40,
    },
    {
      label: `هامش صافي الربح (وكيل) - العائد ${roe.toFixed(1)}% والمديونية ${debtToEquity.toFixed(2)}`,
      points: marginPoints,
      max: 30,
    },
    {
      label: `نمو الأرباح (وكيل بمعدل نمو السعر) ${((cagr) * 100).toFixed(1)}%`,
      points: epsGrowthPoints,
      max: 30,
    },
  ]);

  return {
    score: score(total),
    roeVsSector: score(roePoints),
    netMarginVsSector: score(marginPoints),
    epsGrowthYoY: score(epsGrowthPoints),
    details,
  };
}

// ==================== FACTOR 2: GROWTH ====================

function calculateGrowth(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
): GrowthScore {
  // --- Revenue/Earnings CAGR Proxy ---
  let cagrPoints = 0;
  let cagrValue = 0;

  if (priceHistory.length > 60) {
    // Compute 3-year price CAGR (using last 756 trading days ≈ 3 years)
    cagrValue = calcCAGR(priceHistory, Math.min(priceHistory.length, 756));

    if (cagrValue > 0.15) {
      cagrPoints = 40;
    } else if (cagrValue > 0.10) {
      cagrPoints = 25;
    } else if (cagrValue > 0) {
      cagrPoints = 15;
    } else {
      cagrPoints = 5;
    }
  } else {
    // Not enough data — use what's available
    cagrValue = calcCAGR(priceHistory, priceHistory.length);
    if (cagrValue > 0) {
      cagrPoints = 10;
    } else {
      cagrPoints = 5;
    }
  }

  // --- Trend Acceleration (20-day vs 60-day) ---
  let accelPoints = 0;
  const return20 = calcReturn(priceHistory, 20);
  const return60 = calcReturn(priceHistory, 60);

  if (return20 > return60 + 0.02) {
    accelPoints = 25; // Accelerating
  } else if (Math.abs(return20 - return60) <= 0.02) {
    accelPoints = 15; // Steady
  } else {
    accelPoints = 5; // Decelerating
  }

  // --- Earnings Yield Proxy (inverse P/E as real yield) ---
  let yieldPoints = 0;
  const peRatio = toNum(stock.pe_ratio, 0);
  if (peRatio > 0 && peRatio < 100) {
    const earningsYield = 1 / peRatio * 100; // e.g. P/E=10 → 10% yield
    if (earningsYield > 10) {
      yieldPoints = 35; // Very high yield (cheap stock)
    } else if (earningsYield > 6) {
      yieldPoints = 25;
    } else if (earningsYield > 3) {
    yieldPoints = 15;
  } else {
    yieldPoints = 5;
  }
  }

  const total = cagrPoints + accelPoints + yieldPoints;

  const accelLabel = accelPoints >= 25 ? 'متسارع' : accelPoints === 15 ? 'مستقر' : 'متباطئ';
  const yieldLabel = yieldPoints >= 25 ? 'عائد أرباح مرتفع' : yieldPoints >= 15 ? 'عائد أرباح معقول' : yieldPoints <= 5 ? 'عائد أرباح منخفض' : 'بيانات غير كافية';

  const details = buildArabicDetails([
    {
      label: `معدل النمو المركب (وكيل) ${((cagrValue) * 100).toFixed(1)}% — ${priceHistory.length > 60 ? '3 سنوات' : 'بيانات محدودة'}`,
      points: cagrPoints,
      max: 40,
    },
    {
      label: `تسارع الاتجاه (20 يوم ${((return20) * 100).toFixed(1)}% مقابل 60 يوم ${((return60) * 100).toFixed(1)}%) — ${accelLabel}`,
      points: accelPoints,
      max: 25,
    },
    {
      label: `عائد الأرباح الفعلي (1/P/E = ${peRatio > 0 ? (100 / peRatio).toFixed(1) : 'N/A'}%) — ${yieldLabel}`,
      points: yieldPoints,
      max: 35,
    },
  ]);

  return {
    score: score(total),
    revenueCAGR: score(cagrPoints),
    earningsCAGR: score(accelPoints),
    details,
  };
}

// ==================== FACTOR 3: FINANCIAL SAFETY ====================

function calculateSafety(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
): FinancialSafetyScore {
  const debtToEquity = toNum(stock.debt_to_equity, 1);
  const marketCap = toNum(stock.market_cap, 0);
  const eps = toNum(stock.eps, 0);
  const roe = toNum(stock.roe, 0);

  // --- Debt/Equity ---
  let dePoints = 0;
  if (debtToEquity < 0.3) {
    dePoints = 25;
  } else if (debtToEquity < 0.7) {
    dePoints = 20;
  } else if (debtToEquity < 1.0) {
    dePoints = 12;
  } else if (debtToEquity < 1.5) {
    dePoints = 5;
  } else {
    dePoints = 0;
  }

  // --- Current Ratio Proxy (market_cap / debt) ---
  let currentRatioPoints = 0;
  // Estimate debt from market_cap * debt_to_equity / (1 + debt_to_equity) ≈ equity * D/E
  // If market cap is large relative to estimated debt burden
  const estimatedEquity = debtToEquity > 0 ? marketCap / (1 + debtToEquity) : marketCap;
  const estimatedDebt = marketCap - estimatedEquity;

  if (estimatedEquity > 0 && estimatedDebt < estimatedEquity * 0.5 && marketCap > 5e9) {
    currentRatioPoints = 30;
  } else {
    currentRatioPoints = 10;
  }

  // --- FCF Proxy (positive earnings with low debt) ---
  let fcfPoints = 0;
  if (eps > 0 && debtToEquity < 0.8) {
    fcfPoints = 20;
  } else if (eps > 0) {
    fcfPoints = 10;
  } else {
    fcfPoints = 0;
  }

  // --- Interest Coverage Proxy (ROE / D/E) ---
  let coveragePoints = 0;
  if (debtToEquity > 0) {
    const coverage = roe / debtToEquity;
    if (coverage > 20) {
      coveragePoints = 25;
    } else {
      coveragePoints = 5;
    }
  } else {
    // No debt → strong coverage
    coveragePoints = 25;
  }

  const total = dePoints + currentRatioPoints + fcfPoints + coveragePoints;

  const details = buildArabicDetails([
    {
      label: `نسبة المديونية إلى حقوق المساهمين ${debtToEquity.toFixed(2)}`,
      points: dePoints,
      max: 25,
    },
    {
      label: `نسبة السيولة (وكيل) — رأس مال سوقي ${formatEGP(marketCap)}`,
      points: currentRatioPoints,
      max: 30,
    },
    {
      label: `التدفق النقدي (وكيل) — ربحية السهم ${eps.toFixed(2)}`,
      points: fcfPoints,
      max: 20,
    },
    {
      label: `تغطية الفوائد (وكيل) — العائد على حقوق المساهمين ${roe.toFixed(1)}% مقابل المديونية`,
      points: coveragePoints,
      max: 25,
    },
  ]);

  return {
    score: score(total),
    currentRatio: score(currentRatioPoints),
    interestCoverage: score(coveragePoints),
    debtEquity: score(dePoints),
    fcfPositive: score(fcfPoints),
    details,
  };
}

// ==================== FACTOR 4: EFFICIENCY ====================

function calculateEfficiency(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
): EfficiencyScore {
  const marketCap = toNum(stock.market_cap, 0);

  // --- Market Cap Rank (percentile) → 0-50 pts ---
  const marketCapPercentile = estimateMarketCapPercentile(marketCap);
  const marketCapPoints = clamp((marketCapPercentile / 100) * 50, 0, 50);

  // --- Price Stability (inverse of CV) → 0-30 pts ---
  const cv = coefficientOfVariation(priceHistory, 20);
  // Lower CV = more stable = higher score
  // CV < 0.02 → 30, CV < 0.05 → 20, CV < 0.10 → 10, else → 0
  let stabilityPoints = 0;
  if (cv < 0.02) {
    stabilityPoints = 30;
  } else if (cv < 0.05) {
    stabilityPoints = 20;
  } else if (cv < 0.10) {
    stabilityPoints = 10;
  } else {
    stabilityPoints = 0;
  }

  // --- Trading Consistency (% positive days) → 0-20 pts ---
  const posPct = positiveDayPercent(priceHistory, 20);
  // > 60% → 20, > 50% → 15, > 40% → 10, else → 5
  let consistencyPoints = 0;
  if (posPct > 60) {
    consistencyPoints = 20;
  } else if (posPct > 50) {
    consistencyPoints = 15;
  } else if (posPct > 40) {
    consistencyPoints = 10;
  } else {
    consistencyPoints = 5;
  }

  const total = marketCapPoints + stabilityPoints + consistencyPoints;

  const details = buildArabicDetails([
    {
      label: `ترتيب القيمة السوقية (نسبة مئوية) ${marketCapPercentile.toFixed(0)}% — ${formatEGP(marketCap)}`,
      points: Math.round(marketCapPoints),
      max: 50,
    },
    {
      label: `استقرار السعر (معامل الاختلاف ${cv.toFixed(4)})`,
      points: stabilityPoints,
      max: 30,
    },
    {
      label: `اتساق التداول (${posPct.toFixed(0)}% أيام إيجابية من آخر 20 يوم)`,
      points: consistencyPoints,
      max: 20,
    },
  ]);

  return {
    score: score(total),
    assetTurnover: score(marketCapPercentile), // Store market cap percentile as turnover proxy
    details,
  };
}

// ==================== FACTOR 5: VALUATION ====================

function calculateValuation(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
): ValuationScore {
  const sector = String(stock.sector || '');
  const sectorAvg = getSectorAverage(sector);

  const peRatio = toNum(stock.pe_ratio, -1);
  const pbRatio = toNum(stock.pb_ratio, -1);
  const dividendYield = toNum(stock.dividend_yield, 0);

  // --- P/E vs Sector ---
  let pePoints = 0;
  if (peRatio <= 0 || !Number.isFinite(peRatio)) {
    pePoints = 0; // Negative or invalid P/E
  } else if (peRatio < sectorAvg.avgPE * 0.7) {
    pePoints = 40; // Cheap
  } else if (peRatio < sectorAvg.avgPE * 0.9) {
    pePoints = 25;
  } else if (peRatio < sectorAvg.avgPE * 1.2) {
    pePoints = 10;
  } else if (peRatio > sectorAvg.avgPE * 1.5) {
    pePoints = 0; // Expensive
  } else {
    // Between 1.2x and 1.5x — moderately expensive
    pePoints = 5;
  }

  // --- Price to Book ---
  let pbPoints = 0;
  if (pbRatio <= 0 || !Number.isFinite(pbRatio)) {
    pbPoints = 0;
  } else if (pbRatio < 1.0) {
    pbPoints = 30;
  } else if (pbRatio < 1.5) {
    pbPoints = 20;
  } else if (pbRatio < 2.5) {
    pbPoints = 10;
  } else {
    pbPoints = 0;
  }

  // --- Dividend Yield ---
  let divPoints = 0;
  if (dividendYield > 6) {
    divPoints = 30;
  } else if (dividendYield > 4) {
    divPoints = 20;
  } else if (dividendYield > 2) {
    divPoints = 10;
  } else {
    divPoints = 0;
  }

  const total = pePoints + pbPoints + divPoints;

  const details = buildArabicDetails([
    {
      label: `مكرر الربحية ${peRatio.toFixed(1)} مقابل متوسط القطاع ${sectorAvg.avgPE.toFixed(1)}`,
      points: pePoints,
      max: 40,
    },
    {
      label: `مكرر القيمة الدفترية ${pbRatio.toFixed(2)}`,
      points: pbPoints,
      max: 30,
    },
    {
      label: `عائد التوزيعات النقدية ${dividendYield.toFixed(2)}%`,
      points: divPoints,
      max: 30,
    },
  ]);

  return {
    score: score(total),
    peVsSector: score(pePoints),
    priceToBook: score(pbPoints),
    dividendYield: score(divPoints),
    details,
  };
}

// ==================== ARABIC DETAILS BUILDER ====================

interface DetailEntry {
  label: string;
  points: number;
  max: number;
}

function buildArabicDetails(entries: DetailEntry[]): string {
  return entries
    .map(e => `• ${e.label} — ${e.points}/${e.max} نقطة`)
    .join('\n');
}

// ==================== EGP FORMATTER ====================

function formatEGP(amount: number): string {
  if (amount >= 1e9) {
    return `${(amount / 1e9).toFixed(1)} مليار جنيه`;
  } else if (amount >= 1e6) {
    return `${(amount / 1e6).toFixed(1)} مليون جنيه`;
  } else if (amount >= 1e3) {
    return `${(amount / 1e3).toFixed(1)} ألف جنيه`;
  }
  return `${amount.toFixed(0)} جنيه`;
}

// ==================== MAIN EXPORT ====================

/**
 * Calculate the 5-factor Quality Score for a single stock.
 *
 * Total = Profitability × W1 + Growth × W2 + Safety × W3 + Efficiency × W4 + Valuation × W5
 *
 * @param stock        - Stock record from the database
 * @param priceHistory - Array of price history records (sorted by date ascending)
 * @returns QualityScore with all 5 factor scores and sub-scores
 */
export function calculateQualityScore(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
): QualityScore {
  // Load weights from config (with defaults)
  const w1 = getWeight('weight_profitability', 0.25);
  const w2 = getWeight('weight_growth', 0.20);
  const w3 = getWeight('weight_safety', 0.25);
  const w4 = getWeight('weight_efficiency', 0.15);
  const w5 = getWeight('weight_valuation', 0.15);

  // Ensure weights sum to ~1 (normalize if needed)
  const wSum = w1 + w2 + w3 + w4 + w5;
  const norm = wSum > 0 ? 1 / wSum : 1;

  // Calculate each factor
  const profitability = calculateProfitability(stock, priceHistory);
  const growth = calculateGrowth(stock, priceHistory);
  const safety = calculateSafety(stock, priceHistory);
  const efficiency = calculateEfficiency(stock, priceHistory);
  const valuation = calculateValuation(stock, priceHistory);

  // Weighted total
  const total =
    profitability.score * (w1 * norm) +
    growth.score * (w2 * norm) +
    safety.score * (w3 * norm) +
    efficiency.score * (w4 * norm) +
    valuation.score * (w5 * norm);

  return {
    total: score(total),
    profitability,
    growth,
    safety,
    efficiency,
    valuation,
  };
}
