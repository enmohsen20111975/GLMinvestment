/**
 * V2 Portfolio Engine
 * Layer 4 — Position sizing, entry/exit strategies, diversification checks,
 * and risk profiling for the EGX Investment Platform.
 *
 * All configurable thresholds come from getWeight().
 * Handles edge cases: zero prices, negative P/E, missing support levels.
 */

import type {
  PositionSizing,
  EntryStrategy,
  ExitStrategy,
  PortfolioRecommendation,
  UserProfile,
} from './types';
import { getWeight } from './config-service';

// ==================== HELPERS ====================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Clamp a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ==================== FUNCTION 1: POSITION SIZING (Kelly Criterion) ====================

/**
 * Calculate optimal position size using a simplified Kelly Criterion.
 *
 * Kelly% = (WinProb × W/L_Ratio − (1 − WinProb)) / W/L_Ratio
 * AdjustedKelly = Kelly% × kelly_fraction
 * FinalPosition = min(AdjustedKelly × capital, capital × max_risk_per_stock)
 *
 * If Kelly% < 0 the stock is not worth buying → position = 0.
 *
 * @param currentPrice   - Current market price
 * @param fairValue      - Calculated average fair value
 * @param supportLevel   - Nearest support level
 * @param stopLoss       - Proposed stop-loss price
 * @param qualityScore   - 0-100 quality score
 * @param technicalScore - 0-100 technical score
 * @param capital        - Total available capital (EGP)
 * @param avgDailyVolume - Optional. Average daily trading volume (shares)
 * @param avgValueTraded - Optional. Average daily value traded in EGP
 */
export function calculatePositionSizing(
  currentPrice: number,
  fairValue: number,
  supportLevel: number,
  stopLoss: number,
  qualityScore: number,
  technicalScore: number,
  capital: number,
  avgDailyVolume: number = 0,
  avgValueTraded: number = 0
): PositionSizing {
  // Guard: non-positive inputs
  if (currentPrice <= 0 || capital <= 0 || qualityScore <= 0) {
    return {
      kellyPercent: 0,
      adjustedPercent: 0,
      percentOfPortfolio: 0,
      amountEGP: 0,
      sharesCount: 0,
      maxRiskPerStock: round2(capital * getWeight('max_risk_per_stock', 0.10)),
    };
  }

  // Configurable values
  const kellyFraction = getWeight('kelly_fraction', 0.5);
  const maxRiskPerStockPct = getWeight('max_risk_per_stock', 0.10);

  // Ensure stop-loss is below current price
  const effectiveStopLoss =
    stopLoss > 0 && stopLoss < currentPrice ? stopLoss : supportLevel > 0 && supportLevel < currentPrice
      ? supportLevel
      : currentPrice * 0.92; // fallback: 8% drop

  // ---- Kelly Formula ----
  const winProb = qualityScore / 100;

  const expectedUpside = (fairValue - currentPrice) / currentPrice;
  const expectedLoss = (currentPrice - effectiveStopLoss) / currentPrice;

  // Avoid division by zero when loss = 0
  const winLossRatio = expectedLoss > 0 ? expectedUpside / expectedLoss : expectedUpside > 0 ? 3 : 0;

  const kellyPercent =
    winLossRatio > 0
      ? (winProb * winLossRatio - (1 - winProb)) / winLossRatio
      : -1;

  const adjustedKelly = kellyPercent * kellyFraction;
  const maxRiskAmount = capital * maxRiskPerStockPct;
  const finalPosition = clamp(adjustedKelly * capital, 0, maxRiskAmount);

  // If Kelly says don't buy
  if (kellyPercent < 0) {
    return {
      kellyPercent: round2(kellyPercent * 100),
      adjustedPercent: 0,
      percentOfPortfolio: 0,
      amountEGP: 0,
      sharesCount: 0,
      maxRiskPerStock: round2(maxRiskAmount),
    };
  }

  // ---- Liquidity Penalty ----
  // Low liquidity stocks have wider spreads and harder to exit positions
  let liquidityMultiplier = 1.0;
  let liquidityPenaltyReason = '';

  if (avgValueTraded > 0 && avgValueTraded < 500_000) {
    liquidityMultiplier = 0.40; // reduce by 60%
    liquidityPenaltyReason = 'سيولة منخفضة جداً - تم تقليل المركز بنسبة 60%';
  } else if (avgValueTraded > 0 && avgValueTraded < 2_000_000) {
    liquidityMultiplier = 0.70; // reduce by 30%
    liquidityPenaltyReason = 'سيولة متوسطة - تم تقليل المركز بنسبة 30%';
  }

  let positionAfterLiquidity = finalPosition * liquidityMultiplier;

  // ---- Volume Cap ----
  // Position amount should not exceed 10% of average daily volume value
  if (avgValueTraded > 0) {
    const maxPositionByVolume = avgValueTraded * 0.10;
    if (positionAfterLiquidity > maxPositionByVolume) {
      positionAfterLiquidity = maxPositionByVolume;
      liquidityPenaltyReason += (liquidityPenaltyReason ? ' | ' : '') + 'تم تقييد المركز بـ 10% من متوسط القيمة المتداولة يومياً';
    }
  }

  const sharesCount = Math.floor(positionAfterLiquidity / currentPrice);
  const percentOfPortfolio = capital > 0 ? round2((positionAfterLiquidity / capital) * 100) : 0;

  return {
    kellyPercent: round2(kellyPercent * 100),
    adjustedPercent: round2(adjustedKelly * 100),
    percentOfPortfolio,
    amountEGP: round2(positionAfterLiquidity),
    sharesCount,
    maxRiskPerStock: round2(maxRiskAmount),
  };
}

