/**
 * GET /api/predictions/dual-track/list
 * =====================================
 * المرحلة 3 — Dual-Track Predictions Reader
 *
 * يعرض التوقعات مقسّمة على المسارين:
 *   - track=full_analysis → المسار A (تحليل فني + مالي + سيولة متوازنة، ≤5 يومياً)
 *   - track=liquidity → المسار B (سيولة مؤسسية استثنائية، بلا حد)
 *   - track=all → كلا المسارين
 *
 * Query params:
 *   market — EGX (default) / US / KSA
 *   track  — all (default) / full_analysis / liquidity
 *   limit  — 50 (default, max 200)
 *   days   — 30 (default)
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

function ensureTrackColumn(db: any): void {
  // predictions table needs a track column (defaults to 'full_analysis')
  try {
    const cols = (db.prepare('PRAGMA table_info(predictions)').all() as any[]).map(c => c.name);
    if (!cols.includes('track')) {
      db.prepare("ALTER TABLE predictions ADD COLUMN track TEXT DEFAULT 'full_analysis'").run();
    }
  } catch (e) {
    console.warn('[ensureTrackColumn]', e);
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const market = url.searchParams.get('market') || 'EGX';
    const trackFilter = url.searchParams.get('track') || 'all';
    // Task 40-C (2026-10-04): Maximum 5 predictions per owner directive.
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '5', 10), 5);
    const days = parseInt(url.searchParams.get('days') || '30', 10);

    if (!dbExists(PREDICTIONS_DB_PATH)) {
      return NextResponse.json({
        success: false,
        error: 'predictions.db not found',
        predictions: [],
        threshold: null,
        summary: { total: 0, by_track: {} },
      });
    }

    // QA-FIX: open with readonly=false so ensureTrackColumn can ALTER TABLE
    const db = openDb(PREDICTIONS_DB_PATH, false);
    ensureTrackColumn(db);

    let trackClause = '';
    if (trackFilter === 'full_analysis') {
      trackClause = `AND (track IS NULL OR track = '' OR track = 'full_analysis')`;
    } else if (trackFilter === 'liquidity') {
      trackClause = `AND track = 'liquidity'`;
    }

    const rows = db.prepare(`
      SELECT id, ticker, signal, signal_type, prediction_date,
             entry_price, target_price, target_price_2, stop_loss,
             status, lifecycle_status, actual_return, hit_target, hit_stop, market,
             confidence, risk_reward, master_score,
             COALESCE(track, 'full_analysis') as track,
             notes
      FROM predictions
      WHERE market = ?
        AND prediction_date >= datetime('now', ?)
        ${trackClause}
      ORDER BY
        CASE WHEN lifecycle_status IN ('proven', 'testing') THEN 0
             WHEN hit_target = 1 THEN 1
             ELSE 2
        END,
        prediction_date DESC
      LIMIT ?
    `).all(market, `-${days} days`, limit) as any[];

    // Fetch dynamic threshold for the market
    let threshold: any = null;
    try {
      threshold = db.prepare(`
        SELECT market, threshold_date, threshold_value, sample_size, fallback_used
        FROM liquidity_dynamic_threshold
        WHERE market = ?
        ORDER BY threshold_date DESC
        LIMIT 1
      `).get(market) as any;
    } catch { /* table may not exist yet */ }

    // Group by track for summary
    // LIFECYCLE-MIGRATION: byTrack summary now uses `hit_target` / `hit_stop`
    // for win/loss and `lifecycle_status` for the active count. The legacy
    // string-status comparisons (WIN_STATUSES.has(r.status), etc.) are
    // replaced with direct column checks.
    const byTrack: any = {};
    for (const r of rows) {
      const t = r.track;
      if (!byTrack[t]) byTrack[t] = { total: 0, wins: 0, losses: 0, active: 0 };
      byTrack[t].total++;
      if (r.hit_target === 1) byTrack[t].wins++;
      else if (r.hit_stop === 1) byTrack[t].losses++;
      else if (r.lifecycle_status === 'proven' || r.lifecycle_status === 'testing') byTrack[t].active++;
    }

    db.close();

    return NextResponse.json({
      success: true,
      market,
      track_filter: trackFilter,
      predictions: rows.map(r => ({
        id: r.id,
        ticker: r.ticker,
        signal: r.signal,
        signal_type: r.signal_type,
        track: r.track,
        track_label: r.track === 'liquidity' ? '💧 تحليل سيولة' : '📊 تحليل كامل',
        prediction_date: r.prediction_date,
        entry_price: r.entry_price,
        target_price: r.target_price,
        target_price_2: r.target_price_2,
        stop_loss: r.stop_loss,
        status: r.status,
        lifecycle_status: r.lifecycle_status,
        actual_return: r.actual_return,
        hit_target: r.hit_target,
        hit_stop: r.hit_stop,
        confidence: r.confidence,
        risk_reward: r.risk_reward,
        master_score: r.master_score,
        market: r.market,
        notes: r.notes,
      })),
      threshold,
      summary: {
        total: rows.length,
        by_track: byTrack,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/predictions/dual-track/list] Error:', e);
    return NextResponse.json(
      { success: false, error: 'internal_error', predictions: [] },
      { status: 500 }
    );
  }
}
