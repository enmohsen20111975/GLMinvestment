/**
 * V2 Safety Filter — Layer 1: Smart Safety Filter
 * Blocks dangerous stocks before they reach deeper analysis.
 * Dynamically adjusts thresholds based on market regime (Bull/Bear/Neutral).
 */

import type {
  SafetyFilterResult,
  SafetyViolation,
  RedFlag,
  MarketRegime,
} from './types';
import { getWeight, getRegimeMultiplier, getMarketRegime } from './config-service';
import { calculateRSI, calculateATR } from '@/lib/analysis-engine';
import type { PricePoint } from '@/lib/analysis-engine';

// ==================== HELPERS ====================

/**
 * Map raw price history rows to the PricePoint interface expected by analysis-engine.
 * Stock price_history columns: open_price, high_price, low_price, close_price, volume, date
 * PricePoint interface: date, open, high, low, close, volume
 */
function toPricePoints(priceHistory: Array<Record<string, unknown>>): PricePoint[] {
  return priceHistory
    .filter(p => p.close_price != null && Number(p.close_price) > 0)
    .map(p => ({
      date: String(p.date ?? ''),
      open: Number(p.open_price ?? 0),
      high: Number(p.high_price ?? 0),
      low: Number(p.low_price ?? 0),
      close: Number(p.close_price ?? 0),
      volume: Number(p.volume ?? 0),
    }));
}

/**
 * Safely extract a numeric field from a generic stock record.
 */
