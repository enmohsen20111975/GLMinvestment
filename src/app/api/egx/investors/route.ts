/**
 * GET /api/egx/investors
 * ======================
 * Flutter compat endpoint — بيانات تدفق المستثمرين في EGX.
 *
 * Query:
 *   ?latest=true   (optional) — رجّع آخر جلسة فقط
 *   ?days=30        (default)  — عدد الأيام الراجعة (LIMIT)
 *
 * المصادر بالترتيب:
 *   1. stocks.db.investors_data         (لو موجود)
 *   2. data_engine.db.investors_data    (fallback)
 *
 * Columns المتوقعة (آمن لو ناقصة):
 *   date, session_type,
 *   individuals_buys_value, individuals_sells_value, individuals_net_value,
 *   arab_institutions_buys_value, arab_institutions_sells_value, arab_institutions_net_value,
 *   foreign_buys_value, foreign_sells_value, foreign_net_value,
 *   total_buys_value, total_sells_value, number_of_trades
 *
 * لا يستخدم Python backend — كل البيانات من SQLite.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getDataEngineDb } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function tableExists(db: { prepare: (s: string) => { get: (...p: unknown[]) => Record<string, unknown> | undefined } }, tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .get(tableName) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function safeNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface InvestorsRow {
  date: string | null;
  session_type: string | null;
  individuals_buys_value: number | null;
  individuals_sells_value: number | null;
  individuals_net_value: number | null;
  arab_institutions_buys_value: number | null;
  arab_institutions_sells_value: number | null;
  arab_institutions_net_value: number | null;
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
    arab_institutions_buys_value: safeNum(r.arab_institutions_buys_value ?? r.arab_buys),
    arab_institutions_sells_value: safeNum(r.arab_institutions_sells_value ?? r.arab_sells),
    arab_institutions_net_value: safeNum(r.arab_institutions_net_value ?? r.arab_net),
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
    if (r.arab_institutions_net_value != null) { arabSum += r.arab_institutions_net_value; arabCnt++; }
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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const latest = url.searchParams.get('latest') === 'true';
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10) || 30));
    const limit = latest ? 1 : days;

    // 1) stocks.db.investors_data
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    let source = 'none';
    let rawRows: Record<string, unknown>[] = [];

    if (dbExists(stocksDbPath)) {
      try {
        const db = await getFinanceDb();
        if (tableExists(db, 'investors_data')) {
          rawRows = db.prepare(
            'SELECT * FROM investors_data ORDER BY date DESC LIMIT ?'
          ).all(limit) as Record<string, unknown>[];
          source = 'stocks.db.investors_data';
        }
      } catch (e) {
        console.warn('[egx/investors] stocks.db query failed:', e);
      }
    }

    // 2) data_engine.db.investors_data fallback
    if (rawRows.length === 0) {
      try {
        const deDb = getDataEngineDb();
        if (tableExists(deDb as unknown as { prepare: (s: string) => { get: (...p: unknown[]) => Record<string, unknown> | undefined } }, 'investors_data')) {
          rawRows = deDb.prepare(
            'SELECT * FROM investors_data ORDER BY date DESC LIMIT ?'
          ).all(limit) as Record<string, unknown>[];
          source = 'data_engine.db.investors_data';
        }
      } catch (e) {
        console.warn('[egx/investors] data_engine.db query failed:', e);
      }
    }

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
        note: 'investors_data table not found in stocks.db or data_engine.db',
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
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/egx/investors] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
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
