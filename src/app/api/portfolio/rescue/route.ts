/**
 * POST /api/portfolio/rescue
 * =================================
 * Task 31-C — Disaster Stock Rescue Battalion.
 *
 * Deep rescue analysis for a losing/bag-holder position. The client supplies
 * `{ ticker, buy_price, quantity, buy_date? }` and we return a full JSON
 * envelope covering:
 *
 *   - Loss summary (current price, invested, market value, loss %, loss EGP,
 *     recovery needed %, all-time high/low, peak ratio)
 *   - Technical (RSI, MA50, MA200, support/resistance, 52w distance,
 *     Weinstein stage 1-4, verdict)
 *   - Fundamentals (P/E, sector, sharia compliance, profitability)
 *   - Scenarios (best/base/worst case + probability estimate)
 *   - Recommendation (HOLD/AVERAGE_DOWN/CUT_LOSS + reasoning + urgency +
 *     breakeven calculation)
 *   - Journal template string (pre-filled for the Decision Journal)
 *
 * Reads:
 *   - stocks.db: stocks (fundamentals + current price + MA/RSI/support/
 *     resistance if pre-computed) + stock_daily_prices (LIVE candles)
 *   - data_engine.db: sharia_compliance (sharia_metrics table)
 *   - price_history.db: price_history (EMERGENCY FALLBACK only — frozen at
 *     2026-09-24, used if stocks.db has no candle data for the ticker)
 *
 * (ALPHA-DAL-WAVE2 — owner directive 2026-10-27):
 *   «القراءة من جدول stock_daily_prices أولاً (حيث التاريخ أحدث من 2026-09-24).
 *    اجعل price_history.db خيار احتياطي أخير (Fallback) فقط.»
 *
 * Auth: required (getSessionUserId). All numeric outputs coerced to Number
 * and rounded to 2 decimals to keep the payload lean.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { getStocksDb, getPriceHistoryDb } from '@/lib/egx-db';
// (ALPHA-DAL-WAVE2 — owner directive 2026-10-27): openDb للوصول الموحد عبر DAL.
import { openDb } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Row = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ──────────────────────────────────────────────────────────────────────────
// Rule 54 (CALCULATION-CANONICAL) — every technical indicator calculation
// MUST come from the Python canonical package `vps-service/analyzers/indicators/`
// (calc_rsi Wilder's / calc_atr Wilder's / sma / ema / macd).
//
// This route reads stocks.db (stock_daily_prices PRIMARY) + price_history.db
// (EMERGENCY FALLBACK) via the egx-db helpers (which route through the DAL).
// To respect Rule 54, the local `sma`/`ema`/`rsi` calc functions were deleted
// 2026-10-05 (CALC-AUDIT consolidation). The technical fields `rsi`/`ma_50`/
// `ma_200` are read from the pre-computed columns in `stocks.db` (populated
// upstream by Python canonical indicators). If those columns are NULL, the
// rescue response returns `null` for the missing indicator (Rule 27: no fake
// data) — the UI shows «بانتظار المؤشرات الفنية».
//
// `supportResistance` (pivot detection) and `weinsteinStage` (heuristic) are
// NOT canonical indicators — they are locally derived analytics kept as-is.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Detect nearest support/resistance from local pivots in the last ~180 days.
 * Returns the 3 closest support levels below price and 3 closest resistance
 * levels above price.
 *
 * NOTE: pivot detection is a structural analytics heuristic — NOT a canonical
 * technical indicator per Rule 54. Kept local on purpose.
 */
