/**
 * GET /api/predictions/dual-track/stats
 * ======================================
 * المرحلة 4 — Dual-Track Outcome Tracker (combined efficiency)
 *
 * يحسب win_rate منفصل لكل مسار (Track A: full_analysis / Track B: liquidity)
 * + combined_efficiency للمنصة كلها.
 *
 * كفاءة المنصة = (نجاح A × 0.4) + (نجاح B × 0.6)
 * المسار B يأخذ وزن أعلى لأن إشاراته أندر وأقوى.
 *
 * كمان بيرجع:
 *   - hit_rate لكل سوق
 *   - top performing tickers
 *   - dynamic_threshold لكل سوق
 *   - backtest_results من liquidity_backtest_results table
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PREDICTIONS_DB_PATH = `${process.cwd()}/db/predictions.db`;
const fs = require('fs');

function dbExists(path: string): boolean {
  try {
    return fs.existsSync(path) && fs.statSync(path).size > 0;
  } catch {
    return false;
  }
}

function openDb(path: string, readonly = true): any {
  const Database = require('better-sqlite3');
  return new Database(path, { readonly });
}

const WIN_STATUSES = new Set(['TARGET_HIT', 'closed_win']);
const LOSS_STATUSES = new Set(['closed_stop', 'STOPPED']);
const EXPIRED_STATUSES = new Set(['EXPIRED', 'expired', 'CLOSED']);

interface TrackStats {
  track: string;
  total: number;
  resolved: number;
  wins: number;
  losses: number;
  expired: number;
  hit_rate: number;
  avg_return: number;
  weight: number;
}

function ensureTrackColumn(db: any): void {
  try {
    const cols = (db.prepare('PRAGMA table_info(predictions)').all() as any[]).map(c => c.name);
    if (!cols.includes('track')) {
      db.prepare("ALTER TABLE predictions ADD COLUMN track TEXT DEFAULT 'full_analysis'").run();
    }
  } catch (e) {
    console.warn('[ensureTrackColumn]', e);
  }
}

function calculateTrackStats(db: any, track: string, weight: number): TrackStats {
  let query = `
    SELECT status, actual_return FROM predictions
    WHERE market IS NOT NULL
  `;
  const params: any[] = [];
  if (track === 'full_analysis') {
    query += ` AND (track IS NULL OR track = '' OR track = 'full_analysis')`;
  } else {
    query += ` AND track = ?`;
    params.push(track);
  }

  const rows = db.prepare(query).all(...params) as any[];
  let wins = 0, losses = 0, expired = 0, total = 0;
  let returnsSum = 0;
  let returnsCount = 0;

  for (const r of rows) {
    total++;
    const ret = Number(r.actual_return) || 0;
    if (ret !== 0) {
      returnsSum += ret;
      returnsCount++;
    }
    if (WIN_STATUSES.has(r.status)) wins++;
    else if (LOSS_STATUSES.has(r.status)) losses++;
    else if (EXPIRED_STATUSES.has(r.status)) expired++;
  }

  const resolved = wins + losses;
  return {
    track,
    total,
    resolved,
    wins,
    losses,
    expired,
    hit_rate: resolved > 0 ? Math.round((wins / resolved) * 10000) / 100 : 0,
    avg_return: returnsCount > 0 ? Math.round((returnsSum / returnsCount) * 10000) / 10000 : 0,
    weight,
  };
}

function getMarketStats(db: any): any[] {
  try {
    return db.prepare(`
      SELECT market,
             COUNT(*) as total,
             SUM(CASE WHEN status IN ('TARGET_HIT','closed_win') THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN status IN ('closed_stop','STOPPED') THEN 1 ELSE 0 END) as losses,
             SUM(CASE WHEN status IN ('EXPIRED','expired','CLOSED') THEN 1 ELSE 0 END) as expired,
             AVG(CASE WHEN actual_return IS NOT NULL AND actual_return != 0 THEN actual_return END) as avg_return
      FROM predictions
      WHERE market IS NOT NULL
      GROUP BY market
    `).all() as any[];
  } catch {
    return [];
  }
}

function getTopTickers(db: any, limit = 10): any[] {
  try {
    return db.prepare(`
      SELECT ticker, market,
             COUNT(*) as total,
             SUM(CASE WHEN status IN ('TARGET_HIT','closed_win') THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN status IN ('closed_stop','STOPPED') THEN 1 ELSE 0 END) as losses,
             AVG(CASE WHEN actual_return IS NOT NULL AND actual_return != 0 THEN actual_return END) as avg_return
      FROM predictions
      WHERE market IS NOT NULL AND ticker IS NOT NULL
      GROUP BY ticker, market
      HAVING total >= 5
      ORDER BY wins DESC, avg_return DESC
      LIMIT ?
    `).all(limit) as any[];
  } catch {
    return [];
  }
}

function getThresholds(db: any): any[] {
  try {
    return db.prepare(`
      SELECT market, threshold_date, threshold_value, sample_size, fallback_used
      FROM liquidity_dynamic_threshold
      WHERE (market, threshold_date) IN (
        SELECT market, MAX(threshold_date) FROM liquidity_dynamic_threshold GROUP BY market
      )
    `).all() as any[];
  } catch {
    return [];
  }
}

function getBacktestResults(db: any): any[] {
  try {
    return db.prepare(`
      SELECT market, ticker, total_signals, successful_signals, hit_rate,
             avg_return, qualified, dynamic_threshold, backtest_start, backtest_end
      FROM liquidity_backtest_results
      ORDER BY market
    `).all() as any[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  if (!dbExists(PREDICTIONS_DB_PATH)) {
    return NextResponse.json({
      success: false,
      error: 'predictions.db not found',
      dual_track: null,
      by_market: [],
      top_tickers: [],
      dynamic_thresholds: [],
      backtest_results: [],
    });
  }

  try {
    const db = openDb(PREDICTIONS_DB_PATH);
    ensureTrackColumn(db);

    const trackA = calculateTrackStats(db, 'full_analysis', 0.4);
    const trackB = calculateTrackStats(db, 'liquidity', 0.6);
    const combinedEfficiency = Math.round(
      ((trackA.hit_rate * 0.4) + (trackB.hit_rate * 0.6)) * 100
    ) / 100;

    const marketStats = getMarketStats(db);
    const topTickers = getTopTickers(db, 10);
    const thresholds = getThresholds(db);
    const backtestResults = getBacktestResults(db);

    db.close();

    return NextResponse.json({
      success: true,
      dual_track: {
        track_a: trackA,
        track_b: trackB,
        combined_efficiency: combinedEfficiency,
        formula: '(win_rate_A × 0.4) + (win_rate_B × 0.6)',
      },
      by_market: marketStats,
      top_tickers: topTickers,
      dynamic_thresholds: thresholds,
      backtest_results: backtestResults,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/predictions/dual-track/stats] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