// ==================== FUNCTION 2: ENTRY STRATEGY ====================

/**
 * Calculate the recommended entry allocation across immediate, dip-buy, and cash.
 *
 * - Strong momentum (technicalScore ≥ 70): 70% immediate / 15% dip / 15% cash
 * - Moderate momentum (≥ 55):              50% immediate / 30% dip / 20% cash
 * - Weak momentum (< 55):                   30% immediate / 40% dip / 30% cash
 *
 * @param currentPrice   - Current market price
 * @param supportLevel   - Nearest support level
 * @param technicalScore - 0-100 technical score
 */
export function calculateEntryStrategy(
  currentPrice: number,
  supportLevel: number,
  technicalScore: number
): EntryStrategy {
  // Configurable thresholds
  const strongMomentumThreshold = getWeight('strong_momentum_threshold', 70);
  const moderateMomentumThreshold = getWeight('moderate_momentum_threshold', 55);
  const dipBuyDiscount = getWeight('dip_buy_discount', 0.05);

  let immediateBuy: number;
  let dipBuyPercent: number;
  let cashReserve: number;

  if (technicalScore >= strongMomentumThreshold) {
    immediateBuy = 70;
    dipBuyPercent = 15;
    cashReserve = 15;
  } else if (technicalScore >= moderateMomentumThreshold) {
    immediateBuy = 50;
    dipBuyPercent = 30;
    cashReserve = 20;
  } else {
    immediateBuy = 30;
    dipBuyPercent = 40;
    cashReserve = 30;
  }

  // Dip-buy level: support - discount, but never below 80% of current price
  const dipBuyLevel =
    supportLevel > 0 && currentPrice > 0
      ? round2(Math.max(supportLevel * (1 - dipBuyDiscount), currentPrice * 0.80))
      : currentPrice > 0
        ? round2(currentPrice * (1 - dipBuyDiscount))
        : 0;

  return {
    immediateBuy,
    dipBuyPercent,
    dipBuyLevel,
    cashReserve,
  };
}

// ==================== FUNCTION 3: EXIT STRATEGY ====================

/**
 * Calculate exit targets: price target, stop-loss, and time horizon.
 *
 * - Target cap is dynamic based on quality score:
 *     High quality (> 60):  min(fairValue, currentPrice × 2.0)
 *     Medium quality (> 40): min(fairValue, currentPrice × 1.5)
 *     Low quality (else):    min(fairValue, currentPrice × 1.2)
 * - Stop Loss   = max(support × 0.98, currentPrice × (1 − 2×ATR%))
 * - Time Horizon: upside > 30% → 12 mo, > 15% → 6 mo, else 3 mo
 *
 * @param currentPrice - Current market price
 * @param fairValue    - Calculated average fair value
 * @param supportLevel - Nearest support level
 * @param atrPercent   - Average True Range as percentage of price
 * @param qualityScore - Optional quality score (0–100). Controls the upside cap:
 *                       > 60 → 2.0×, > 40 → 1.5×, else 1.2×.
 */