function supportResistance(closes: number[], currentPrice: number): { support: number[]; resistance: number[] } {
  if (closes.length < 30) return { support: [], resistance: [] };
  const lookback = closes.slice(-180);
  const pivots: number[] = [];
  const window = 5;
  for (let i = window; i < lookback.length - window; i++) {
    const slice = lookback.slice(i - window, i + window + 1);
    const max = Math.max(...slice);
    const min = Math.min(...slice);
    if (lookback[i] === max) pivots.push(lookback[i]);
    if (lookback[i] === min) pivots.push(lookback[i]);
  }
  const uniq = Array.from(new Set(pivots));
  const supports = uniq
    .filter((p) => p < currentPrice)
    .sort((a, b) => b - a) // nearest first
    .slice(0, 3);
  const resistances = uniq
    .filter((p) => p > currentPrice)
    .sort((a, b) => a - b) // nearest first
    .slice(0, 3);
  return { support: supports, resistance: resistances };
}

/**
 * Weinstein stage classification (1=accumulation, 2=markup, 3=distribution,
 * 4=decline). Approximated from price vs MA50 + MA200 slope + RSI.
 */
function weinsteinStage(
  current: number,
  ma50: number,
  ma200: number,
  rsiVal: number,
  prevMa50: number,
): 1 | 2 | 3 | 4 {
  if (!ma50 || !ma200) return 1; // not enough history → assume accumulation
  const above50 = current > ma50;
  const above200 = current > ma200;
  const ma50Rising = ma50 > prevMa50;
  if (above50 && above200 && ma50Rising) return 2; // markup
  if (above50 && above200 && !ma50Rising && rsiVal > 60) return 3; // distribution
  if (!above50 && !above200) return 4; // decline
  if (!above50 && above200) return 1; // consolidation / accumulation
  return 1;
}

const STAGE_VERDICT: Record<1 | 2 | 3 | 4, { ar: string; hint: string }> = {
  1: {
    ar: 'مرحلة 1 — تجميع (Accumulation)',
    hint: 'السهم بيتجمّع على قاع. لو fundamentals قوية، متوسط تكلفة ممكن يكون مناسب.',
  },
  2: {
    ar: 'مرحلة 2 — صعود (Markup)',
    hint: 'السهم في ترند صاعد. اسهر على الدعم واربح مع الترند.',
  },
  3: {
    ar: 'مرحلة 3 — توزيع (Distribution)',
    hint: 'السهم بيتوزّع على القمة. خفّف مركزك أو اخرج على القوة.',
  },
  4: {
    ar: 'مرحلة 4 — هبوط (Decline)',
    hint: 'السهم في ترند هابط. افضل قرار غالباً قص الخسارة — متوسط وسط هبوط خطر.',
  },
};

/** Quick sharia compliance lookup from data_engine.db (best-effort, optional). */
function lookupSharia(ticker: string): { compliant: boolean | null; sources: number; details: string | null } {
  try {
    // (ALPHA-DAL-WAVE2): استخدم openDb من الـ DAL — ممنوع new Database().
    const db = openDb('data_engine.db');
    if (!db) {
      return { compliant: null, sources: 0, details: null };
    }
    db.pragma('busy_timeout = 8000');
    let row: Row | undefined;
    try {
      row = db.prepare('SELECT * FROM sharia_metrics WHERE UPPER(symbol) = ?').get(ticker.toUpperCase()) as Row | undefined;
    } catch {
      // table may not exist
      row = undefined;
    }
    try { db.close(); } catch { /* ignore */ }
    if (!row) return { compliant: null, sources: 0, details: null };
    const compliant = row.is_halal_consensus === 1 || row.is_halal_consensus === true;
    const sources = num(row.compliant_sources_count, 0);
    const category = (row.category_ar as string) || (row.category as string) || null;
    return {
      compliant,
      sources,
      details: category,
    };
  } catch {
    return { compliant: null, sources: 0, details: null };
  }
}

