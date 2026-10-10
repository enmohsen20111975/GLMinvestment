/**
 * GET /api/portfolio/equity-curve
 * =================================
 * Task 5 (Live Portfolio Overhaul): Returns daily portfolio value snapshots
 * for charting the equity curve / wealth tracking.
 *
 * Reads from the `wealth_tracking` table (auto-created if missing).
 * If no history exists yet, returns a single-point snapshot computed from
 * the current portfolio_assets live values.
 *
 * Query params:
 *   days  — number of days to look back (default 30)
 *
 * Returns: { success, days, snapshots: [{date, total_value, total_invested,
 *           total_pnl, stocks_value, gold_value, crypto_value, bank_value,
 *           cash_value}], current: {...}, trend_color, total_change_pct }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

const WEALTH_TRACKING_DDL = `
  CREATE TABLE IF NOT EXISTS wealth_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    snapshot_date TEXT NOT NULL,
    total_invested REAL DEFAULT 0,
    total_current_value REAL DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    total_pnl_pct REAL DEFAULT 0,
    stocks_value REAL DEFAULT 0,
    gold_value REAL DEFAULT 0,
    crypto_value REAL DEFAULT 0,
    bank_value REAL DEFAULT 0,
    cash_value REAL DEFAULT 0,
    other_value REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, snapshot_date)
  )
`;

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const db = await getFinanceDb();
    // Ensure wealth_tracking table exists
    db.prepare(WEALTH_TRACKING_DDL).run();

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const daysClamped = Math.min(Math.max(days, 1), 365);

    // Query historical snapshots
    const rows = db.prepare(
      `SELECT snapshot_date, total_invested, total_current_value, total_pnl,
              total_pnl_pct, stocks_value, gold_value, crypto_value,
              bank_value, cash_value, other_value
       FROM wealth_tracking
       WHERE user_id = ? AND snapshot_date >= date('now', ?)
       ORDER BY snapshot_date ASC`
    ).all(userId, `-${daysClamped} days`) as any[];

    // Compute a live "current" snapshot from portfolio_assets so the chart
    // always shows the latest point even if the daily job hasn't run yet.
    const currentSnapshot = await computeLiveSnapshot(db, userId);

    // If we have history, append the live snapshot as the final point
    // (if it's newer than the last historical point).
    const snapshots: any[] = [...rows];
    if (currentSnapshot) {
      const todayStr = new Date().toISOString().split('T')[0];
      const lastDate = snapshots.length > 0
        ? snapshots[snapshots.length - 1].snapshot_date
        : null;
      if (!lastDate || lastDate < todayStr) {
        snapshots.push({
          snapshot_date: todayStr,
          ...currentSnapshot,
        });
      } else if (snapshots.length > 0) {
        // Update the last point with live values
        snapshots[snapshots.length - 1] = {
          ...snapshots[snapshots.length - 1],
          ...currentSnapshot,
          snapshot_date: lastDate,
        };
      }
    }

    // If still empty, return a single-point snapshot
    if (snapshots.length === 0 && currentSnapshot) {
      snapshots.push({
        snapshot_date: new Date().toISOString().split('T')[0],
        ...currentSnapshot,
      });
    }

    const firstVal = snapshots[0]?.total_current_value || 0;
    const lastVal = snapshots[snapshots.length - 1]?.total_current_value || 0;
    const totalChangePct = firstVal > 0
      ? Math.round(((lastVal - firstVal) / firstVal) * 10000) / 100
      : 0;

    return NextResponse.json({
      success: true,
      days: daysClamped,
      snapshots,
      current: currentSnapshot,
      first_val: Math.round(firstVal * 100) / 100,
      last_val: Math.round(lastVal * 100) / 100,
      trend_color: lastVal >= firstVal ? '#16a34a' : '#ef4444',
      total_change_pct: totalChangePct,
    });
  } catch (error) {
    console.error('[/api/portfolio/equity-curve] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'فشل في تحميل منحنى الثروة',
        snapshots: [],
        total_change_pct: 0,
      },
      { status: 500 }
    );
  }
}

/**
 * Computes a live snapshot of the portfolio by reading portfolio_assets
 * and summing current_value by type. This mirrors the logic in
 * /api/finance/calculate-values but is simplified for the equity curve.
 */
async function computeLiveSnapshot(db: any, userId: string): Promise<Record<string, number> | null> {
  try {
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'"
    ).get() as any;
    if (!tableCheck) return null;

    const assets = db.prepare(
      "SELECT type, total_invested, current_value FROM portfolio_assets WHERE user_id = ?"
    ).all(userId) as any[];

    if (!assets || assets.length === 0) return null;

    let totalInvested = 0;
    let totalCurrent = 0;
    const byType: Record<string, number> = {
      stocks: 0, gold: 0, crypto: 0, bank: 0, cash: 0, other: 0,
    };

    for (const a of assets) {
      const inv = Number(a.total_invested || 0);
      const cur = Number(a.current_value || 0);
      totalInvested += inv;
      totalCurrent += cur;
      const t = (a.type || 'other').toLowerCase();
      if (t === 'stock') byType.stocks += cur;
      else if (t === 'gold' || t === 'silver') byType.gold += cur;
      else if (t === 'crypto') byType.crypto += cur;
      else if (['bank', 'certificate', 'fund', 'deposit'].includes(t)) byType.bank += cur;
      else if (t === 'currency' || t === 'forex') byType.cash += cur;
      else byType.other += cur;
    }

    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    return {
      total_invested: Math.round(totalInvested * 100) / 100,
      total_current_value: Math.round(totalCurrent * 100) / 100,
      total_pnl: Math.round(totalPnl * 100) / 100,
      total_pnl_pct: Math.round(totalPnlPct * 100) / 100,
      stocks_value: Math.round(byType.stocks * 100) / 100,
      gold_value: Math.round(byType.gold * 100) / 100,
      crypto_value: Math.round(byType.crypto * 100) / 100,
      bank_value: Math.round(byType.bank * 100) / 100,
      cash_value: Math.round(byType.cash * 100) / 100,
      other_value: Math.round(byType.other * 100) / 100,
    };
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}
