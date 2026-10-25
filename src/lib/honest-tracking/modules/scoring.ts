// scoring functions — extracted (Phase 3)

    ['risk_reward', 'ALTER TABLE stored_analyses ADD COLUMN risk_reward REAL'],
    ['technical_score', 'ALTER TABLE stored_analyses ADD COLUMN technical_score REAL'],
    ['fundamental_score', 'ALTER TABLE stored_analyses ADD COLUMN fundamental_score REAL'],
    ['ai_decision', 'ALTER TABLE stored_analyses ADD COLUMN ai_decision TEXT'],
    ['ai_reason', 'ALTER TABLE stored_analyses ADD COLUMN ai_reason TEXT'],
    ['ai_narrative', 'ALTER TABLE stored_analyses ADD COLUMN ai_narrative TEXT'],
    ['ai_updated_at', 'ALTER TABLE stored_analyses ADD COLUMN ai_updated_at TEXT'],
    ['analysis_json', 'ALTER TABLE stored_analyses ADD COLUMN analysis_json TEXT'],
    ['updated_at', 'ALTER TABLE stored_analyses ADD COLUMN updated_at TEXT'],
  ]);

  const indexSql = SCHEMA_SQL.filter(s => s.startsWith('CREATE INDEX'));
  for (const sql of indexSql) {
    db.exec(sql);
  }
}

// ============================================================================
// INDICATOR MATH
// ============================================================================

interface PriceRow {
  date: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number | null;
  volume: number | null;
}

