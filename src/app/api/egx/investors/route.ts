/**
 * GET /api/egx/investors
 * ======================
 * Flutter compat endpoint — بيانات تدفق المستثمرين في EGX
 * (مصريين / عرب / أجانب — buy / sell / net).
 *
 * Query:
 *   ?latest=true   (optional) — رجّع آخر جلسة فقط
 *   ?days=30        (default)  — عدد الأيام الراجعة (LIMIT)
 *
 * Behaviour:
 *   1. Open `stocks.db` (better-sqlite3, read-write so WAL can be reconciled).
 *   2. If `investors_data` table is MISSING or EMPTY:
 *        AUTO-SEED it now by computing estimates from `stock_daily_prices`
 *        for the last `days` trading days (see _seedInvestorsData).
 *      Then re-read.
 *   3. Map rows → normalized InvestorsRow shape compatible with
 *      InvestorsFlowPanel.tsx and the Flutter mobile app.
 *
 * لا يستخدم Python backend — كل البيانات من SQLite.
 * NO mock data — كل رقم من stock_daily_prices computation.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { openDbWritable } from '@/lib/db-manager';

const STOCKS_DB_PATH = 'stocks.db';

// Historical EGX participation ratios (long-term averages).
const EGX_RATIO_EGYPTIANS = 0.70;
const EGX_RATIO_ARABS = 0.10;
const EGX_RATIO_FOREIGNERS = 0.20;
const INSTITUTIONAL_TRADE_VALUE = 1_000_000.0;
const AVG_TRADE_SIZE_SHARES = 1000;

// BRAVO-URGENT-FIX (2026-10-18): Realistic EGX session turnover caps.
const MAX_DAILY_TURNOVER_EGP = 8_000_000_000.0;   // 8 billion EGP — hard cap
const MIN_DAILY_TURNOVER_EGP = 2_000_000_000.0;   // 2 billion EGP — floor (sanity check)

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS investors_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  session_type TEXT,
  individuals_buys_value REAL,
  individuals_sells_value REAL,
  individuals_net_value REAL,
  arab_buys_value REAL,
  arab_sells_value REAL,
  arab_net_value REAL,
  foreign_buys_value REAL,
  foreign_sells_value REAL,
  foreign_net_value REAL,
  total_buys_value REAL,
  total_sells_value REAL,
  number_of_trades INTEGER,
  source TEXT DEFAULT 'computed_estimate',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date)
);
`;

const UPSERT_SQL = `
INSERT OR REPLACE INTO investors_data (
  date, session_type,
  individuals_buys_value, individuals_sells_value, individuals_net_value,
  arab_buys_value, arab_sells_value, arab_net_value,
  foreign_buys_value, foreign_sells_value, foreign_net_value,
  total_buys_value, total_sells_value, number_of_trades,
  source, created_at
) VALUES (
  ?, ?,
  ?, ?, ?,
  ?, ?, ?,
  ?, ?, ?,
  ?, ?, ?,
  ?, datetime('now')
);
`;

function dbExists(p: string): boolean {
  try {
    const db = openDbWritable(p);
    if (db) { db.close(); return true; }
    return false;
  } catch {
    return false;
  }
}

function safeNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeNum0(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseVolume(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s) return 0;
  const m = s.match(/^([\d.,]+)\s*([KMBT]?)$/i);
  if (!m) {
    const n = Number(s.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const num = parseFloat(m[1].replace(/,/g, ''));
  const mult = (m[2] || '').toUpperCase();
  const factor =
    mult === 'K' ? 1e3 :
    mult === 'M' ? 1e6 :
    mult === 'B' ? 1e9 :
    mult === 'T' ? 1e12 : 1;
  return num * factor;
}

function dayPrice(row: { close?: number | null; close_price?: number | null }): number {
  if (row.close != null && Number.isFinite(Number(row.close)) && Number(row.close) > 0) return Number(row.close);
  if (row.close_price != null && Number.isFinite(Number(row.close_price)) && Number(row.close_price) > 0) return Number(row.close_price);
  return 0;
}

interface DailyPriceRow {
  ticker: string;
  close: number | null;
  close_price: number | null;
  volume: number | string | null;
  turnover: number | string | null;
  change_pct: number | null;
}

interface InvestorsRow {
  date: string | null;
  session_type: string | null;
  individuals_buys_value: number | null;
  individuals_sells_value: number | null;
  individuals_net_value: number | null;
  arab_buys_value: number | null;
  arab_sells_value: number | null;
  arab_net_value: number | null;
  foreign_buys_value: number | null;
  foreign_sells_value: number | null;
  foreign_net_value: number | null;
  total_buys_value: number | null;
  total_sells_value: number | null;
  number_of_trades: number | null;
}

function normalizeRow(r: Record<string, unknown>): InvestorsRow {
  return {
    date: r.date != null ? String(r.date) : (r.trade_date != null ? String(r.trade_date) : null),
    session_type: r.session_type != null ? String(r.session_type) : null,
    individuals_buys_value: safeNum(r.individuals_buys_value ?? r.individuals_buys),
    individuals_sells_value: safeNum(r.individuals_sells_value ?? r.individuals_sells),
    individuals_net_value: safeNum(r.individuals_net_value ?? r.individuals_net),
    arab_buys_value: safeNum(r.arab_buys_value ?? r.arab_buys),
    arab_sells_value: safeNum(r.arab_sells_value ?? r.arab_sells),
    arab_net_value: safeNum(r.arab_net_value ?? r.arab_net),
    foreign_buys_value: safeNum(r.foreign_buys_value ?? r.foreign_buys),
    foreign_sells_value: safeNum(r.foreign_sells_value ?? r.foreign_sells),
    foreign_net_value: safeNum(r.foreign_net_value ?? r.foreign_net),
    total_buys_value: safeNum(r.total_buys_value ?? r.total_buys),
    total_sells_value: safeNum(r.total_sells_value ?? r.total_sells),
    number_of_trades: safeNum(r.number_of_trades ?? r.trades_count),
  };
}

function computeStats(rows: InvestorsRow[]) {
  if (rows.length === 0) {
    return {
      total_sessions: 0,
      avg_individuals_net: 0,
      avg_arab_net: 0,
      avg_foreign_net: 0,
      total_trades: 0,
    };
  }
  let indSum = 0, indCnt = 0;
  let arabSum = 0, arabCnt = 0;
  let forSum = 0, forCnt = 0;
  let tradesSum = 0;
  for (const r of rows) {
    if (r.individuals_net_value != null) { indSum += r.individuals_net_value; indCnt++; }
    if (r.arab_net_value != null) { arabSum += r.arab_net_value; arabCnt++; }
    if (r.foreign_net_value != null) { forSum += r.foreign_net_value; forCnt++; }
    if (r.number_of_trades != null) tradesSum += r.number_of_trades;
  }
  return {
    total_sessions: rows.length,
    avg_individuals_net: indCnt > 0 ? Math.round((indSum / indCnt) * 100) / 100 : 0,
    avg_arab_net: arabCnt > 0 ? Math.round((arabSum / arabCnt) * 100) / 100 : 0,
    avg_foreign_net: forCnt > 0 ? Math.round((forSum / forCnt) * 100) / 100 : 0,
    total_trades: Math.round(tradesSum),
  };
}

/**
 * Compute & upsert investor-flow estimate for a single trading day.
 * Returns the inserted InvestorsRow, or null if no price data exists.
 */
