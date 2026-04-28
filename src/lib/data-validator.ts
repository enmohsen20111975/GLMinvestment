/**
 * data-validator.ts — Stock Data Validation & Verification Engine
 *
 * Validates all incoming stock data before it reaches the frontend.
 * Ensures data quality, flags anomalies, and prevents fake/stale data.
 *
 * SERVER-SIDE ONLY — uses z-ai-web-dev-sdk for web scraping verification.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  score: number; // 0-100, higher = more reliable
  issues: string[];
  warnings: string[];
  source: string;
  validated_at: string;
}

export interface StockDataPoint {
  ticker: string;
  current_price: number;
  previous_close?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  volume?: number;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  eps?: number;
  dividend_yield?: number;
  roe?: number;
  debt_to_equity?: number;
  sector?: string;
  name?: string;
  name_ar?: string;
  last_update?: string;
}

export interface ValidationRule {
  name: string;
  check: (data: StockDataPoint) => boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  weight: number; // how much this rule affects the score
}

// ---------------------------------------------------------------------------
// EGX Market Constants
// ---------------------------------------------------------------------------

// Egyptian stock market constraints
const EGX_CONSTRAINTS = {
  MIN_PRICE: 0.01,          // Absolute minimum price (fils)
  MAX_PRICE: 100000,         // Absolute maximum price
  MAX_DAILY_CHANGE_PCT: 20,  // EGX max daily limit (±20%)
  MAX_PE_RATIO: 500,         // Reasonable max P/E
  MAX_PB_RATIO: 50,          // Reasonable max P/B
  MAX_Dividend_YIELD: 50,    // Reasonable max dividend yield %
  MAX_ROE: 200,              // Reasonable max ROE %
  MAX_DEBT_TO_EQUITY: 100,   // Reasonable max D/E ratio
  MIN_VOLUME: 0,             // Minimum volume
  MAX_VOLUME: 1_000_000_000, // Reasonable max daily volume
  STALE_DATA_HOURS: 48,      // Data older than this is stale
  // Known valid EGX sectors
  VALID_SECTORS: [
    'Financials', 'Basic Materials', 'Real Estate', 'Consumer Goods',
    'Industrials', 'Food & Beverage', 'Technology', 'Consumer Services',
    'Healthcare', 'Energy', 'Telecommunications', 'Utilities',
    'Materials', 'Communication Services', 'Real Estate Investment Trusts',
  ],
};

// ---------------------------------------------------------------------------
// Validation Rules
// ---------------------------------------------------------------------------

const VALIDATION_RULES: ValidationRule[] = [
  // === CRITICAL RULES (error = data is rejected) ===
  {
    name: 'price_positive',
    check: (d) => d.current_price > 0,
    severity: 'error',
    message: 'السعر الحالي يجب أن يكون أكبر من صفر',
    weight: 25,
  },
  {
    name: 'price_within_range',
    check: (d) => d.current_price >= EGX_CONSTRAINTS.MIN_PRICE && d.current_price <= EGX_CONSTRAINTS.MAX_PRICE,
    severity: 'error',
    message: `السعر خارج النطاق المقبول (${EGX_CONSTRAINTS.MIN_PRICE}-${EGX_CONSTRAINTS.MAX_PRICE})`,
    weight: 25,
  },
  {
    name: 'high_gte_low',
    check: (d) => {
      if (d.high_price && d.low_price) return d.high_price >= d.low_price;
      return true; // Skip if not provided
    },
    severity: 'error',
    message: 'أعلى سعر يجب أن يكون أكبر من أو يساوي أدنى سعر',
    weight: 15,
  },
  {
    name: 'price_within_daily_range',
    check: (d) => {
      if (!d.high_price || !d.low_price) return true;
      return d.current_price >= d.low_price * 0.95 && d.current_price <= d.high_price * 1.05;
    },
    severity: 'error',
    message: 'السعر الحالي خارج نطاق اليوم بشكل غير طبيعي',
    weight: 20,
  },
  {
    name: 'ticker_format',
    check: (d) => /^[A-Z]{2,6}$/.test(d.ticker),
    severity: 'error',
    message: 'صيغة الرمز غير صحيحة (يجب 2-6 أحرف إنجليزية)',
    weight: 15,
  },
  {
    name: 'daily_change_limit',
    check: (d) => {
      if (!d.previous_close || d.previous_close === 0) return true;
      const changePct = Math.abs((d.current_price - d.previous_close) / d.previous_close) * 100;
      return changePct <= EGX_CONSTRAINTS.MAX_DAILY_CHANGE_PCT;
    },
    severity: 'error',
    message: `التغير اليومي يتجاوز الحد المسموح (±${EGX_CONSTRAINTS.MAX_DAILY_CHANGE_PCT}%)`,
    weight: 20,
  },

  // === WARNING RULES (data is flagged but accepted) ===
  {
    name: 'has_sector',
    check: (d) => d.sector !== null && d.sector !== undefined && d.sector !== '',
    severity: 'warning',
    message: 'القطاع غير محدد للسهم',
    weight: 10,
  },
  {
    name: 'sector_valid',
    check: (d) => {
      if (!d.sector) return true; // Skip if no sector
      return EGX_CONSTRAINTS.VALID_SECTORS.some(s =>
        s.toLowerCase() === d.sector!.toLowerCase()
      );
    },
    severity: 'warning',
    message: 'القطاع غير معروف في قائمة القطاعات المعتمدة',
    weight: 5,
  },
  {
    name: 'pe_reasonable',
    check: (d) => {
      if (!d.pe_ratio || d.pe_ratio <= 0) return true;
      return d.pe_ratio <= EGX_CONSTRAINTS.MAX_PE_RATIO;
    },
    severity: 'warning',
    message: `مضاعف الربحية مرتفع بشكل غير طبيعي (>${EGX_CONSTRAINTS.MAX_PE_RATIO})`,
    weight: 5,
  },
  {
    name: 'pb_reasonable',
    check: (d) => {
      if (!d.pb_ratio || d.pb_ratio <= 0) return true;
      return d.pb_ratio <= EGX_CONSTRAINTS.MAX_PB_RATIO;
    },
    severity: 'warning',
    message: `مضاعف القيمة الدفترية مرتفع بشكل غير طبيعي`,
    weight: 5,
  },
  {
    name: 'volume_reasonable',
    check: (d) => {
      if (!d.volume) return true;
      return d.volume >= EGX_CONSTRAINTS.MIN_VOLUME && d.volume <= EGX_CONSTRAINTS.MAX_VOLUME;
    },
    severity: 'warning',
    message: 'حجم التداول خارج النطاق الطبيعي',
    weight: 5,
  },
  {
    name: 'roe_reasonable',
    check: (d) => {
      if (!d.roe || d.roe <= 0) return true;
      return d.roe <= EGX_CONSTRAINTS.MAX_ROE;
    },
    severity: 'warning',
    message: 'العائد على حقوق الملكية مرتفع بشكل غير طبيعي',
    weight: 3,
  },
  {
    name: 'dividend_yield_reasonable',
    check: (d) => {
      if (!d.dividend_yield || d.dividend_yield <= 0) return true;
      return d.dividend_yield <= EGX_CONSTRAINTS.MAX_Dividend_YIELD;
    },
    severity: 'warning',
    message: 'عائد التوزيعات مرتفع بشكل غير طبيعي',
    weight: 3,
  },
  {
    name: 'has_name',
    check: (d) => {
      return !!(d.name || d.name_ar);
    },
    severity: 'warning',
    message: 'اسم السهم غير متوفر',
    weight: 10,
  },

  // === INFO RULES (informational, no score impact) ===
  {
    name: 'has_previous_close',
    check: (d) => d.previous_close !== undefined && d.previous_close !== null,
    severity: 'info',
    message: 'سعر الإغلاق السابق غير متوفر',
    weight: 0,
  },
  {
    name: 'has_ohlcv',
    check: (d) => !!(d.open_price && d.high_price && d.low_price && d.volume),
    severity: 'info',
    message: 'بيانات OHLCV غير مكتملة',
    weight: 0,
  },
];

// ---------------------------------------------------------------------------
// Main Validation Function
// ---------------------------------------------------------------------------

/**
 * Validate a single stock data point.
 * Returns a validation result with score, issues, and warnings.
 */