export interface Indicators {
  rsi: number | null;
  ma20: number | null;
  ma50: number | null;
  atr: number | null;
  support: number | null;
  resistance: number | null;
  bollingerWidth: number | null;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  candlePattern: string | null;
  volumeTrend: 'increasing' | 'decreasing' | 'spike' | 'flat' | null;
  close: number;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing.
// قبل كده: كان SMA-based على آخر 14 شمعة فقط — غلط رياضيًا.
// الحل: delegate to unified-stock-data.ts::computeRSI (TS canonical source).
function rsi(closes: number[], period = 14): number | null {
  return computeRSI(closes, period);
}

function atr(rows: PriceRow[], period = 14): number | null {
  if (rows.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = rows.length - period; i < rows.length; i++) {
    const r = rows[i];
    const prev = rows[i - 1];
    const high = Number(r.high_price || 0);
    const low = Number(r.low_price || 0);
    const prevClose = Number(prev.close_price || 0);
    if (high <= 0 || low <= 0 || prevClose <= 0) continue;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  return Math.round((trs.reduce((a, b) => a + b, 0) / trs.length) * 10000) / 10000;
}

function bollingerWidth(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return Math.round(((4 * sd) / mean) * 10000) / 10000; // width as fraction of mean
}

function detectCandlestick(rows: PriceRow[]): string | null {
  if (rows.length < 1) return null;
  const r = rows[rows.length - 1];
  const o = Number(r.open_price || 0);
  const c = Number(r.close_price || 0);
  const h = Number(r.high_price || 0);
  const l = Number(r.low_price || 0);
  if (o <= 0 || c <= 0 || h <= 0 || l <= 0) return null;
  const body = Math.abs(c - o);
  const range = h - l;
  if (range <= 0) return null;
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const bodyPct = body / range;

  // Doji: very small body
  if (bodyPct < 0.1) return 'DOJI';
  // Hammer / Hanging Man: small body, long lower wick
  if (lowerWick > 2 * body && upperWick < 0.3 * body) {
    return c > o ? 'HAMMER' : 'HANGING_MAN';
  }
  // Shooting star / Inverted hammer: small body, long upper wick
  if (upperWick > 2 * body && lowerWick < 0.3 * body) {
    return c < o ? 'SHOOTING_STAR' : 'INVERTED_HAMMER';
  }

  // Need previous row for engulfing / star patterns
  if (rows.length < 2) return null;
  const p = rows[rows.length - 2];
  const po = Number(p.open_price || 0);
  const pc = Number(p.close_price || 0);
  if (po <= 0 || pc <= 0) return null;
  const pBull = pc > po;
  const cBull = c > o;
  // Bullish Engulfing: prev bearish, curr bullish, curr body engulfs prev body
  if (!pBull && cBull && c >= po && o <= pc) return 'BULLISH_ENGULFING';
  // Bearish Engulfing
  if (pBull && !cBull && o >= pc && c <= po) return 'BEARISH_ENGULFING';

  // Morning / Evening Star (need 3 rows)
  if (rows.length >= 3) {
    const p2 = rows[rows.length - 3];
    const p2o = Number(p2.open_price || 0);
    const p2c = Number(p2.close_price || 0);
    if (p2o > 0 && p2c > 0) {
      const p2Bull = p2c > p2o;
      // Morning Star: big bearish, small body, big bullish
      if (!p2Bull && Math.abs(pc - po) < Math.abs(p2c - p2o) * 0.5 && cBull && c > (p2o + p2c) / 2) {
        return 'MORNING_STAR';
      }
      // Evening Star: big bullish, small body, big bearish
      if (p2Bull && Math.abs(pc - po) < Math.abs(p2c - p2o) * 0.5 && !cBull && c < (p2o + p2c) / 2) {
        return 'EVENING_STAR';
      }
    }
  }

  return null;
}

function detectVolumeTrend(rows: PriceRow[]): 'increasing' | 'decreasing' | 'spike' | 'flat' | null {
  if (rows.length < 10) return null;
  const recent = rows.slice(-10).map(r => Number(r.volume || 0));
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (recentAvg <= 0) return null;
  const last = recent[recent.length - 1];
  if (last > recentAvg * 2.5) return 'spike';
  const first5 = recent.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const last5 = recent.slice(5).reduce((a, b) => a + b, 0) / 5;
  if (last5 > first5 * 1.3) return 'increasing';
  if (last5 < first5 * 0.7) return 'decreasing';
  return 'flat';
}

/** Compute the full indicator set as of the LAST row in `rows`. */
export function computeIndicators(
  rows: PriceRow[],
  params: MaestroParams,
): Indicators | null {
  if (rows.length < MIN_HISTORY_DAYS) return null;
  const closes = rows.map(r => Number(r.close_price || 0)).filter(v => v > 0);
  if (closes.length < MIN_HISTORY_DAYS) return null;
  const last = rows[rows.length - 1];
  const close = Number(last.close_price || 0);
  if (close <= 0) return null;

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const rsiVal = rsi(closes, params.rsiPeriod);
  const atrVal = atr(rows, params.atrPeriod);
  const bbWidth = bollingerWidth(closes, 20);

  // Support / Resistance from last `swingLookback` rows
  const lookback = Math.min(rows.length, params.swingLookback);
  const recent = rows.slice(-lookback);
  let sup = Infinity, res = 0;
  for (const r of recent) {
    const l = Number(r.low_price || 0);
    const h = Number(r.high_price || 0);
    if (l > 0 && l < sup) sup = l;
    if (h > 0 && h > res) res = h;
  }
  if (!isFinite(sup)) sup = 0;
  if (res <= 0) res = close * 1.05;

  // Trend (uses MA20 alone when MA50 unavailable, so we can still get a
  // directional bias with only 35 days of history)
  let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (ma20 !== null) {
    if (close > ma20 * 1.005) {
      // Above MA20 — bullish unless we have MA50 and price is below it
      if (ma50 !== null && close < ma50) trend = 'NEUTRAL';
      else trend = 'BULLISH';
    } else if (close < ma20 * 0.995) {
      if (ma50 !== null && close > ma50) trend = 'NEUTRAL';
      else trend = 'BEARISH';
    }
    if (ma50 !== null) {
      if (trend === 'BULLISH' && ma20 > ma50) trend = 'BULLISH';
      else if (trend === 'BEARISH' && ma20 < ma50) trend = 'BEARISH';
    }
  }

  const candlePattern = detectCandlestick(rows);
  const volumeTrend = detectVolumeTrend(rows);

  return {
    rsi: rsiVal,
    ma20, ma50,
    atr: atrVal,
    support: Math.round(sup * 100) / 100,
    resistance: Math.round(res * 100) / 100,
    bollingerWidth: bbWidth,
    trend,
    candlePattern,
    volumeTrend,
    close,
  };
}

// ============================================================================
// SIGNAL DERIVATION (Maestro confluence)
// ============================================================================

export interface SignalDecision {
  signal: 'BUY' | 'SELL' | 'HOLD';
  technicalScore: number;   // 0..100
  fundamentalScore: number; // 0..100
  masterScore: number;      // 0..100
  confidence: number;       // 0..100
  reasons: string[];
  persona: 'gambler' | 'investor' | 'balanced';
}

/** Fundamental score from stocks.db row (P/E, ROE, etc.). */
function fundamentalScoreFromStock(s: StockRow | null | undefined): number {
  if (!s) return 50;
  let score = 50;
  // P/E: 5..20 is healthy
  const pe = Number(s.pe_ratio || 0);
  if (pe > 0) {
    if (pe < 5) score += 5;        // very cheap
    else if (pe <= 15) score += 12;
    else if (pe <= 25) score += 6;
    else if (pe > 50) score -= 8;  // very expensive
  }
  // ROE: higher is better
  const roe = Number(s.roe || 0);
  if (roe > 0) {
    if (roe >= 20) score += 12;
    else if (roe >= 15) score += 8;
    else if (roe >= 10) score += 4;
  }
  // Profit margin
  const pm = Number(s.profit_margin || 0);
  if (pm > 0) {
    if (pm >= 20) score += 8;
    else if (pm >= 10) score += 4;
  }
  // Dividend yield
  const dy = Number(s.dividend_yield || 0);
  if (dy > 0) score += Math.min(6, dy * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function deriveSignal(
  ind: Indicators,
  stock: StockRow | null | undefined,
  params: MaestroParams,
): SignalDecision {
  // ════════════════════════════════════════════════════════════════════════
  // AXIS-2 (MASTER DIRECTIVE): تم حذف منطق توليد التوقعات من TypeScript.
  // العقل في البايثون فقط (Rule: Python = THE BRAIN, TS = display-only).
  // توليد التوقعات الفعلي يتم في:
  //   - vps-service/analyzers/maestro_orchestrator.py
  //   - vps-service/analyzers/institutional_decision_engine.py
  //   - vps-service/jobs/daily_predictor.py
  // هذه الدالة теперь stub تعيد HOLD — لأغراض التوافق الخلفي فقط.
  // لا تستدعِها في كود جديد — استدعِ Python backend بدلاً من ذلك.
  // ════════════════════════════════════════════════════════════════════════
  void ind; void stock; void params; // suppress unused-var warnings
  return {
    signal: 'HOLD',
    technicalScore: 50,
    fundamentalScore: 50,
    masterScore: 50,
    confidence: 0,
    reasons: ['[AXIS-2] تم نقل توليد التوقعات إلى البايثون — استدعِ Python backend'],
    persona: 'balanced',
  };
}