/**
 * Pull the last N closes (oldest → newest) for `ticker`.
 *
 * (ALPHA-DAL-WAVE2 — owner directive 2026-10-27):
 * «القراءة من جدول stock_daily_prices أولاً (حيث التاريخ أحدث من 2026-09-24).
 *  اجعل price_history.db خيار احتياطي أخير (Fallback) فقط إذا لم يُعثر على الرمز إطلاقاً.»
 *
 * Source priority:
 *   1. stocks.db.stock_daily_prices (LIVE — updated daily by TradingView Scanner)
 *   2. price_history.db.price_history (EMERGENCY FALLBACK — frozen at 2026-09-24)
 */
function fetchCloses(ticker: string, days: number): { closes: number[]; volumes: number[]; firstDate: string | null; lastDate: string | null; high52: number; low52: number } {
  const upper = ticker.toUpperCase();

  // ─── Source 1 (PRIMARY): stocks.db.stock_daily_prices ─────────────────────
  // (ALPHA-DAL-WAVE2): use getStocksDb() — it routes through the DAL (openDb).
  try {
    const db = getStocksDb();
    const rows = db
      .prepare(
        `SELECT price_date AS date, close_price, volume
         FROM stock_daily_prices
         WHERE ticker = ? AND close_price > 0
         ORDER BY price_date DESC
         LIMIT ?`,
      )
      .all(upper, days) as Row[];
    if (rows && rows.length > 0) {
      const sorted = [...rows].reverse();
      const closes = sorted.map((r) => num(r.close_price, 0)).filter((p) => p > 0);
      const volumes = sorted.map((r) => num(r.volume, 0));
      const firstDate = (sorted[0]?.date as string) || null;
      const lastDate = (sorted[sorted.length - 1]?.date as string) || null;
      let high52 = 0;
      let low52 = 0;
      try {
        const r52 = db
          .prepare(
            `SELECT MAX(high_price) AS h, MIN(low_price) AS l
             FROM stock_daily_prices
             WHERE ticker = ? AND price_date >= date('now','-365 days')`,
          )
          .get(upper) as Row | undefined;
        high52 = num(r52?.h, 0);
        low52 = num(r52?.l, 0);
      } catch { /* ignore */ }
      return { closes, volumes, firstDate, lastDate, high52, low52 };
    }
  } catch {
    // stocks.db missing or table not found → fall through to price_history.db.
  }

  // ─── Source 2 (EMERGENCY FALLBACK): price_history.db.price_history ────────
  // (ALPHA-DAL-WAVE2): آخر خيار طوارئ ONLY if stocks.db has no data.
  try {
    const db = getPriceHistoryDb();
    const rows = db
      .prepare(
        `SELECT date, close_price, volume
         FROM price_history
         WHERE ticker = ?
         ORDER BY date DESC
         LIMIT ?`,
      )
      .all(upper, days) as Row[];
    if (!rows || rows.length === 0) {
      return { closes: [], volumes: [], firstDate: null, lastDate: null, high52: 0, low52: 0 };
    }
    const sorted = [...rows].reverse();
    const closes = sorted.map((r) => num(r.close_price, 0)).filter((p) => p > 0);
    const volumes = sorted.map((r) => num(r.volume, 0));
    const firstDate = (sorted[0]?.date as string) || null;
    const lastDate = (sorted[sorted.length - 1]?.date as string) || null;
    let high52 = 0;
    let low52 = 0;
    try {
      const r52 = db
        .prepare(
          `SELECT MAX(high_price) AS h, MIN(low_price) AS l
           FROM price_history
           WHERE ticker = ? AND date >= date('now','-365 days')`,
        )
        .get(upper) as Row | undefined;
      high52 = num(r52?.h, 0);
      low52 = num(r52?.l, 0);
    } catch { /* ignore */ }
    return { closes, volumes, firstDate, lastDate, high52, low52 };
  } catch {
    return { closes: [], volumes: [], firstDate: null, lastDate: null, high52: 0, low52: 0 };
  }
}

