/**
 * GET /api/predictions/backtest-list
 * ==================================
 * آخر 100 توقّع للباك تست — قائمة خامّة للعرض في جدول.
 *
 * Query:
 *   ?market=EGX     (default; EGX | CRYPTO | ALL)
 *
 * Returns predictions ordered by prediction_date DESC:
 *   ticker, signal, status, market, prediction_date,
 *   entry_price, target_price, stop_loss, exit_price,
 *   actual_return, holding_days, risk_reward, is_correct
 *
 * Reads from db/predictions.db.predictions (better-sqlite3, readonly).
 * NO mock data — كل صف من SQLite فعلي.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

const PREDICTIONS_DB_PATH = path.join(process.cwd(), 'db', 'predictions.db');

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function openDb(p: string): any {
  const Database = require('better-sqlite3');
  return new Database(p, { readonly: true });
}

interface BacktestRow {
  id: number;
  ticker: string;
  signal: string | null;
  status: string | null;
  market: string | null;
  prediction_date: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  exit_price: number | null;
  actual_return: number | null;
  holding_days: number;
  risk_reward: number | null;
  is_correct: number | null;
}

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  if (!dbExists(PREDICTIONS_DB_PATH)) {
    return NextResponse.json({
      success: false,
      error: 'predictions.db not found',
      path: PREDICTIONS_DB_PATH,
      predictions: [],
    }, { status: 500 });
  }

  try {
    const url = new URL(req.url);
    const marketParam = (url.searchParams.get('market') || 'EGX').toUpperCase().trim();
    const market = ['EGX', 'CRYPTO', 'ALL'].includes(marketParam) ? marketParam : 'EGX';

    const db = openDb(PREDICTIONS_DB_PATH);

    let rows: BacktestRow[];
    try {
      if (market === 'ALL') {
        rows = db.prepare(`
          SELECT id, ticker, signal, status, market, prediction_date,
                 entry_price, target_price, stop_loss, exit_price,
                 actual_return, holding_days, risk_reward, is_correct
          FROM predictions
          WHERE prediction_date IS NOT NULL
          ORDER BY prediction_date DESC
          LIMIT 100
        `).all() as BacktestRow[];
      } else {
        rows = db.prepare(`
          SELECT id, ticker, signal, status, market, prediction_date,
                 entry_price, target_price, stop_loss, exit_price,
                 actual_return, holding_days, risk_reward, is_correct
          FROM predictions
          WHERE prediction_date IS NOT NULL
            AND (market = ? OR market IS NULL)
          ORDER BY prediction_date DESC
          LIMIT 100
        `).all(market) as BacktestRow[];
      }
    } catch (queryErr) {
      // الـ column اسمه ممكن signal_type بدلاً من signal
      try {
        if (market === 'ALL') {
          rows = db.prepare(`
            SELECT id, ticker, signal_type AS signal, status, market, prediction_date,
                   entry_price, target_price, stop_loss, exit_price,
                   actual_return, holding_days, risk_reward, is_correct
            FROM predictions
            WHERE prediction_date IS NOT NULL
            ORDER BY prediction_date DESC
            LIMIT 100
          `).all() as BacktestRow[];
        } else {
          rows = db.prepare(`
            SELECT id, ticker, signal_type AS signal, status, market, prediction_date,
                   entry_price, target_price, stop_loss, exit_price,
                   actual_return, holding_days, risk_reward, is_correct
            FROM predictions
            WHERE prediction_date IS NOT NULL
              AND (market = ? OR market IS NULL)
            ORDER BY prediction_date DESC
            LIMIT 100
          `).all(market) as BacktestRow[];
        }
      } catch (err2) {
        db.close();
        return NextResponse.json({
          success: false,
          error: 'predictions table query failed: ' + String(err2),
          market,
          predictions: [],
        }, { status: 500 });
      }
    }

    db.close();

    const cleaned = rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      signal: r.signal || '—',
      status: r.status || 'unknown',
      market: r.market || market,
      prediction_date: r.prediction_date,
      entry_price: safeNum(r.entry_price),
      target_price: safeNum(r.target_price),
      stop_loss: safeNum(r.stop_loss),
      exit_price: safeNum(r.exit_price),
      actual_return: safeNum(r.actual_return),
      holding_days: Number(r.holding_days) || 0,
      risk_reward: safeNum(r.risk_reward),
      is_correct: r.is_correct === 1 ? true : r.is_correct === 0 ? false : null,
    }));

    return NextResponse.json({
      success: true,
      market,
      count: cleaned.length,
      predictions: cleaned,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/predictions/backtest-list] Error:', e);
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      predictions: [],
    }, { status: 500 });
  }
}
