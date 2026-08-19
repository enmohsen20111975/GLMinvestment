import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';
import { openDb } from '@/lib/shared-db';

export const dynamic = 'force-dynamic';

const EMPTY_LEDGER = {
  success: true as const,
  active_predictions: [] as unknown[],
  closed_predictions: [] as unknown[],
  win_rate: 0,
  total_signals: 0,
  wins: 0,
  losses: 0,
  live_alerts: [] as unknown[],
  message: 'لا توجد توقعات مسجلة بعد',
};

/**
 * GET /api/live-monitor/ledger
 * BRIEF-047: Prediction Ledger & Win Rate Dashboard
 * يرجع:
 *   - active_predictions: التوقعات الحالية
 *   - closed_predictions: التوقعات المقفولة
 *   - win_rate: نسبة نجاح المنصة
 *   - live_alerts: تنبيهات الـ Live Monitor
 *
 * Resilience: this endpoint MUST NEVER return 500. The entire body is
 * wrapped in a single try/catch — if stocks.db is missing, locked,
 * mid-checkpoint by the Python service, or doesn't have the
 * `prediction_logs` table, we return an empty-but-success response (200)
 * so the frontend's Live Monitor widget renders an empty state instead
 * of crashing the page.
 */
export async function GET() {
  try {
    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');

    if (!existsSync(dbPath)) {
      return NextResponse.json(EMPTY_LEDGER);
    }

    // Use the shared openDb helper (busy_timeout + readonly/immutable
    // fallback) so a locked WAL file doesn't crash the endpoint. We do NOT
    // pass `{ readonly: true }` — that property does not exist on OpenOptions
    // (only `writable` and `busyTimeoutMs` do) and was a no-op at runtime
    // that nonetheless tripped TypeScript's excess-property check. The
    // default behavior for a shared DB already tries read-write first (so
    // the WAL reconciles) then falls back to readonly + immutable snapshot.
    const db = openDb('stocks.db');
    db.pragma('busy_timeout = 5000');

    // Check if prediction_logs table exists
    const tableInfo = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_logs'"
    ).get() as { name: string } | undefined;

    if (!tableInfo) {
      return NextResponse.json(EMPTY_LEDGER);
    }

    // Active predictions (not yet verified)
    const activePredictions = db.prepare(`
      SELECT ticker, signal, master_score, entry_price, target_price,
             stop_loss, confidence, timestamp
      FROM prediction_logs
      WHERE outcome IS NULL OR outcome = ''
      ORDER BY timestamp DESC
      LIMIT 20
    `).all() as any[];

    // Closed predictions
    const closedPredictions = db.prepare(`
      SELECT ticker, signal, outcome, master_score, entry_price,
             target_price, stop_loss, confidence, timestamp, verified_at
      FROM prediction_logs
      WHERE outcome IS NOT NULL AND outcome != ''
      ORDER BY verified_at DESC
      LIMIT 50
    `).all() as any[];

    // Win rate calculation
    const total = closedPredictions.length;
    const wins = closedPredictions.filter(p =>
      p.outcome && String(p.outcome).toLowerCase().includes('win')
    ).length;
    const losses = closedPredictions.filter(p =>
      p.outcome && String(p.outcome).toLowerCase().includes('loss')
    ).length;
    const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

    // Live alerts (BRIEF-047)
    let liveAlerts: any[] = [];
    try {
      const alertsTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='live_alerts'"
      ).get() as { name: string } | undefined;
      if (alertsTable) {
        liveAlerts = db.prepare(`
          SELECT alert_type, ticker, message, severity, timestamp
          FROM live_alerts
          ORDER BY created_at DESC
          LIMIT 20
        `).all() as any[];
      }
    } catch {
      // live_alerts table might not exist yet
    }

    return NextResponse.json({
      success: true,
      active_predictions: activePredictions.map(p => ({
        ticker: p.ticker,
        signal: p.signal,
        score: p.master_score,
        entry: p.entry_price,
        target: p.target_price,
        stop: p.stop_loss,
        confidence: p.confidence,
        timestamp: p.timestamp,
      })),
      closed_predictions: closedPredictions.map(p => ({
        ticker: p.ticker,
        signal: p.signal,
        outcome: p.outcome,
        score: p.master_score,
        entry: p.entry_price,
        target: p.target_price,
        stop: p.stop_loss,
        confidence: p.confidence,
        timestamp: p.timestamp,
        verified_at: p.verified_at,
      })),
      win_rate: winRate,
      total_signals: total,
      wins,
      losses,
      live_alerts: liveAlerts,
    });
  } catch (error: any) {
    console.error('[/api/live-monitor/ledger] Error (returning EMPTY_LEDGER 200):', error);
    // NEVER return 500 from this endpoint. Any error (DB open failure, locked
    // WAL, missing table, schema mismatch, etc.) degrades to an empty 200
    // response so the frontend's Live Monitor widget renders an empty state
    // instead of crashing.
    return NextResponse.json(EMPTY_LEDGER);
  }
}