export function calculateExitStrategy(
  currentPrice: number,
  fairValue: number,
  supportLevel: number,
  atrPercent: number,
  qualityScore?: number
): ExitStrategy {
  // Guard: non-positive current price
  if (currentPrice <= 0) {
    return {
      targetPrice: 0,
      stopLoss: 0,
      timeHorizonMonths: 3,
    };
  }

  // Configurable values — dynamic upside cap based on quality score
  // High-quality stocks get a wider target band; low-quality stocks stay conservative.
  const defaultCap = getWeight('max_upside_cap', 1.20);
  const maxUpsideCap =
    qualityScore !== undefined && qualityScore > 60
      ? 2.0
      : qualityScore !== undefined && qualityScore > 40
        ? 1.5
        : defaultCap;
  const timeDiscount = getWeight('time_discount', 0.85); // Target = FairValue × 0.85 (15% time discount)
  const supportBuffer = getWeight('support_buffer', 0.98);
  const atrMultiplier = getWeight('atr_stop_multiplier', 2);

  // ---- Target Price ----
  // Step 1: Apply time discount to fair value (Target = FairValue × 0.85)
  // This accounts for the time value of money and uncertainty over 6-12 months
  let targetPrice: number;
  if (fairValue > 0) {
    const discountedFairValue = round2(fairValue * timeDiscount);
    targetPrice = round2(Math.min(discountedFairValue, currentPrice * maxUpsideCap));
    // Never set target below current price for buy signals
    if (targetPrice <= currentPrice) {
      targetPrice = round2(currentPrice * 1.05); // At least 5% upside minimum for a buy signal
    }
  } else {
    targetPrice = round2(currentPrice * maxUpsideCap);
  }

  // ---- Stop Loss ----
  // Use real ATR: currentPrice × (1 − multiplier × ATR%)
  // Also consider support level
  const supportBasedSL =
    supportLevel > 0 ? round2(supportLevel * supportBuffer) : 0;
  const atrBasedSL = round2(currentPrice * (1 - atrMultiplier * (atrPercent / 100)));

  // Pick the higher (tighter) stop-loss, but never above current price
  // Also ensure stop loss is at least currentPrice * 0.90 (max 10% loss as floor)
  const stopLoss = round2(
    Math.max(supportBasedSL, atrBasedSL, currentPrice * 0.90)
  );

  // ---- Time Horizon ----
  const upside = ((targetPrice - currentPrice) / currentPrice) * 100;
  let timeHorizonMonths: number;

  const longHorizonThreshold = getWeight('long_horizon_threshold', 30);
  const mediumHorizonThreshold = getWeight('medium_horizon_threshold', 15);

  if (upside > longHorizonThreshold) {
    timeHorizonMonths = 12;
  } else if (upside > mediumHorizonThreshold) {
    timeHorizonMonths = 6;
  } else {
    timeHorizonMonths = 3;
  }

  return {
    targetPrice,
    stopLoss,
    timeHorizonMonths,
  };
}

// ==================== FUNCTION 4: DIVERSIFICATION CHECK ====================

/**
 * Check portfolio diversification against concentration rules.
 *
 * - Max N stocks from same sector (configurable, default 2)
 * - Max allocation per stock (configurable, default 20%)
 *
 * Returns issues in Arabic.
 *
 * @param selectedStocks - Array of { ticker, sector } objects
 * @param maxPerSector   - Optional override for max stocks per sector
 * @param maxAllocation  - Optional override for max allocation per stock (%)
 */
