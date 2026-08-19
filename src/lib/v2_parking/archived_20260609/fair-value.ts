/**
 * V2 Fair Value Calculator
 * Layer 4 companion — computes intrinsic value using three methods:
 *   1. DCF Light (sector-aware, growth-adjusted)
 *   2. Graham Number (classic value formula)
 *   3. P/E Based (sector-relative)
 *
 * All configurable parameters come from getWeight() / getSectorAverage().
 * Handles edge cases: zero prices, negative P/E, empty history.
 * 
 * SAFETY: All methods check fundamental data quality before computing.
 * If EPS/PE/PB data is unreliable (stale or clearly wrong), methods return 0.
 * Fair value is capped based on quality score:
 *   - qualityScore > 60: 3.0× current price (high-conviction picks)
 *   - qualityScore > 40: 2.0× current price
 *   - Otherwise:        1.5× current price
 *   - No qualityScore:  1.5× current price (backward compatible)
 */

import type { FairValueResult } from './types';
import { getWeight, getSectorAverage } from './config-service';

// ==================== HELPERS ====================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Safely extract a numeric value from stock record.
 */
function toNum(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Estimate a CAGR from price history.
 * Uses first and last close, converts to annualised figure.
 * Capped at `maxGrowth` (default 30%) from config.
 */
function estimateGrowthFromHistory(
  priceHistory: Array<Record<string, unknown>>,
  maxGrowth: number
): number {
  if (!priceHistory || priceHistory.length < 2) return 0;

  // Sort ascending by date
  const sorted = [...priceHistory].sort((a, b) => {
    const dateA = String(a.date ?? a.trade_date ?? 0);
    const dateB = String(b.date ?? b.trade_date ?? 0);
    return dateA.localeCompare(dateB);
  });

  const firstPrice = Number(sorted[0].close ?? sorted[0].adjusted_close ?? 0);
  const lastPrice = Number(sorted[sorted.length - 1].close ?? sorted[sorted.length - 1].adjusted_close ?? 0);

  if (firstPrice <= 0 || lastPrice <= 0) return 0;

  // Parse dates for year count
  const firstDate = new Date(String(sorted[0].date ?? sorted[0].trade_date));
  const lastDate = new Date(String(sorted[sorted.length - 1].date ?? sorted[sorted.length - 1].trade_date));

  const yearDiff =
    (lastDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  // Need at least ~3 months of data
  if (yearDiff < 0.25) return 0;

  const cagr = (Math.pow(lastPrice / firstPrice, 1 / yearDiff) - 1) * 100;
  return Math.max(-maxGrowth, Math.min(maxGrowth, cagr));
}

// ==================== MAIN FUNCTION ====================

/**
 * Calculate fair value for a single stock using multiple methods.
 *
 * @param stock         - Row from the stocks table (must include eps, pb_ratio, pe_ratio,
 *                        current_price, sector at minimum)
 * @param priceHistory  - Array of price history rows (date, close, adjusted_close)
 * @param qualityScore  - Optional quality score (0–100). Controls the fair value cap:
 *                        > 60 → 3.0× cap, > 40 → 2.0× cap, else 1.5× cap.
 *
 * IMPROVED: If current_price is 0, try to get latest price from history.
 */
export function calculateFairValue(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
  qualityScore?: number
): FairValueResult {
  // ---- Extract fields with safe defaults ----
  const eps = Number(stock.eps ?? 0) || 0;
  let currentPrice = Number(stock.current_price ?? 0) || 0;
  const pbRatio = Number(stock.pb_ratio ?? 0) || 0;
  const peRatio = Number(stock.pe_ratio ?? 0) || 0;
  const sector = String(stock.sector ?? '_global');

  // FIX: If current_price is 0, try to get latest price from history
  if (currentPrice <= 0 && priceHistory && priceHistory.length > 0) {
    // History is in chronological order (oldest first), so get last item
    const latestBar = priceHistory[priceHistory.length - 1];
    const histClose = Number(latestBar?.close ?? latestBar?.adjusted_close ?? 0) || 0;
    if (histClose > 0) {
      currentPrice = histClose;
      console.log(`[calculateFairValue] Using price from history for ${stock.ticker || stock.symbol}: ${currentPrice}`);
    }
  }

  if (currentPrice <= 0) {
    return buildFallback(currentPrice, 0, 0, 0);
  }

  // ---- Configurable values ----
  const marginOfSafety = getWeight('margin_of_safety', 0.85);
  const sectorPePremium = getWeight('sector_pe_premium', 1.1);
  const maxGrowthCap = getWeight('max_growth_cap', 25); // Reduced from 30 to 25
  const minUpsideBuy = getWeight('min_upside_buy', 15);
  const maxDownsideFair = getWeight('max_downside_fair', -10);
  const riskFreeRate = getWeight('risk_free_rate', 17.5);

  // ---- Sector averages ----
  const sectorAvg = getSectorAverage(sector);
  const sectorTargetPE = round2(sectorAvg.avgPE * sectorPePremium);

  // ---- BVPS from P/B ratio ----
  // CRITICAL FIX: BVPS = Price/PB is CIRCULAR!
  // If we don't have actual book value per share, we should:
  // 1. Try to get it from fundamental data
  // 2. If not available, estimate from equity/shares_outstanding
  // 3. If still not available, use Price/PB but add warning
  let bookValuePerShare = 0;
  let bvpsSource = 'unavailable';
  
  // Try actual book value per share from stock data
  if (toNum(stock.book_value_per_share, 0) > 0) {
    bookValuePerShare = toNum(stock.book_value_per_share, 0);
    bvpsSource = 'actual';
  } else if (toNum(stock.total_equity, 0) > 0 && toNum(stock.shares_outstanding, 0) > 0) {
    // Calculate from total equity / shares outstanding
    bookValuePerShare = toNum(stock.total_equity, 0) / toNum(stock.shares_outstanding, 0);
    bvpsSource = 'calculated';
  } else if (pbRatio > 0 && currentPrice > 0) {
    // FALLBACK: Circular calculation (Price/PB) with warning
    // This is problematic because it doesn't add independent information
    bookValuePerShare = round2(currentPrice / pbRatio);
    bvpsSource = 'circular_WARNING';
  }

  // ---- Growth rate from price history ----
  const growthRate = round2(
    estimateGrowthFromHistory(priceHistory, maxGrowthCap)
  );

  // ========================
  // FUNDAMENTAL DATA QUALITY CHECK
  // ========================
  // Egyptian market: reasonable ranges for fundamental data
  // If data is stale/wrong, don't calculate fair value from it
  const epsReasonable = eps > 0 && eps < currentPrice * 1.0; // earnings yield < 100%
  const peReasonable = peRatio > 0 && peRatio < 80; // P/E < 80 for EGX
  const pbReasonable = pbRatio > 0 && pbRatio < 15;  // P/B < 15
  const dataReliable = epsReasonable && peReasonable;

  // ---- Fair value cap: LINEAR based on quality score ----
  // FIXED: Old stepped approach created cliff edges:
  //   - qualityScore = 61 → cap = 3.0×
  //   - qualityScore = 59 → cap = 1.5× (2 points difference = 50% cap difference!)
  //
  // NEW: Linear interpolation
  //   cap = 1.5 + (qualityScore / 100) × 1.5
  //   - qualityScore = 0  → cap = 1.5×
  //   - qualityScore = 50 → cap = 2.25×
  //   - qualityScore = 100 → cap = 3.0×
  const baseCap = 1.5;
  const maxCap = 3.0;
  const fairValueCapMultiplier = qualityScore !== undefined
    ? round2(baseCap + (qualityScore / 100) * (maxCap - baseCap))
    : baseCap;
  const maxFairValue = round2(currentPrice * fairValueCapMultiplier);
  const minFairValue = round2(currentPrice * 0.3); // Don't go below 30% of current

  // ========================
  // METHOD 1: Dividend Discount Model (DDM) - FIXED
  // ========================
  // DDM = D1 / (r - g)
  // Where:
  //   D1 = EPS × PayoutRatio × (1 + g)
  //   r = Required Return = RiskFreeRate + EquityRiskPremium + CountryRiskPremium
  //   g = Growth Rate (capped at r - 0.02 to ensure g < r)
  //
  // CRITICAL FIX: Old DCF Light had no discounting, causing 60%+ overvaluation.
  // DDM properly discounts future cash flows.
  let dcfLight = 0; // Now using DDM, keeping variable name for compatibility
  if (dataReliable && eps > 0) {
    // Required return for Egyptian market
    const equityRiskPremium = getWeight('equity_risk_premium', 8.0);
    const countryRiskPremium = getWeight('country_risk_premium', 5.0);
    const requiredReturn = (riskFreeRate + equityRiskPremium + countryRiskPremium) / 100; // Convert to decimal

    // Payout ratio estimation (assume 40% if no dividend data)
    const dividendYield = toNum(stock.dividend_yield, 0) / 100;
    const earningsYield = eps > 0 && currentPrice > 0 ? eps / currentPrice : 0.08;
    const payoutRatio = dividendYield > 0 && earningsYield > 0
      ? Math.min(dividendYield / earningsYield, 0.9)
      : getWeight('default_payout_ratio', 0.40);

    // Growth rate capped to ensure g < r (mathematical requirement for DDM)
    const gDecimal = Math.min(growthRate / 100, requiredReturn - 0.02);

    // DDM calculation: D1 = EPS × PayoutRatio × (1 + g)
    if (requiredReturn > gDecimal && gDecimal >= 0) {
      const d1 = eps * payoutRatio * (1 + gDecimal);
      const ddmValue = d1 / (requiredReturn - gDecimal);

      // Apply margin of safety
      dcfLight = round2(ddmValue * marginOfSafety);
      dcfLight = Math.min(dcfLight, maxFairValue);
    } else {
      // Fallback: If growth >= required return, use conservative PE method
      // This happens in hyper-growth scenarios where DDM doesn't work
      dcfLight = round2(eps * sectorTargetPE * marginOfSafety * 0.7); // 30% haircut
      dcfLight = Math.min(dcfLight, maxFairValue);
    }
  }

  // ========================
  // METHOD 2: Graham Number
  // ========================
  // Graham = √(22.5 × EPS × BVPS)
  // IMPROVED: Now tracks BVPS source and reduces weight for circular calculations
  let grahamNumber = 0;
  let grahamWarning: string | null = null;
  
  if (dataReliable && eps > 0 && bookValuePerShare > 0) {
    grahamNumber = round2(Math.sqrt(22.5 * eps * bookValuePerShare));
    grahamNumber = Math.min(grahamNumber, maxFairValue);
    
    // Add warning if BVPS was calculated circularly
    if (bvpsSource === 'circular_WARNING') {
      grahamWarning = 'تحذير: القيمة الدفترية محسوبة من السعر/مكرر القيمة الدفترية - تقييم تقريبي';
      // Reduce Graham weight when circular (less reliable)
      grahamNumber = round2(grahamNumber * 0.7);
    }
  }

  // ========================
  // METHOD 3: P/E Based
  // ========================
  // PE_Based = sector_avg_PE × EPS
  let peBased = 0;
  if (dataReliable && eps > 0) {
    peBased = round2(sectorAvg.avgPE * eps);
    peBased = Math.min(peBased, maxFairValue);
  }

  // ========================
  // AVERAGE FAIR VALUE
  // ========================
  const validValues: number[] = [grahamNumber, peBased, dcfLight].filter(
    (v) => v > 0
  );

  // CRITICAL FIX: If no valid values can be calculated, return "unknown" verdict
  // instead of falling back to current price
  if (validValues.length === 0) {
    return {
      grahamNumber: 0,
      peBased: 0,
      dcfLight: 0,
      averageFairValue: 0,
      upsidePotential: 0,
      verdict: 'unknown' as const,
      verdictAr: 'لا يمكن حساب القيمة العادلة - بيانات غير كافية',
      dataReliable: false,
      details: {
        eps: round2(eps),
        bookValuePerShare,
        growthRate,
        sectorTargetPE,
        riskFreeRate,
        marginOfSafety,
      },
    };
  }

  // Compute raw average
  let rawAverage = round2(validValues.reduce((s, v) => s + v, 0) / validValues.length);

  // Apply hard caps
  const averageFairValue = round2(Math.max(minFairValue, Math.min(maxFairValue, rawAverage)));

  // ========================
  // UPSIDE POTENTIAL
  // ========================
  const upsidePotential =
    currentPrice > 0
      ? round2(((averageFairValue - currentPrice) / currentPrice) * 100)
      : 0;

  // ========================
  // VERDICT
  // ========================
  let verdict: FairValueResult['verdict'];
  let verdictAr: string;

  if (upsidePotential >= minUpsideBuy) {
    verdict = 'undervalued';
    verdictAr = 'مقوم بأقل من قيمته';
  } else if (upsidePotential >= maxDownsideFair) {
    verdict = 'fair';
    verdictAr = 'عادل التقييم';
  } else {
    verdict = 'overvalued';
    verdictAr = 'مقوم بأكثر من قيمته';
  }

  // ========================
  // BUILD RESULT
  // ========================
  return {
    grahamNumber,
    peBased,
    dcfLight,
    averageFairValue,
    upsidePotential,
    verdict,
    verdictAr,
    dataReliable,
    details: {
      eps: round2(eps),
      bookValuePerShare,
      growthRate,
      sectorTargetPE,
      riskFreeRate,
      marginOfSafety,
    },
  };
}

function buildFallback(
  currentPrice: number,
  eps: number,
  bookValuePerShare: number,
  growthRate: number,
): FairValueResult {
  return {
    grahamNumber: 0,
    peBased: 0,
    dcfLight: 0,
    averageFairValue: 0,
    upsidePotential: 0,
    verdict: 'unknown' as const,
    verdictAr: 'لا يمكن حساب القيمة العادلة - بيانات غير كافية',
    dataReliable: false,
    details: {
      eps,
      bookValuePerShare,
      growthRate,
      sectorTargetPE: 0,
      riskFreeRate: 0,
      marginOfSafety: 0,
    },
  };
}
