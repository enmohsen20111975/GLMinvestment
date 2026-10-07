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
import type Database from 'better-sqlite3';

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

function openDb(path: string, readonly = true): Database.Database {
  const Database = require('better-sqlite3');
  return new Database(path, { readonly }) as Database.Database;
}

const WIN_STATUSES = new Set(['TARGET_HIT', 'closed_win']);
const LOSS_STATUSES = new Set(['closed_stop', 'STOPPED']);
const EXPIRED_STATUSES = new Set(['EXPIRED', 'expired', 'CLOSED']);

/** Generic SQL row returned by better-sqlite3. */
type SqlRow = Record<string, unknown>;

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

function ensureTrackColumn(db: Database.Database): void {
  try {
    const cols = (db.prepare('PRAGMA table_info(predictions)').all() as Array<SqlRow>).map(c => String(c.name));
    if (!cols.includes('track')) {
      db.prepare("ALTER TABLE predictions ADD COLUMN track TEXT DEFAULT 'full_analysis'").run();
    }
  } catch (e) {
    console.warn('[ensureTrackColumn]', e);
  }
}

function calculateTrackStats(db: Database.Database, track: string, weight: number): TrackStats {
  // CUMULATIVE-RETURN-FIX: استخدم actual_return للحساب، مش status بس
  // لأن كتير من التوقعات status='active' بس actual_return موجود (تم الإغلاق فعلاً)
  let query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN COALESCE(actual_return, 0) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN COALESCE(actual_return, 0) < 0 THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN actual_return IS NULL OR actual_return = 0 THEN 1 ELSE 0 END) as expired,
      SUM(CASE WHEN actual_return IS NOT NULL AND actual_return != 0 THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN actual_return IS NOT NULL AND actual_return != 0 THEN actual_return ELSE 0 END) as returns_sum,
      SUM(CASE WHEN actual_return IS NOT NULL AND actual_return != 0 THEN 1 ELSE 0 END) as returns_count
    FROM predictions
    WHERE market IS NOT NULL
  `;
  const params: Array<string> = [];
  if (track === 'full_analysis') {
    query += ` AND (track IS NULL OR track = '' OR track = 'full_analysis')`;
  } else {
    query += ` AND track = ?`;
    params.push(track);
  }

  const row = db.prepare(query).get(...params) as SqlRow;

  const total = Number(row?.total || 0);
  const wins = Number(row?.wins || 0);
  const losses = Number(row?.losses || 0);
  const expired = Number(row?.expired || 0);
  const resolved = Number(row?.resolved || 0);
  const returnsSum = Number(row?.returns_sum || 0);
  const returnsCount = Number(row?.returns_count || 0);

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

function getMarketStats(db: Database.Database): Array<SqlRow> {
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
    `).all() as Array<SqlRow>;
  } catch {
    return [];
  }
}

function getTopTickers(db: Database.Database, limit = 10): Array<SqlRow> {
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
    `).all(limit) as Array<SqlRow>;
  } catch {
    return [];
  }
}

function getThresholds(db: Database.Database): Array<SqlRow> {
  try {
    return db.prepare(`
      SELECT market, threshold_date, threshold_value, sample_size, fallback_used
      FROM liquidity_dynamic_threshold
      WHERE (market, threshold_date) IN (
        SELECT market, MAX(threshold_date) FROM liquidity_dynamic_threshold GROUP BY market
      )
    `).all() as Array<SqlRow>;
  } catch {
    return [];
  }
}

function getBacktestResults(db: Database.Database): Array<SqlRow> {
  try {
    return db.prepare(`
      SELECT market, ticker, total_signals, successful_signals, hit_rate,
             avg_return, qualified, dynamic_threshold, backtest_start, backtest_end
      FROM liquidity_backtest_results
      ORDER BY market
    `).all() as Array<SqlRow>;
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
    // QA-FIX: open with readonly=false so ensureTrackColumn can ALTER TABLE
    const db = openDb(PREDICTIONS_DB_PATH, false);
    ensureTrackColumn(db);

    const trackA = calculateTrackStats(db, 'full_analysis', 0.4);
    const trackB = calculateTrackStats(db, 'liquidity', 0.6);
    // CUMULATIVE-RETURN-FIX: hit_rate أصلاً في percentage form (0-100)
    // combined = (winA × 0.4) + (winB × 0.6) — كل القيم percentages
    const combinedEfficiency = Math.round(
      ((trackA.hit_rate * 0.4) + (trackB.hit_rate * 0.6)) * 100
    ) / 100;
    // hit_rate is already in percentage form (0-100), so the × 100 above
    // gives us 2 decimal places of precision (e.g., 14.15% → 1415 → /100 → 14.15)

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
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}
