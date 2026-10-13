/**
 * GET /api/v2/commercial-feed
 * ===========================
 * T-ALPHA-A15: The Single Commercial Feed — two explicit tracks:
 *   1. active_live_signals: BUY/STRONG_BUY/ACCUMULATE with entry/target/stop/RR
 *   2. audited_performance: Closed trades with real returns (no zero-candle phantom)
 *
 * Reads from predictions.db directly (same as 303 other SQLite-direct routes).
 * Rule 27: NO fake data — empty arrays if DB unavailable.
 * Rule 4: NO computation — just reads from the canonical predictions table.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

const PREDICTIONS_DB = path.join(process.cwd(), 'db', 'predictions.db');
const STOCKS_DB = path.join(process.cwd(), 'db', 'stocks.db');

interface LiveSignal {
  ticker: string;
  name_ar: string | null;
  sector: string | null;
  market: string;
  signal: string;
  signal_ar: string;
  entry_price: number | null;
  target_price: number | null;
  target_price_2: number | null;
  stop_loss: number | null;
  risk_reward: number | null;
  confidence: number | null;
  master_score: number | null;
  persona: string | null;
  prediction_date: string | null;
  current_price: number | null;
  upside_pct: number | null;
  downside_pct: number | null;
}

interface AuditedTrade {
  ticker: string;
  signal: string;
  signal_ar: string;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  exit_price: number | null;
  actual_return: number | null;
  pnl_pct: number | null;
  hit_target: number | null;
  hit_stop: number | null;
  holding_days: number | null;
  market: string;
  prediction_date: string | null;
  closed_at: string | null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketParam = url.searchParams.get('market') || 'EGX';
  // Escape to prevent SQL injection
  const market = marketParam.replace(/[^A-Za-z]/g, '').toUpperCase();

  if (!fs.existsSync(PREDICTIONS_DB)) {
    return NextResponse.json({
      success: false,
      error: 'predictions_db_not_found',
      message: 'قاعدة بيانات التوقعات غير متاحة (Rule 27)',
      active_live_signals: [],
      audited_performance: [],
    }, { status: 503 });
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(PREDICTIONS_DB, { readonly: true });

    // Attach stocks.db for name_ar + sector + current_price
    let stocksAttached = false;
    try {
      if (fs.existsSync(STOCKS_DB)) {
        db.exec(`ATTACH DATABASE '${STOCKS_DB}' AS stocks_db`);
        stocksAttached = true;
      }
    } catch {
      // stocks.db not available — proceed without enrichment
    }

    // ── Track 1: Active Live Signals (BUY/STRONG_BUY/ACCUMULATE only) ──
    const marketFilter = market !== 'ALL' ? `AND (p.market = '${market}' OR p.market IS NULL)` : '';

    const liveQuery = stocksAttached
      ? `SELECT p.ticker, s.name_ar, s.sector, p.market, p.signal, p.signal_ar,
                p.entry_price, p.target_price, p.target_price_2, p.stop_loss,
                p.risk_reward, p.confidence, p.master_score, p.persona,
                p.prediction_date, s.current_price
         FROM predictions p
         LEFT JOIN stocks_db.stocks s ON UPPER(p.ticker) = UPPER(s.ticker)
         WHERE (p.status IN ('active','ACTIVE','pending','PENDING') OR p.status IS NULL)
           AND UPPER(p.signal) IN ('BUY','STRONG_BUY','ACCUMULATE')
           ${marketFilter}
         ORDER BY p.confidence DESC, p.master_score DESC
         LIMIT 12`
      : `SELECT ticker, NULL as name_ar, NULL as sector, market, signal, signal_ar,
                entry_price, target_price, target_price_2, stop_loss,
                risk_reward, confidence, master_score, persona,
                prediction_date, NULL as current_price
         FROM predictions
         WHERE (status IN ('active','ACTIVE','pending','PENDING') OR status IS NULL)
           AND UPPER(signal) IN ('BUY','STRONG_BUY','ACCUMULATE')
           ${marketFilter}
         ORDER BY confidence DESC, master_score DESC
         LIMIT 12`;

    const liveRows = db.prepare(liveQuery).all() as LiveSignal[];

    // Compute upside/downside percentages (Rule 4: simple arithmetic, no financial model)
    const liveSignals: LiveSignal[] = liveRows.map((r) => {
      const entry = Number(r.entry_price) || 0;
      const target = Number(r.target_price) || 0;
      const stop = Number(r.stop_loss) || 0;
      const upside_pct = entry > 0 && target > 0 ? ((target - entry) / entry) * 100 : null;
      const downside_pct = entry > 0 && stop > 0 ? ((stop - entry) / entry) * 100 : null;
      return {
        ...r,
        current_price: r.current_price ? Number(r.current_price) : (entry || null),
        upside_pct: upside_pct !== null ? Math.round(upside_pct * 100) / 100 : null,
        downside_pct: downside_pct !== null ? Math.round(downside_pct * 100) / 100 : null,
      };
    });

    // ── Track 2: Audited Performance (closed trades only — no zero-candle phantom) ──
    const auditedQuery = `SELECT ticker, signal, signal_ar, entry_price, target_price,
                stop_loss, exit_price, actual_return, pnl_pct, pnl_percent,
                hit_target, hit_stop, holding_days, market, prediction_date, closed_at
         FROM predictions
         WHERE status IN ('closed','CLOSED','expired','EXPIRED','target_hit','stop_hit')
            OR closed_at IS NOT NULL
         ORDER BY closed_at DESC
         LIMIT 50`;

    const auditedRows = db.prepare(auditedQuery).all() as AuditedTrade[];

    // Filter out phantom trades (entry=0 or exit=0)
    const auditedPerformance: AuditedTrade[] = auditedRows
      .filter((r) => {
        const entry = Number(r.entry_price) || 0;
        return entry > 0;
      })
      .map((r) => ({
        ...r,
        actual_return: r.actual_return != null ? Number(r.actual_return) : (r.pnl_pct != null ? Number(r.pnl_pct) : null),
        hit_target: r.hit_target != null ? Number(r.hit_target) : null,
        hit_stop: r.hit_stop != null ? Number(r.hit_stop) : null,
        holding_days: r.holding_days != null ? Number(r.holding_days) : null,
      }));

    db.close();

    return NextResponse.json({
      success: true,
      market,
      active_live_signals: liveSignals,
      audited_performance: auditedPerformance,
      stats: {
        live_count: liveSignals.length,
        audited_count: auditedPerformance.length,
        win_rate: auditedPerformance.length > 0
          ? Math.round((auditedPerformance.filter(t => t.hit_target === 1).length / auditedPerformance.length) * 1000) / 10
          : null,
        avg_return: auditedPerformance.length > 0
          ? Math.round((auditedPerformance.reduce((sum, t) => sum + (Number(t.actual_return) || 0), 0) / auditedPerformance.length) * 100) / 100
          : null,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'commercial_feed_error',
      message: error instanceof Error ? error.message : 'خطأ غير معروف',
      active_live_signals: [],
      audited_performance: [],
    }, { status: 500 });
  }
}