function computeAndUpsertForDate(
  db: {
    prepare: (s: string) => {
      all: (...p: unknown[]) => DailyPriceRow[];
      get: (...p: unknown[]) => Record<string, unknown> | undefined;
      run: (...p: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    };
  },
  dateStr: string
): InvestorsRow | null {
  const rows = db
    .prepare(
      `SELECT ticker, close, close_price, volume, turnover, change_percent AS change_pct
       FROM stock_daily_prices
       WHERE price_date = ?`
    )
    .all(dateStr) as DailyPriceRow[];
  if (!rows || rows.length === 0) return null;

  let totalTurnover = 0;
  let totalVolume = 0;
  let advancingTurnover = 0;
  let decliningTurnover = 0;
  let flatTurnover = 0;
  let blockTrades = 0;

  for (const r of rows) {
    const price = dayPrice(r);
    const vol = parseVolume(r.volume);
    const turnoverRaw = parseVolume(r.turnover);
    const dayTurnover = turnoverRaw > 0 ? turnoverRaw : price * vol;
    if (dayTurnover <= 0) continue;
    totalTurnover += dayTurnover;
    totalVolume += vol;
    const pct = safeNum0(r.change_pct);
    if (pct > 0.01) advancingTurnover += dayTurnover;
    else if (pct < -0.01) decliningTurnover += dayTurnover;
    else flatTurnover += dayTurnover;
    const avgTradeVal = vol > 0 ? dayTurnover / vol : 0;
    if (avgTradeVal >= INSTITUTIONAL_TRADE_VALUE || dayTurnover >= INSTITUTIONAL_TRADE_VALUE) {
      blockTrades += 1;
    }
  }

  if (totalTurnover <= 0) return null;

  // BRAVO-URGENT-FIX #3 (2026-10-18): Volume cap — clamp to realistic EGX range.
  // Normal EGX session: 2-8 billion EGP. If DB has bad data (e.g., 100B), clamp.
  if (totalTurnover > MAX_DAILY_TURNOVER_EGP) {
    console.warn(`[investors] Turnover ${(totalTurnover/1e9).toFixed(2)}B exceeds cap — clamping (bad DB data)`);
    totalTurnover = MAX_DAILY_TURNOVER_EGP;
  }

  const advShare = advancingTurnover / totalTurnover;
  const decShare = decliningTurnover / totalTurnover;
  const flatShare = flatTurnover / totalTurnover;
  let buyRatio = advShare + flatShare * 0.5;
  if (buyRatio < 0.20) buyRatio = 0.20;
  if (buyRatio > 0.80) buyRatio = 0.80;
  const sellRatio = 1.0 - buyRatio;

  const egyTurnover = totalTurnover * EGX_RATIO_EGYPTIANS;
  const arabTurnover = totalTurnover * EGX_RATIO_ARABS;
  const foreignTurnover = totalTurnover * EGX_RATIO_FOREIGNERS;
  const approxTrades = totalVolume > 0 ? Math.round(totalVolume / AVG_TRADE_SIZE_SHARES) : blockTrades;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // BRAVO-URGENT-FIX #2 (2026-10-18): Accounting equation Σ = 0.
  // Rule: Egyptians_Net + Arabs_Net + Foreigners_Net == 0 (zero-sum market).
  // Foreigners follow the trend; Egyptians + Arabs absorb the counter-side.
  // buy/sell derived from turnover + net: buy = (T + net) / 2, sell = (T - net) / 2
  const foreignNet = foreignTurnover * (buyRatio - sellRatio);
  const counterFlow = -foreignNet;  // what Egyptians + Arabs must absorb (Σ = 0)
  const totalCounterTurnover = egyTurnover + arabTurnover;
  let egyShare: number, arabShare: number;
  if (totalCounterTurnover > 0) {
    egyShare = egyTurnover / totalCounterTurnover;
    arabShare = arabTurnover / totalCounterTurnover;
  } else {
    egyShare = 0.875;  // fallback: 70/10 → egy=70/80=0.875
    arabShare = 0.125;
  }
  const egyNet = counterFlow * egyShare;
  const arabNet = counterFlow * arabShare;

  // Derive buy/sell from turnover + net
  const egyBuy = (egyTurnover + egyNet) / 2;
  const egySell = (egyTurnover - egyNet) / 2;
  const arabBuy = (arabTurnover + arabNet) / 2;
  const arabSell = (arabTurnover - arabNet) / 2;
  const foreignBuy = (foreignTurnover + foreignNet) / 2;
  const foreignSell = (foreignTurnover - foreignNet) / 2;

  // Verify Σ = 0 (accounting identity)
  const sigmaCheck = egyNet + arabNet + foreignNet;
  if (Math.abs(sigmaCheck) > 0.01) {
    console.error(`[investors] Σ=0 violation: ${sigmaCheck} (egy=${egyNet}, arab=${arabNet}, foreign=${foreignNet})`);
  }

  const row: InvestorsRow = {
    date: dateStr,
    session_type: 'day',
    individuals_buys_value: round2(egyBuy),
    individuals_sells_value: round2(egySell),
    individuals_net_value: round2(egyNet),
    arab_buys_value: round2(arabBuy),
    arab_sells_value: round2(arabSell),
    arab_net_value: round2(arabNet),
    foreign_buys_value: round2(foreignBuy),
    foreign_sells_value: round2(foreignSell),
    foreign_net_value: round2(foreignNet),
    total_buys_value: round2(egyBuy + arabBuy + foreignBuy),
    total_sells_value: round2(egySell + arabSell + foreignSell),
    number_of_trades: approxTrades,
  };

  try {
    db.prepare(UPSERT_SQL).run(
      row.date,
      row.session_type,
      row.individuals_buys_value,
      row.individuals_sells_value,
      row.individuals_net_value,
      row.arab_buys_value,
      row.arab_sells_value,
      row.arab_net_value,
      row.foreign_buys_value,
      row.foreign_sells_value,
      row.foreign_net_value,
      row.total_buys_value,
      row.total_sells_value,
      row.number_of_trades,
      'computed_estimate'
    );
  } catch (e) {
    console.warn('[egx/investors] auto-seed upsert failed for date=' + dateStr + ':', e);
  }

  return row;
}

/**
 * Auto-seed the investors_data table by computing estimates from
 * stock_daily_prices for the last N trading days. Mutates the DB.
 */
function autoSeed(
  db: {
    exec: (s: string) => void;
    prepare: (s: string) => {
      all: (...p: unknown[]) => Record<string, unknown>[];
      get: (...p: unknown[]) => Record<string, unknown> | undefined;
      run: (...p: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    };
  },
  days: number
): { seeded: number; dates: string[] } {
  try {
    db.exec(CREATE_TABLE_SQL);
  } catch (e) {
    console.warn('[egx/investors] autoSeed CREATE TABLE failed:', e);
  }

  // Make sure stock_daily_prices exists.
  const tbl = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_daily_prices' LIMIT 1")
    .get() as { name?: string } | undefined;
  if (!tbl?.name) {
    return { seeded: 0, dates: [] };
  }

  // Pull the last N trading days that have data.
  const dateRows = db
    .prepare(
      'SELECT DISTINCT price_date FROM stock_daily_prices WHERE price_date IS NOT NULL ORDER BY price_date DESC LIMIT ?'
    )
    .all(days) as { price_date: string }[];
  const dates = dateRows.map((r) => r.price_date).filter(Boolean);

  let seeded = 0;
  for (const d of dates) {
    const r = computeAndUpsertForDate(db, d);
    if (r) seeded += 1;
  }
  return { seeded, dates };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const latest = url.searchParams.get('latest') === 'true';
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10) || 30));
    const limit = latest ? 1 : days;

    if (!dbExists(STOCKS_DB_PATH)) {
      return NextResponse.json({
        success: true,
        market: 'EGX',
        source: 'none',
        latest,
        days,
        rows: [],
        stats: {
          total_sessions: 0,
          avg_individuals_net: 0,
          avg_arab_net: 0,
          avg_foreign_net: 0,
          total_trades: 0,
        },
        note: 'stocks.db not found',
        generated_at: new Date().toISOString(),
      });
    }

    const db = openDbWritable(STOCKS_DB_PATH);
    if (!db) {
      return NextResponse.json({
        success: true,
        market: 'EGX',
        source: 'none',
        latest,
        days,
        rows: [],
        stats: {
          total_sessions: 0,
          avg_individuals_net: 0,
          avg_arab_net: 0,
          avg_foreign_net: 0,
          total_trades: 0,
        },
        note: 'stocks.db not found',
        generated_at: new Date().toISOString(),
      });
    }
    db.pragma('busy_timeout = 15000');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    let source = 'none';
    let rawRows: Record<string, unknown>[] = [];
    let autoSeeded = false;

    try {
      db.exec(CREATE_TABLE_SQL);
    } catch (e) {
      console.warn('[egx/investors] CREATE TABLE failed:', e);
    }

    try {
      // FILTER OUT fabricated rows (source='computed_estimate') — these are
      // NOT real EGX investor-flow data. They were auto-seeded by the (now
      // disabled) _seedInvestorsData function using hardcoded 70/10/20 ratios.
      // Kept in DB per owner directive (don't delete — set aside), just not served.
      rawRows = db
        .prepare("SELECT * FROM investors_data WHERE source IS NULL OR source != 'computed_estimate' ORDER BY date DESC LIMIT ?")
        .all(limit) as Record<string, unknown>[];
      source = 'EGX official (egx.com.eg) — run data_engine/scrapers/egx_investors_scraper.py to populate';
    } catch (e) {
      console.warn('[egx/investors] stocks.db query failed:', e);
    }

    // === DISABLED per owner directive (2026-10-22): "مانمسحش حاجة نشيلها على جنب" ===
    // The AUTO-SEED below FABRICATED investor-flow data using hardcoded ratios
    // (EGX_RATIO_EGYPTIANS=0.70, ARABS=0.10, FOREIGNERS=0.20) — violating Rule 27
    // (NO-FAKE-DATA). Code kept but not called. Real data comes from
    // data_engine/scrapers/egx_investors_scraper.py which fetches egx.com.eg/en/Market/ForeignInvestorsTrading.
    // if (rawRows.length === 0) {
    //   try {
    //     const result = autoSeed(db, Math.max(days, 7));
    //     if (result.seeded > 0) {
    //       autoSeeded = true;
    //       rawRows = db.prepare('SELECT * FROM investors_data ORDER BY date DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    //       source = 'stocks.db.investors_data (auto-seeded from stock_daily_prices)';
    //     }
    //   } catch (e) {
    //     console.warn('[egx/investors] auto-seed failed:', e);
    //   }
    // }

    db.close();

    if (rawRows.length === 0) {
      return NextResponse.json({
        success: true,
        market: 'EGX',
        source,
        latest,
        days,
        rows: [],
        stats: {
          total_sessions: 0,
          avg_individuals_net: 0,
          avg_arab_net: 0,
          avg_foreign_net: 0,
          total_trades: 0,
        },
        auto_seeded: false,
        note: 'لا توجد بيانات مستثمرين حقيقية. شغّل: python3 data_engine/scrapers/egx_investors_scraper.py (بيجلب من egx.com.eg الرسمي).',
        generated_at: new Date().toISOString(),
      });
    }

    const rows = rawRows.map(normalizeRow);
    const stats = computeStats(rows);

    return NextResponse.json({
      success: true,
      market: 'EGX',
      source,
      latest,
      days,
      rows,
      count: rows.length,
      stats,
      latest_row: rows[0] ?? null,
      auto_seeded: autoSeeded,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/egx/investors] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        rows: [],
        stats: {
          total_sessions: 0,
          avg_individuals_net: 0,
          avg_arab_net: 0,
          avg_foreign_net: 0,
          total_trades: 0,
        },
      },
      { status: 500 }
    );
  }
}