export function validateStockData(data: StockDataPoint, source: string = 'unknown'): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  let totalWeight = 0;
  let earnedWeight = 0;

  for (const rule of VALIDATION_RULES) {
    const passes = rule.check(data);
    totalWeight += rule.weight;

    if (passes) {
      earnedWeight += rule.weight;
    } else {
      switch (rule.severity) {
        case 'error':
          issues.push(`[خطأ] ${rule.message}`);
          break;
        case 'warning':
          warnings.push(`[تحذير] ${rule.message}`);
          break;
        case 'info':
          // Info messages don't count against the score
          earnedWeight += rule.weight; // Don't penalize for info
          break;
      }
    }
  }

  // Calculate score (0-100)
  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  return {
    valid: issues.length === 0,
    score,
    issues,
    warnings,
    source,
    validated_at: new Date().toISOString(),
  };
}

/**
 * Validate an array of stock data points.
 * Returns individual results and an aggregate summary.
 */
export function validateStockBatch(
  stocks: StockDataPoint[],
  source: string = 'unknown'
): {
  results: Map<string, ValidationResult>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    avg_score: number;
    critical_issues: string[];
  };
} {
  const results = new Map<string, ValidationResult>();
  let totalScore = 0;
  let validCount = 0;
  const criticalIssues: string[] = [];

  for (const stock of stocks) {
    const result = validateStockData(stock, source);
    results.set(stock.ticker, result);
    totalScore += result.score;
    if (result.valid) validCount++;
    criticalIssues.push(...result.issues.map(i => `${stock.ticker}: ${i}`));
  }

  return {
    results,
    summary: {
      total: stocks.length,
      valid: validCount,
      invalid: stocks.length - validCount,
      avg_score: stocks.length > 0 ? Math.round(totalScore / stocks.length) : 0,
      critical_issues: criticalIssues,
    },
  };
}

