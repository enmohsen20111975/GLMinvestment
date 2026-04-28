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
 */
export function calculateFairValue(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
  qualityScore?: number
): FairValueResult {
  // ---- Extract fields with safe defaults ----
  const eps = Number(stock.eps ?? 0) || 0;
  const currentPrice = Number(stock.current_price ?? 0) || 0;
  const pbRatio = Number(stock.pb_ratio ?? 0) || 0;
  const peRatio = Number(stock.pe_ratio ?? 0) || 0;
  const sector = String(stock.sector ?? '_global');

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
  const bookValuePerShare = pbRatio > 0 && currentPrice > 0
    ? round2(currentPrice / pbRatio)
    : 0;

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

  // ---- Fair value cap: dynamic based on quality score ----
  // High-conviction picks (qualityScore > 60) get a 3.0× cap so the target
  // isn't artificially suppressed. Medium quality gets 2.0×, low quality 1.5×.
  const fairValueCapMultiplier =
    qualityScore !== undefined && qualityScore > 60
      ? 3.0
      : qualityScore !== undefined && qualityScore > 40
        ? 2.0
        : 1.5;
  const maxFairValue = round2(currentPrice * fairValueCapMultiplier);
  const minFairValue = round2(currentPrice * 0.3); // Don't go below 30% of current

  // ========================
  // METHOD 1: DCF Light
  // ========================
  // Fair Value = (EPS × Sector_Target_PE) × (1 + Growth)^3 × MarginOfSafety
  let dcfLight = 0;
  if (dataReliable && eps > 0) {
    const growthFactor = Math.pow(1 + Math.max(growthRate, 0) / 100, 3);
    dcfLight = round2(eps * sectorTargetPE * growthFactor * marginOfSafety);
    dcfLight = Math.min(dcfLight, maxFairValue);
  }

  // ========================
  // METHOD 2: Graham Number
  // ========================
  // Graham = √(22.5 × EPS × BVPS)
  let grahamNumber = 0;
  if (dataReliable && eps > 0 && bookValuePerShare > 0) {
    grahamNumber = round2(Math.sqrt(22.5 * eps * bookValuePerShare));
    grahamNumber = Math.min(grahamNumber, maxFairValue);
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

  // Compute raw average
  let rawAverage = validValues.length > 0
    ? round2(validValues.reduce((s, v) => s + v, 0) / validValues.length)
    : currentPrice;

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
    averageFairValue: currentPrice,
    upsidePotential: 0,
    verdict: 'fair' as const,
    verdictAr: 'عادل التقييم - بيانات غير كافية',
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