export function checkDiversification(
  selectedStocks: Array<{ ticker: string; sector: string }>,
  maxPerSector?: number,
  maxAllocation?: number
): PortfolioRecommendation {
  // Configurable values
  const sectorLimit = maxPerSector ?? getWeight('max_stocks_per_sector', 2);
  const allocationLimit = maxAllocation ?? getWeight('max_allocation_per_stock', 20);

  const issues: string[] = [];
  const sectorAllocation: Record<string, number> = {};

  // Count per sector
  const sectorCount: Record<string, string[]> = {};
  for (const stock of selectedStocks) {
    const sector = stock.sector || 'غير محدد';
    sectorCount[sector] = sectorCount[sector] || [];
    sectorCount[sector].push(stock.ticker);
    sectorAllocation[sector] = (sectorAllocation[sector] || 0) + 1;
  }

  // Check sector concentration
  for (const [sector, tickers] of Object.entries(sectorCount)) {
    if (tickers.length > sectorLimit) {
      issues.push(
        `تركز مفرط في قطاع "${sector}": ${tickers.length} أسهم (الحد الأقصى ${sectorLimit}). الأسهم: ${tickers.join('، ')}`
      );
    }
  }

  // Check total number of stocks
  const totalStocks = selectedStocks.length;
  const minDiversification = getWeight('min_portfolio_stocks', 5);
  const maxPortfolioStocks = getWeight('max_portfolio_stocks', 20);

  if (totalStocks < minDiversification && totalStocks > 0) {
    issues.push(
      `عدد الأسهم قليل (${totalStocks}) — يُنصح بحد أدنى ${minDiversification} أسهم للتنويع`
    );
  }
  if (totalStocks > maxPortfolioStocks) {
    issues.push(
      `عدد الأسهم كبير (${totalStocks}) — يُنصح بحد أقصى ${maxPortfolioStocks} سهم لسهولة الإدارة`
    );
  }

  // Check single-stock allocation (if total is known)
  if (totalStocks > 0) {
    const perStockPct = round2(100 / totalStocks);
    if (perStockPct > allocationLimit) {
      issues.push(
        `الوزن لكل سهم مرتفع (${perStockPct}%) — يُنصح بألا يتجاوز ${allocationLimit}%`
      );
    }
  }

  // Convert sector allocation from count to approximate percentages
  const sectorPctAllocation: Record<string, number> = {};
  if (totalStocks > 0) {
    for (const [sector, count] of Object.entries(sectorAllocation)) {
      sectorPctAllocation[sector] = round2((count / totalStocks) * 100);
    }
  }

  return {
    allowed: issues.length === 0,
    diversificationIssues: issues,
    sectorAllocation: sectorPctAllocation,
  };
}

// ==================== FUNCTION 5: RISK PROFILING ====================

/**
 * Calculate risk capacity based on user profile.
 *
 * StockAllocation = (100 − age) × TimeHorizonFactor × IncomeStabilityFactor
 *   TimeHorizon:      short(0.5), medium(0.8), long(1.0)
 *   IncomeStability:  fixed(1.0), variable(0.7), irregular(0.5)
 *
 * Clamped between 10% and 80%.
 *
 * @param profile - User profile with age, time horizon, income stability
 * @returns Recommended stock allocation percentage (10–80)
 */
export function calculateRiskCapacity(profile: UserProfile): number {
  // Default age if not provided
  const age = profile.age ?? 30;

  // Time horizon multiplier
  const timeHorizonFactors: Record<string, number> = {
    short: getWeight('time_horizon_short', 0.5),
    medium: getWeight('time_horizon_medium', 0.8),
    long: getWeight('time_horizon_long', 1.0),
  };
  const timeFactor = timeHorizonFactors[profile.timeHorizon] ?? 0.8;

  // Income stability multiplier
  const incomeFactors: Record<string, number> = {
    fixed: getWeight('income_stability_fixed', 1.0),
    variable: getWeight('income_stability_variable', 0.7),
    irregular: getWeight('income_stability_irregular', 0.5),
  };
  const incomeFactor = incomeFactors[profile.incomeStability] ?? 0.7;

  // Calculate raw allocation
  const baseAllocation = Math.max(100 - age, 0);
  const stockAllocation = baseAllocation * timeFactor * incomeFactor;

  // Clamp between configurable bounds
  const minAllocation = getWeight('min_stock_allocation', 10);
  const maxAllocation = getWeight('max_stock_allocation', 80);

  return round2(clamp(stockAllocation, minAllocation, maxAllocation));
}