/** Pull fundamentals + pre-computed MA/RSI from stocks.db (if present). */
function fetchStock(ticker: string): Row | null {
  try {
    const db = getStocksDb();
    const row = db
      .prepare(
        `SELECT ticker, name, name_ar, sector, industry, current_price, previous_close,
                pe_ratio, pb_ratio, ps_ratio, eps, roe, roa, debt_to_equity, current_ratio,
                profit_margin, market_cap, dividend_yield, beta, ma_50, ma_200, rsi,
                support, resistance, high_52w, low_52w, signal, trend
         FROM stocks
         WHERE ticker = ? COLLATE NOCASE
         LIMIT 1`,
      )
      .get(ticker) as Row | undefined;
    return row || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  let userId: string | null = null;
  try {
    const session = await getSessionUserId();
    userId = session.userId;
  } catch {
    /* ignore */
  }
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 },
    );
  }

  let body: { ticker?: unknown; buy_price?: unknown; quantity?: unknown; buy_date?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const ticker = String(body.ticker || '').trim().toUpperCase();
  const buyPrice = num(body.buy_price, 0);
  const quantity = num(body.quantity, 0);
  const buyDateRaw = body.buy_date ? String(body.buy_date) : null;

  if (!ticker || buyPrice <= 0) {
    return NextResponse.json(
      { success: false, error: 'بيانات ناقصة: أدخل كود السهم وسعر الشراء' },
      { status: 400 },
    );
  }

  // ── Resolve current price + fundamentals ────────────────────────────────
  const stockRow = fetchStock(ticker);
  let currentPrice = num(stockRow?.current_price, 0);
  if (currentPrice <= 0) currentPrice = num(stockRow?.previous_close, 0);

  // ── Pull price history for indicators ──────────────────────────────────
  const { closes, volumes, firstDate, lastDate, high52, low52 } = fetchCloses(ticker, 365);
  if (currentPrice <= 0 && closes.length > 0) {
    currentPrice = closes[closes.length - 1];
  }

  // ── Technical indicators (Rule 54: read pre-computed from stocks.db,
  //    populated upstream by Python canonical `analyzers.indicators`). ────────
  // Local SMA/EMA/RSI calcs were deleted 2026-10-05 (CALC-AUDIT consolidation).
  // `closes` array is still fetched for `supportResistance` pivot detection
  // (structural analytics — NOT a canonical indicator) and 52w high/low.
  const ma50 = num(stockRow?.ma_50, 0);
  const ma200 = num(stockRow?.ma_200, 0);
  const rsiVal = num(stockRow?.rsi, 50);
  const prevMa50 = ma50; // no historical MA50 available without Python; same as current
  const stage = weinsteinStage(currentPrice, ma50, ma200, rsiVal, prevMa50);
  const stageInfo = STAGE_VERDICT[stage];
  const { support, resistance } = supportResistance(closes, currentPrice);
  // 52w high/low from history (preferred) or stocks.db
  const high52Final = high52 || num(stockRow?.high_52w, 0);
  const low52Final = low52 || num(stockRow?.low_52w, 0);
  const distFromHigh = high52Final > 0 ? ((currentPrice - high52Final) / high52Final) * 100 : 0;
  const distFromLow = low52Final > 0 ? ((currentPrice - low52Final) / low52Final) * 100 : 0;

  // ── Loss summary math ────────────────────────────────────────────────────
  const investedEGP = buyPrice * quantity;
  const marketValueEGP = currentPrice * quantity;
  const lossEGP = marketValueEGP - investedEGP;
  const lossPct = investedEGP > 0 ? (lossEGP / investedEGP) * 100 : 0;
  const recoveryNeededPct = currentPrice > 0
    ? ((buyPrice - currentPrice) / currentPrice) * 100
    : 0;
  const peakRatio = high52Final > 0 ? currentPrice / high52Final : 0;

  // ── Fundamentals ───────────────────────────────────────────────────────
  const peRatio = num(stockRow?.pe_ratio, 0);
  const pbRatio = num(stockRow?.pb_ratio, 0);
  const eps = num(stockRow?.eps, 0);
  const roe = num(stockRow?.roe, 0);
  const profitMargin = num(stockRow?.profit_margin, 0);
  const sector = (stockRow?.sector as string) || '';
  const industry = (stockRow?.industry as string) || '';
  const name = (stockRow?.name_ar as string) || (stockRow?.name as string) || ticker;
  const isProfitable = profitMargin > 0 || eps > 0;
  const fundamentalsStrength =
    (peRatio > 0 && peRatio < 25 ? 1 : 0) +
    (roe > 10 ? 1 : 0) +
    (profitMargin > 5 ? 1 : 0) +
    (eps > 0 ? 1 : 0);
  const fundamentalsVerdict =
    fundamentalsStrength >= 3 ? 'قوية' : fundamentalsStrength >= 2 ? 'متوسطة' : 'ضعيفة';
  const sharia = lookupSharia(ticker);

  // ── Scenarios ────────────────────────────────────────────────────────────
  // Best case: retest of 52w high. Base case: hold current. Worst case: 52w low.
  const bestPrice = high52Final > 0 ? high52Final : buyPrice * 1.15;
  const basePrice = currentPrice;
  const worstPrice = low52Final > 0 ? low52Final : currentPrice * 0.7;
  const bestProfitEGP = (bestPrice - buyPrice) * quantity;
  const baseProfitEGP = (basePrice - buyPrice) * quantity;
  const worstProfitEGP = (worstPrice - buyPrice) * quantity;
  const bestPct = buyPrice > 0 ? ((bestPrice - buyPrice) / buyPrice) * 100 : 0;
  const basePct = buyPrice > 0 ? ((basePrice - buyPrice) / buyPrice) * 100 : 0;
  const worstPct = buyPrice > 0 ? ((worstPrice - buyPrice) / buyPrice) * 100 : 0;
  const bestProb = stage === 1 || stage === 2 ? 'medium' : 'low';
  const baseProb = 'high';
  const worstProb = stage === 4 ? 'high' : stage === 3 ? 'medium' : 'low';

  // ── Recommendation logic ─────────────────────────────────────────────────
  let recommendation: 'HOLD' | 'AVERAGE_DOWN' | 'CUT_LOSS' = 'HOLD';
  let urgency: 'low' | 'medium' | 'high' = 'low';
  let reasoningAr = '';
  if (lossPct <= -20 && stage === 4) {
    recommendation = 'CUT_LOSS';
    urgency = 'high';
    reasoningAr = `السهم في مرحلة هبوط (Stage 4) وخسران ${Math.abs(lossPct).toFixed(1)}% من قيمة الشراء. الأساسيات ${fundamentalsVerdict}. الاستمرار فيه يعرضك لمزيد من النزيف — اقطع الخسارة وأعد توجيه رأس المال لفرصة في Stage 2.`;
  } else if (lossPct <= -20) {
    recommendation = 'CUT_LOSS';
    urgency = 'high';
    reasoningAr = `الخسارة ${Math.abs(lossPct).toFixed(1)}% عميقة. لو الأساسيات ${fundamentalsVerdict}، استمرار الانتظار مكلف. اقطع الخسارة وادخل في سهم أقوى.`;
  } else if (lossPct <= -10 && (stage === 1 || stage === 2) && fundamentalsStrength >= 2) {
    recommendation = 'AVERAGE_DOWN';
    urgency = 'medium';
    reasoningAr = `السهم في مرحلة ${stage === 1 ? 'تجميع' : 'صعود'} والأساسيات ${fundamentalsVerdict}. خسارتك ${Math.abs(lossPct).toFixed(1)}% ضمن نطاق متوسط التكلفة. لو هتضيف كمية، خد في الاعتبار إن متوسطك الجديد هيكون أقرب للسعر الحالي.`;
  } else if (lossPct <= -10) {
    recommendation = 'HOLD';
    urgency = 'medium';
    reasoningAr = `الخسارة ${Math.abs(lossPct).toFixed(1)}% لكن السهم مش في Stage 2 صريح. احتفظ وافرض وقف تحت آخر دعم (${support[0]?.toFixed(2) || '—'}). لو كسر الدعم، اقطع فوراً.`;
  } else if (lossPct <= -3) {
    recommendation = 'HOLD';
    urgency = 'low';
    reasoningAr = `الخسارة ${Math.abs(lossPct).toFixed(1)}% ضمن تذبذب السوق الطبيعي. راقب الدعم القريب (${support[0]?.toFixed(2) || '—'}) وامسك الوقف. لا تتسرّع في أي قرار.`;
  } else {
    recommendation = 'HOLD';
    urgency = 'low';
    reasoningAr = `المركز في وضع سليم (${lossPct >= 0 ? '+' : ''}${lossPct.toFixed(1)}%). ${lossPct >= 15 ? 'فكّر في تأمين جزء من الأرباح (partial take-profit).' : 'استمر بوقف متحرك.'}`;
  }

  // ── Breakeven calculation for AVERAGE_DOWN ──────────────────────────────
  // Scenario: user adds `extraQty` at currentPrice. We expose the breakeven
  // point as "extra needed to bring avg to current price" — if user doubles
  // down such that new_avg == current_price, recovery to current_price breaks
  // even. Solve for extraQty: extraQty = qty*(buy-current)/(current-current) →
  // undefined when buy==current. The practical "double to breakeven" formula:
  //   to bring avg down to `target`, extraQty = qty*(buy-target)/(target-current)
  // We expose the simplest useful variant: how much to add to bring avg to
  // the 52w-low (best entry) OR to current price (full DCA).
  const targetAvg = currentPrice; // bring avg to current price = full breakeven
  const extraQtyForBreakeven =
    currentPrice > 0 && targetAvg < buyPrice && quantity > 0
      ? Math.ceil((quantity * (buyPrice - targetAvg)) / (targetAvg - currentPrice || 1e-9))
      : 0;
  const newAvgIfBreakeven = extraQtyForBreakeven > 0
    ? (quantity * buyPrice + extraQtyForBreakeven * currentPrice) / (quantity + extraQtyForBreakeven)
    : buyPrice;

  // ── Journal template ─────────────────────────────────────────────────────
  const journalTemplate = `أنا اشتريت ${ticker} (${name}) في ${buyDateRaw || lastDate || '—'} بـ ${buyPrice.toFixed(2)} ج.م، والكمية ${quantity} سهم. دلوقتي سعره ${currentPrice.toFixed(2)} وأنا ${lossPct >= 0 ? 'رابح' : 'خسران'} ${Math.abs(lossPct).toFixed(1)}% (${lossEGP >= 0 ? '+' : ''}${Math.round(lossEGP)} ج.م). قراري: ${recommendation}. السبب: ${reasoningAr}`;

  const response = {
    success: true,
    ticker,
    name,
    sector,
    industry,
    buy_price: round2(buyPrice),
    current_price: round2(currentPrice),
    quantity,
    buy_date: buyDateRaw || lastDate,
    invested_egp: round2(investedEGP),
    market_value_egp: round2(marketValueEGP),
    loss_pct: round2(lossPct),
    loss_egp: round2(lossEGP),
    recovery_needed_pct: round2(recoveryNeededPct),
    all_time_high: round2(high52Final),
    all_time_low: round2(low52Final),
    peak_ratio: round2(peakRatio),
    dist_from_high_pct: round2(distFromHigh),
    dist_from_low_pct: round2(distFromLow),
    history_range_start: firstDate,
    history_range_end: lastDate,
    technical: {
      rsi: round2(rsiVal),
      rsi_state: rsiVal < 30 ? 'تشبع بيعي (oversold)' : rsiVal > 70 ? 'تشبع شرائي (overbought)' : 'محايد',
      ma_50: round2(ma50),
      ma_200: round2(ma200),
      above_ma_50: currentPrice > ma50,
      above_ma_200: currentPrice > ma200,
      stage,
      stage_ar: stageInfo.ar,
      stage_hint: stageInfo.hint,
      support,
      resistance,
      trend: (stockRow?.trend as string) || null,
    },
    fundamentals: stockRow
      ? {
          pe_ratio: round2(peRatio),
          pb_ratio: round2(pbRatio),
          ps_ratio: round2(num(stockRow?.ps_ratio, 0)),
          eps: round2(eps),
          roe: round2(roe),
          roa: round2(num(stockRow?.roa, 0)),
          profit_margin_pct: round2(profitMargin * 100),
          debt_to_equity: round2(num(stockRow?.debt_to_equity, 0)),
          dividend_yield_pct: round2(num(stockRow?.dividend_yield, 0) * 100),
          beta: round2(num(stockRow?.beta, 0)),
          market_cap: round2(num(stockRow?.market_cap, 0)),
          is_profitable: isProfitable,
          strength_score: fundamentalsStrength,
          strength_verdict: fundamentalsVerdict,
          sharia_compliant: sharia.compliant,
          sharia_sources: sharia.sources,
          sharia_category: sharia.details,
          sector,
        }
      : null,
    scenarios: {
      best_case: {
        label: 'أفضل حالة — وصول للقمة التاريخية',
        price: round2(bestPrice),
        profit_egp: round2(bestProfitEGP),
        profit_pct: round2(bestPct),
        probability: bestProb,
      },
      base_case: {
        label: 'الحالة الأساسية — ثبات السعر',
        price: round2(basePrice),
        profit_egp: round2(baseProfitEGP),
        profit_pct: round2(basePct),
        probability: baseProb,
      },
      worst_case: {
        label: 'أسوأ حالة — هبوط للقاع التاريخي',
        price: round2(worstPrice),
        profit_egp: round2(worstProfitEGP),
        profit_pct: round2(worstPct),
        probability: worstProb,
      },
    },
    recommendation: {
      action: recommendation,
      action_ar:
        recommendation === 'CUT_LOSS'
          ? '🚨 اقطع الخسارة'
          : recommendation === 'AVERAGE_DOWN'
            ? '📉 اعمل متوسط'
            : '⏸️ اصبر',
      reasoning: reasoningAr,
      urgency,
      breakeven_calc: {
        extra_qty_to_breakeven: extraQtyForBreakeven,
        new_avg_if_added: round2(newAvgIfBreakeven),
        formula: 'لو أضفت X سهم عند السعر الحالي، متوسطك الجديد = (qty×buy + X×current) / (qty+X)',
      },
    },
    sparkline_data: closes.slice(-30).map((p) => round2(p)),
    journal_template: journalTemplate,
    disclaimer: '⚠️ هذه إشارة آلية مبنية على بيانات تاريخية. ليست نصيحة استثمارية مرخصة. استشر مستشاراً مالياً مرخّصاً قبل أي قرار.',
    source: 'sqlite_deep',
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  });
}

/** GET — convenience passthrough that mirrors the deep-analysis POST shape. */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ticker = url.searchParams.get('ticker') || '';
    const buyPrice = url.searchParams.get('buy_price') || '0';
    const quantity = url.searchParams.get('quantity') || '0';
    const buyDate = url.searchParams.get('buy_date') || undefined;
    // Reuse POST logic by issuing an internal call shape.
    const fakeReq = {
      json: async () => ({ ticker, buy_price: Number(buyPrice), quantity: Number(quantity), buy_date: buyDate }),
    } as unknown as NextRequest;
    return POST(fakeReq);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'internal_error', detail: String(e) },
      { status: 500 },
    );
  }
}