function num(stock: Record<string, unknown>, field: string, fallback: number = 0): number {
  const raw = stock[field];
  if (raw === null || raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Safely extract a string field from a generic stock record.
 */
function str(stock: Record<string, unknown>, field: string, fallback: string = ''): string {
  const raw = stock[field];
  return raw !== null && raw !== undefined ? String(raw) : fallback;
}

// ==================== PART A: DYNAMIC HARD-REJECT RULES ====================

/**
 * Apply the safety filter to a single stock.
 * Returns violations (hard rejects), red flags, and an overall pass/fail.
 *
 * Thresholds are loaded from the database via `getWeight()` and then
 * multiplied by the market regime multiplier:
 *   - Bull  (1.3): thresholds relax — fewer rejections
 *   - Bear  (0.7): thresholds tighten — more rejections
 *   - Neutral (1.0): base thresholds
 */
export function applySafetyFilter(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): SafetyFilterResult {
  const violations: SafetyViolation[] = [];
  const multiplier = getRegimeMultiplier();
  const regime = getMarketRegime();
  const ticker = str(stock, 'ticker', 'UNKNOWN');
  const sector = str(stock, 'sector', '').toLowerCase();
  const investmentType = str(stock, 'investment_type', '').toLowerCase();

  const currentPrice = num(stock, 'current_price', 0);
  const peRatio = num(stock, 'pe_ratio');
  const debtToEquity = num(stock, 'debt_to_equity');
  const volume = num(stock, 'volume');
  const volumeValue = volume * currentPrice; // Daily liquidity ≈ volume × price

  // --- Convert price history for indicator calculation ---
  const points = toPricePoints(priceHistory);
  const closes = points.map(p => p.close);

  // --- 1. RSI Overbought ---
  const rsi = closes.length >= 15
    ? calculateRSI(closes)
    : num(stock, 'rsi', 50);

  const rsiBaseThreshold = getWeight('safety_rsi_threshold', 78);
  const rsiThreshold = Math.round(rsiBaseThreshold * multiplier);

  if (rsi > rsiThreshold) {
    violations.push({
      rule: 'RSI_OVERBOUGHT',
      ruleAr: 'مؤشر RSI في منطقة التشبع الشرائي',
      value: Math.round(rsi * 100) / 100,
      threshold: rsiThreshold,
      severity: 'hard',
    });
  }

  // --- 2. P/E Too High (sector-aware) ---
  let peBaseThreshold: number;
  if (sector.includes('بنك') || sector.includes('bank') || investmentType === 'bank') {
    peBaseThreshold = getWeight('safety_pe_threshold_banks', 25);
  } else if (investmentType === 'high_growth' || investmentType === 'high-growth') {
    peBaseThreshold = getWeight('safety_pe_threshold_growth', 60);
  } else {
    peBaseThreshold = getWeight('safety_pe_threshold_general', 45);
  }
  const peThreshold = Math.round(peBaseThreshold * multiplier * 100) / 100;

  if (peRatio > 0 && peRatio > peThreshold) {
    violations.push({
      rule: 'PE_TOO_HIGH',
      ruleAr: 'مضاعف الربح مرتفع جداً',
      value: Math.round(peRatio * 100) / 100,
      threshold: peThreshold,
      severity: 'hard',
    });
  }

  // --- 3. Debt / Equity Too High ---
  const deBaseThreshold = getWeight('safety_debt_equity_threshold', 1.8);
  const deThreshold = Math.round(deBaseThreshold * multiplier * 100) / 100;

  if (debtToEquity > 0 && debtToEquity > deThreshold) {
    violations.push({
      rule: 'DEBT_TOO_HIGH',
      ruleAr: 'نسبة الدين لحقوق الملكية مرتفعة',
      value: Math.round(debtToEquity * 100) / 100,
      threshold: deThreshold,
      severity: 'hard',
    });
  }

  // --- 4. Volatility (ATR%) Too High ---
  const atr = points.length >= 2
    ? calculateATR(points)
    : 0;
  const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  const atrBaseThreshold = getWeight('safety_atr_percent_threshold', 8);
  const atrThreshold = Math.round(atrBaseThreshold * multiplier * 100) / 100;

  if (atrPercent > atrThreshold) {
    violations.push({
      rule: 'VOLATILITY_TOO_HIGH',
      ruleAr: 'تقلب سعر عالي جداً',
      value: Math.round(atrPercent * 100) / 100,
      threshold: atrThreshold,
      severity: 'hard',
    });
  }

  // --- 5. Daily Liquidity Too Low ---
  const liqBaseThreshold = getWeight('safety_liquidity_threshold', 500000);
  const liqThreshold = Math.round(liqBaseThreshold * multiplier);

  if (volumeValue < liqThreshold) {
    violations.push({
      rule: 'LIQUIDITY_TOO_LOW',
      ruleAr: 'سيولة تداول منخفضة',
      value: Math.round(volumeValue),
      threshold: liqThreshold,
      severity: 'hard',
    });
  }

  // --- Compile Red Flags ---
  const redFlags = checkRedFlags(stock);

  // --- Determine reject status ---
  const hardViolations = violations.filter(v => v.severity === 'hard');
  const rejected = hardViolations.length > 0;
  const rejectReason = rejected
    ? hardViolations.map(v => v.ruleAr).join(' | ')
    : undefined;

  return {
    passed: !rejected,
    violations,
    redFlags,
    rejected,
    rejectReason,
  };
}

// ==================== PART B: RED FLAGS SYSTEM ====================

/**
 * Check a stock for red flags (warnings, info, critical).
 * These are softer signals — they don't hard-reject the stock but
 * surface important concerns for the user.
 */
export function checkRedFlags(stock: Record<string, unknown>): RedFlag[] {
  const flags: RedFlag[] = [];

  const peRatio = num(stock, 'pe_ratio');
  const currentPrice = num(stock, 'current_price', 0);
  const volume = num(stock, 'volume', 0);
  const marketCap = num(stock, 'market_cap', 0);

  // --- 1. P/E negative (losing money) ---
  if (peRatio < 0) {
    flags.push({
      type: 'NEGATIVE_EARNINGS',
      typeAr: 'أرباح سالبة',
      description: `الشركة تحقق خسائر - مضاعف الربح (P/E) = ${Math.round(peRatio * 100) / 100}`,
      severity: 'warning',
    });
  }

  // --- 2. Revenue declining ---
  // Check price trend as a proxy: if current price < MA50, it suggests declining momentum
  const ma50 = num(stock, 'ma_50', 0);
  const ma200 = num(stock, 'ma_200', 0);
  if (ma50 > 0 && ma200 > 0 && currentPrice > 0) {
    // Price below both MAs → strong downtrend (proxy for declining fundamentals)
    if (currentPrice < ma50 && currentPrice < ma200) {
      flags.push({
        type: 'DECLINING_REVENUE',
        typeAr: 'تراجع ملحوظ',
        description: 'السهم يتداول تحت المتوسطين (50 و 200 يوم) مما يشير لتراجع مستمر',
        severity: 'warning',
      });
    }
  }

  // --- 3. Very high P/E > 100 ---
  if (peRatio > 100) {
    flags.push({
      type: 'VERY_HIGH_PE',
      typeAr: 'مضاعف ربح مرتفع جداً',
      description: `مضاعف الربح (P/E) = ${Math.round(peRatio * 100) / 100} - قد يكون السهم مبالغاً في تقييمه`,
      severity: 'info',
    });
  }

  // --- 4. Zero trading volume ---
  if (volume === 0) {
    flags.push({
      type: 'ZERO_VOLUME',
      typeAr: 'لا تداول',
      description: 'لا يوجد أي تداول على السهم - قد يكون معلقاً أو غير نشط',
      severity: 'critical',
    });
  }

  // --- 5. Price < 1 EGP (penny stock) ---
  if (currentPrice > 0 && currentPrice < 1) {
    flags.push({
      type: 'PENNY_STOCK',
      typeAr: 'سهم بنس واحد',
      description: `سعر السهم ${Math.round(currentPrice * 100) / 100} جنيه - أسهم رخيصة تحمل مخاطر عالية`,
      severity: 'warning',
    });
  }

  // --- 6. Very low market cap < 100M EGP ---
  if (marketCap > 0 && marketCap < 100_000_000) {
    flags.push({
      type: 'LOW_MARKET_CAP',
      typeAr: 'قيمة سوقية منخفضة',
      description: `القيمة السوقية ${(marketCap / 1_000_000).toFixed(1)} مليون جنيه - سيولة محدودة وتقلب عالي`,
      severity: 'info',
    });
  }

  return flags;
}
