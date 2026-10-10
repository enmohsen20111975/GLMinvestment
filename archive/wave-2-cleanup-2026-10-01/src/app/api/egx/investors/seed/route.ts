/**
 * POST /api/egx/investors/seed
 * ============================
 * Populate the `investors_data` table in `db/stocks.db` with computed
 * investor-flow estimates (Egyptians / Arabs / Foreigners buy/sell/net)
 * derived from `stock_daily_prices`.
 *
 * Strategy
 * --------
 * For each requested trading day:
 *   1. Sum turnover across all stocks (close_price * volume — `turnover`
 *      column is sparse and usually null in production).
 *   2. Compute advancing vs declining turnover to derive a buy/sell ratio
 *      (clamped to [0.20, 0.80] so we never report 100%/0% splits).
 *   3. Allocate total turnover to Egyptians (70%), Arabs (10%),
 *      Foreigners (20%) using long-term historical EGX ratios.
 *   4. Estimate number_of_trades from volume (assumed avg trade size 1000 shares).
 *   5. CREATE TABLE IF NOT EXISTS `investors_data` (full schema).
 *   6. INSERT OR REPLACE on (date).
 *
 * Query
 * -----
 *   ?days=7      (default 1)  — backfill the last N trading days
 *   ?date=2026-08-27          — single specific date
 *
 * NO mock data — كل رقم من stock_daily_prices.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

const STOCKS_DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');

const EGX_RATIO_EGYPTIANS = 0.70;
const EGX_RATIO_ARABS = 0.10;
const EGX_RATIO_FOREIGNERS = 0.20;
const INSTITUTIONAL_TRADE_VALUE = 1_000_000.0;
const AVG_TRADE_SIZE_SHARES = 1000;

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

interface DailyPriceRow {
  ticker: string;
  close: number | null;
  close_price: number | null;
  volume: number | string | null;
  turnover: number | string | null;
  change_pct: number | null;
}

interface InvestorFlowRow {
  date: string;
  session_type: string | null;
  individuals_buys_value: number;
  individuals_sells_value: number;
  individuals_net_value: number;
  arab_buys_value: number;
  arab_sells_value: number;
  arab_net_value: number;
  foreign_buys_value: number;
  foreign_sells_value: number;
  foreign_net_value: number;
  total_buys_value: number;
  total_sells_value: number;
  number_of_trades: number;
  source: string;
}

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dayPrice(row: { close?: number | null; close_price?: number | null }): number {
  if (row.close != null && Number.isFinite(Number(row.close)) && Number(row.close) > 0) return Number(row.close);
  if (row.close_price != null && Number.isFinite(Number(row.close_price)) && Number(row.close_price) > 0) return Number(row.close_price);
  return 0;
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

function computeRowForDate(
  db: { prepare: (s: string) => { all: (...p: unknown[]) => DailyPriceRow[] } },
  dateStr: string
): InvestorFlowRow | null {
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
    const pct = safeNum(r.change_pct);
    if (pct > 0.01) advancingTurnover += dayTurnover;
    else if (pct < -0.01) decliningTurnover += dayTurnover;
    else flatTurnover += dayTurnover;
    const avgTradeVal = vol > 0 ? dayTurnover / vol : 0;
    if (avgTradeVal >= INSTITUTIONAL_TRADE_VALUE || dayTurnover >= INSTITUTIONAL_TRADE_VALUE) {
      blockTrades += 1;
    }
  }

  if (totalTurnover <= 0) return null;

  const advShare = advancingTurnover / totalTurnover;
  const decShare = decliningTurnover / totalTurnover;
  const flatShare = flatTurnover / totalTurnover;
  let buyRatio = advShare + flatShare * 0.5;
  // Smooth to realistic range [0.20, 0.80]
  if (buyRatio < 0.20) buyRatio = 0.20;
  if (buyRatio > 0.80) buyRatio = 0.80;
  const sellRatio = 1.0 - buyRatio;

  const egyTurnover = totalTurnover * EGX_RATIO_EGYPTIANS;
  const arabTurnover = totalTurnover * EGX_RATIO_ARABS;
  const foreignTurnover = totalTurnover * EGX_RATIO_FOREIGNERS;
  const approxTrades = totalVolume > 0 ? Math.round(totalVolume / AVG_TRADE_SIZE_SHARES) : blockTrades;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    date: dateStr,
    session_type: 'day',
    individuals_buys_value: round2(egyTurnover * buyRatio),
    individuals_sells_value: round2(egyTurnover * sellRatio),
    individuals_net_value: round2(egyTurnover * (buyRatio - sellRatio)),
    arab_buys_value: round2(arabTurnover * buyRatio),
    arab_sells_value: round2(arabTurnover * sellRatio),
    arab_net_value: round2(arabTurnover * (buyRatio - sellRatio)),
    foreign_buys_value: round2(foreignTurnover * buyRatio),
    foreign_sells_value: round2(foreignTurnover * sellRatio),
    foreign_net_value: round2(foreignTurnover * (buyRatio - sellRatio)),
    total_buys_value: round2(totalTurnover * buyRatio),
    total_sells_value: round2(totalTurnover * sellRatio),
    number_of_trades: approxTrades,
    source: 'computed_estimate',
  };
}

export async function POST(req: NextRequest) {
  if (!dbExists(STOCKS_DB_PATH)) {
    return NextResponse.json(
      { success: false, error: 'stocks.db not found', path: STOCKS_DB_PATH },
      { status: 500 }
    );
  }

  try {
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '1', 10) || 1));
    const specificDate = url.searchParams.get('date') || null;

    const Database = require('better-sqlite3');
    const db = new Database(STOCKS_DB_PATH, { readonly: false, timeout: 15000 });
    db.pragma('busy_timeout = 15000');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    try {
      db.exec(CREATE_TABLE_SQL);
    } catch (e) {
      console.warn('[investors/seed] CREATE TABLE failed:', e);
    }

    // Verify stock_daily_prices exists.
    const tbl = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_daily_prices' LIMIT 1")
      .get() as { name?: string } | undefined;
    if (!tbl?.name) {
      db.close();
      return NextResponse.json(
        { success: false, error: 'stock_daily_prices table not found — cannot compute estimate.' },
        { status: 500 }
      );
    }

    // Resolve the list of trading days to seed.
    let targetDates: string[];
    if (specificDate) {
      targetDates = [specificDate];
    } else {
      const dateRows = db
        .prepare(
          'SELECT DISTINCT price_date FROM stock_daily_prices WHERE price_date IS NOT NULL ORDER BY price_date DESC LIMIT ?'
        )
        .all(days) as { price_date: string }[];
      targetDates = dateRows.map((r) => r.price_date).filter(Boolean);
    }

    if (targetDates.length === 0) {
      db.close();
      return NextResponse.json({
        success: true,
        market: 'EGX',
        seeded: 0,
        rows: [],
        note: 'No trading days found in stock_daily_prices.',
      });
    }

    const upsertStmt = db.prepare(UPSERT_SQL);
    const inserted: InvestorFlowRow[] = [];
    for (const dateStr of targetDates) {
      const row = computeRowForDate(db, dateStr);
      if (!row) continue;
      upsertStmt.run(
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
        row.source
      );
      inserted.push(row);
    }

    db.close();

    return NextResponse.json({
      success: true,
      market: 'EGX',
      days,
      seeded: inserted.length,
      requested_dates: targetDates,
      rows: inserted,
      latest_row: inserted[0] ?? null,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[POST /api/egx/investors/seed] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        rows: [],
      },
      { status: 500 }
    );
  }
}

// Allow GET to trigger seeding too (for manual browser testing).
export async function GET(req: NextRequest) {
  return POST(req);
}