// ---------------------------------------------------------------------------
// Data Freshness Check
// ---------------------------------------------------------------------------

/**
 * Check if a timestamp represents fresh data.
 * Returns true if data is less than `maxAgeHours` old.
 */
export function isDataFresh(
  lastUpdate: string | null | undefined,
  maxAgeHours: number = EGX_CONSTRAINTS.STALE_DATA_HOURS
): { fresh: boolean; age_hours: number } {
  if (!lastUpdate) return { fresh: false, age_hours: Infinity };

  const lastTime = new Date(lastUpdate).getTime();
  if (isNaN(lastTime)) return { fresh: false, age_hours: Infinity };

  const ageMs = Date.now() - lastTime;
  const ageHours = ageMs / (1000 * 60 * 60);

  return {
    fresh: ageHours <= maxAgeHours,
    age_hours: Math.round(ageHours * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Cross-Source Verification
// ---------------------------------------------------------------------------

/**
 * Compare two price points from different sources.
 * Returns true if prices are within acceptable tolerance.
 *
 * Tolerance logic:
 *   - Prices < 1 EGP: 20% tolerance
 *   - Prices 1-10 EGP: 10% tolerance
 *   - Prices 10-100 EGP: 5% tolerance
 *   - Prices > 100 EGP: 3% tolerance
 */
export function pricesMatch(
  priceA: number,
  priceB: number,
  maxDeviationPct?: number
): { match: boolean; deviation_pct: number; tolerance_pct: number } {
  if (priceA <= 0 || priceB <= 0) {
    return { match: false, deviation_pct: 100, tolerance_pct: 0 };
  }

  const deviation = Math.abs(priceA - priceB) / Math.max(priceA, priceB) * 100;

  // Auto-tolerance based on price level
  const tolerance = maxDeviationPct ?? (
    priceA < 1 ? 20 :
    priceA < 10 ? 10 :
    priceA < 100 ? 5 : 3
  );

  return {
    match: deviation <= tolerance,
    deviation_pct: Math.round(deviation * 100) / 100,
    tolerance_pct: tolerance,
  };
}

// ---------------------------------------------------------------------------
// Known Fake Data Detection
// ---------------------------------------------------------------------------

/** Patterns that indicate fake/generated data */
const FAKE_NAME_PATTERNS = [
  /growth company/i,
  /شركة النمو/i,
  /egypt growth/i,
  /EG\d+X/i,
];

const FAKE_TICKER_PATTERNS = [
  /^EG\d+X$/i,
];

/**
 * Detect if a stock data point looks like fake/generated data.
 */
export function detectFakeData(data: StockDataPoint): {
  is_suspicious: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  // Check ticker patterns
  for (const pattern of FAKE_TICKER_PATTERNS) {
    if (pattern.test(data.ticker)) {
      reasons.push(`Ticker "${data.ticker}" matches fake pattern`);
    }
  }

  // Check name patterns
  if (data.name) {
    for (const pattern of FAKE_NAME_PATTERNS) {
      if (pattern.test(data.name)) {
        reasons.push(`Name "${data.name}" matches fake pattern`);
      }
    }
  }
  if (data.name_ar) {
    for (const pattern of FAKE_NAME_PATTERNS) {
      if (pattern.test(data.name_ar)) {
        reasons.push(`Name "${data.name_ar}" matches fake pattern`);
      }
    }
  }

  // Check for suspiciously round numbers (exact integers with no decimal)
  if (
    data.current_price > 10 &&
    data.current_price === Math.round(data.current_price) &&
    data.current_price % 5 === 0 &&
    (!data.volume || data.volume === Math.round(data.volume) && data.volume % 100000 === 0)
  ) {
    reasons.push('Price and volume are suspiciously round numbers');
  }

  return {
    is_suspicious: reasons.length > 0,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// EGX Trading Hours Validation
// ---------------------------------------------------------------------------

/**
 * Check if the current time is during EGX trading hours (Sun-Thu 10:00-14:30 Cairo).
 * Used to determine if live data should be expected.
 */
export function isEgxTradingHours(): boolean {
  const now = new Date();
  const cairoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = cairoFormatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const weekday = get('weekday');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const currentMinutes = hour * 60 + minute;

  const isWeekday = weekday !== 'Fri' && weekday !== 'Sat';
  return isWeekday && currentMinutes >= 600 && currentMinutes < 870; // 10:00-14:30
}

/**
 * Get the last trading day as YYYY-MM-DD.
 * If today is a trading day and market is closed, returns today.
 * If today is weekend, returns last Thursday.
 */
export function getLastTradingDay(): string {
  const now = new Date();
  const cairoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = cairoFormatter.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '';

  let date = new Date(`${year}-${month}-${day}`);

  // Adjust for weekends
  if (weekday === 'Sat') date.setDate(date.getDate() - 1); // Friday
  if (weekday === 'Fri') date.setDate(date.getDate() - 1); // Thursday
  // For Sunday before market open, go back to Thursday
  if (weekday === 'Sun') {
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    if (hour < 10) date.setDate(date.getDate() - 3); // Thursday
  }

  return date.toISOString().split('T')[0];
}
