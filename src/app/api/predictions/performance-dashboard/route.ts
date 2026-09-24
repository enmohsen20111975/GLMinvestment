/**
 * GET /api/predictions/performance-dashboard
 * ===========================================
 * Flutter compat endpoint — dashboard أداء التوقعات.
 *
 * Query:
 *   ?days=30     (default, max 365)
 *   ?market=EGX  (default; 'all' يجيب كل الأسواق)
 *
 * يحسب من predictions.db.predictions:
 *   - total / wins / losses / expired
 *   - win_rate = wins / (wins + losses)
 *   - avg_return (للـ resolved فقط)
 *   - best / worst ticker
 *   - by_market breakdown
 *   - by_signal breakdown (BUY / SELL / HOLD)
 *   - 30-day timeseries (لكل يوم: count, wins, losses, win_rate)
 *
 * نفس الـ pattern بتاع /api/predictions/dual-track/stats — بدون Python.
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

const WIN_STATUSES = new Set(['TARGET_HIT', 'closed_win', 'WIN', 'win']);
const LOSS_STATUSES = new Set(['closed_stop', 'STOPPED', 'LOSS', 'loss']);
const EXPIRED_STATUSES = new Set(['EXPIRED', 'expired', 'CLOSED']);

interface PredictionRow {
  ticker: string | null;
  signal: string | null;
  status: string | null;
  market: string | null;
  prediction_date: string | null;
  actual_return: number | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
}

interface Stats {
  total: number;
  resolved: number;
  wins: number;
  losses: number;
  expired: number;
  pending: number;
  win_rate: number;
  avg_return: number;
  avg_holding_days: number;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeStats(rows: PredictionRow[]): Stats {
  let wins = 0, losses = 0, expired = 0, pending = 0, total = 0;
  let returnsSum = 0, returnsCount = 0;
  let holdingDaysSum = 0, holdingDaysCount = 0;

  for (const r of rows) {
    total++;
    const status = String(r.status || '').trim();
    const ret = safeNum(r.actual_return);
    if (ret !== 0) {
      returnsSum += ret;
      returnsCount++;
    }
    if (WIN_STATUSES.has(status)) wins++;
    else if (LOSS_STATUSES.has(status)) losses++;
    else if (EXPIRED_STATUSES.has(status)) expired++;
    else pending++;
  }

  const resolved = wins + losses;
  return {
    total,
    resolved,
    wins,
    losses,
    expired,
    pending,
    win_rate: resolved > 0 ? Math.round((wins / resolved) * 10000) / 100 : 0,
    avg_return: returnsCount > 0 ? Math.round((returnsSum / returnsCount) * 10000) / 10000 : 0,
    avg_holding_days: holdingDaysCount > 0 ? Math.round(holdingDaysSum / holdingDaysCount) : 0,
  };
}

function computeByMarket(rows: PredictionRow[]) {
  const map = new Map<string, { total: number; wins: number; losses: number; expired: number; returnsSum: number; returnsCount: number }>();
  for (const r of rows) {
    const m = String(r.market || 'unknown');
    const entry = map.get(m) || { total: 0, wins: 0, losses: 0, expired: 0, returnsSum: 0, returnsCount: 0 };
    entry.total++;
    const status = String(r.status || '').trim();
    const ret = safeNum(r.actual_return);
    if (ret !== 0) {
      entry.returnsSum += ret;
      entry.returnsCount++;
    }
    if (WIN_STATUSES.has(status)) entry.wins++;
    else if (LOSS_STATUSES.has(status)) entry.losses++;
    else if (EXPIRED_STATUSES.has(status)) entry.expired++;
    map.set(m, entry);
  }
  return Array.from(map.entries()).map(([market, e]) => ({
    market,
    total: e.total,
    wins: e.wins,
    losses: e.losses,
    expired: e.expired,
    win_rate: (e.wins + e.losses) > 0 ? Math.round((e.wins / (e.wins + e.losses)) * 10000) / 100 : 0,
    avg_return: e.returnsCount > 0 ? Math.round((e.returnsSum / e.returnsCount) * 10000) / 10000 : 0,
  }));
}

function computeBySignal(rows: PredictionRow[]) {
  const map = new Map<string, { total: number; wins: number; losses: number; expired: number; returnsSum: number; returnsCount: number }>();
  for (const r of rows) {
    const sig = String(r.signal || r.signal_type || 'unknown');
    const entry = map.get(sig) || { total: 0, wins: 0, losses: 0, expired: 0, returnsSum: 0, returnsCount: 0 };
    entry.total++;
    const status = String(r.status || '').trim();
    const ret = safeNum(r.actual_return);
    if (ret !== 0) {
      entry.returnsSum += ret;
      entry.returnsCount++;
    }
    if (WIN_STATUSES.has(status)) entry.wins++;
    else if (LOSS_STATUSES.has(status)) entry.losses++;
    else if (EXPIRED_STATUSES.has(status)) entry.expired++;
    map.set(sig, entry);
  }
  return Array.from(map.entries()).map(([signal, e]) => ({
    signal,
    total: e.total,
    wins: e.wins,
    losses: e.losses,
    expired: e.expired,
    win_rate: (e.wins + e.losses) > 0 ? Math.round((e.wins / (e.wins + e.losses)) * 10000) / 100 : 0,
    avg_return: e.returnsCount > 0 ? Math.round((e.returnsSum / e.returnsCount) * 10000) / 10000 : 0,
  }));
}

function computeTopTickers(rows: PredictionRow[], limit: number) {
  const map = new Map<string, { total: number; wins: number; losses: number; returnsSum: number; returnsCount: number }>();
  for (const r of rows) {
    if (!r.ticker) continue;
    const entry = map.get(r.ticker) || { total: 0, wins: 0, losses: 0, returnsSum: 0, returnsCount: 0 };
    entry.total++;
    const status = String(r.status || '').trim();
    const ret = safeNum(r.actual_return);
    if (ret !== 0) {
      entry.returnsSum += ret;
      entry.returnsCount++;
    }
    if (WIN_STATUSES.has(status)) entry.wins++;
    else if (LOSS_STATUSES.has(status)) entry.losses++;
    map.set(r.ticker, entry);
  }
  return Array.from(map.entries())
    .map(([ticker, e]) => ({
      ticker,
      total: e.total,
      wins: e.wins,
      losses: e.losses,
      win_rate: (e.wins + e.losses) > 0 ? Math.round((e.wins / (e.wins + e.losses)) * 10000) / 100 : 0,
      avg_return: e.returnsCount > 0 ? Math.round((e.returnsSum / e.returnsCount) * 10000) / 10000 : 0,
    }))
    .filter(t => t.total >= 3)
    .sort((a, b) => b.wins - a.wins || b.win_rate - a.win_rate)
    .slice(0, limit);
}

function computeTimeseries(rows: PredictionRow[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const map = new Map<string, { total: number; wins: number; losses: number; expired: number }>();
  for (const r of rows) {
    if (!r.prediction_date) continue;
    const d = String(r.prediction_date).slice(0, 10);
    if (d < cutoffStr) continue;
    const entry = map.get(d) || { total: 0, wins: 0, losses: 0, expired: 0 };
    entry.total++;
    const status = String(r.status || '').trim();
    if (WIN_STATUSES.has(status)) entry.wins++;
    else if (LOSS_STATUSES.has(status)) entry.losses++;
    else if (EXPIRED_STATUSES.has(status)) entry.expired++;
    map.set(d, entry);
  }
  return Array.from(map.entries())
    .map(([date, e]) => ({
      date,
      total: e.total,
      wins: e.wins,
      losses: e.losses,
      expired: e.expired,
      win_rate: (e.wins + e.losses) > 0 ? Math.round((e.wins / (e.wins + e.losses)) * 10000) / 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(req: NextRequest) {
  if (!dbExists(PREDICTIONS_DB_PATH)) {
    return NextResponse.json({
      success: false,
      error: 'predictions.db not found',
      path: PREDICTIONS_DB_PATH,
      stats: { total: 0, resolved: 0, wins: 0, losses: 0, expired: 0, pending: 0, win_rate: 0, avg_return: 0, avg_holding_days: 0 },
      by_market: [],
      by_signal: [],
      top_tickers: [],
      timeseries: [],
    });
  }

  try {
    const url = new URL(req.url);
    const market = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10) || 30));

    const db = openDb(PREDICTIONS_DB_PATH);

    // فلتر التاريخ (آخر N يوم)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    let rows: PredictionRow[];
    try {
      if (market === 'ALL' || market === '') {
        rows = db.prepare(`
          SELECT ticker, signal, status, market, prediction_date, actual_return, entry_price, target_price, stop_loss
          FROM predictions
          WHERE prediction_date IS NOT NULL AND prediction_date >= ?
          ORDER BY prediction_date DESC
          LIMIT 5000
        `).all(cutoffStr) as PredictionRow[];
      } else {
        rows = db.prepare(`
          SELECT ticker, signal, status, market, prediction_date, actual_return, entry_price, target_price, stop_loss
          FROM predictions
          WHERE (market = ? OR market IS NULL)
            AND prediction_date IS NOT NULL AND prediction_date >= ?
          ORDER BY prediction_date DESC
          LIMIT 5000
        `).all(market, cutoffStr) as PredictionRow[];
      }
    } catch (queryErr) {
      // ممكن الـ column اسمه signal_type بدلاً من signal
      try {
        rows = db.prepare(`
          SELECT ticker, signal_type AS signal, status, market, prediction_date, actual_return, entry_price, target_price, stop_loss
          FROM predictions
          WHERE (market = ? OR market IS NULL)
            AND prediction_date IS NOT NULL AND prediction_date >= ?
          ORDER BY prediction_date DESC
          LIMIT 5000
        `).all(market, cutoffStr) as PredictionRow[];
      } catch (err2) {
        db.close();
        return NextResponse.json({
          success: false,
          error: 'predictions table query failed: ' + String(err2),
          market,
          days,
        }, { status: 500 });
      }
    }
    db.close();

    const stats = computeStats(rows);
    const byMarket = computeByMarket(rows);
    const bySignal = computeBySignal(rows);
    const topTickers = computeTopTickers(rows, 10);
    const timeseries = computeTimeseries(rows, days);

    return NextResponse.json({
      success: true,
      market,
      days,
      filter: {
        days,
        market,
        cutoff_date: cutoffStr,
      },
      stats,
      by_market: byMarket,
      by_signal: bySignal,
      top_tickers: topTickers,
      timeseries,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/predictions/performance-dashboard] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        stats: { total: 0, resolved: 0, wins: 0, losses: 0, expired: 0, pending: 0, win_rate: 0, avg_return: 0, avg_holding_days: 0 },
        by_market: [],
        by_signal: [],
        top_tickers: [],
        timeseries: [],
      },
      { status: 500 }
    );
  }
}
