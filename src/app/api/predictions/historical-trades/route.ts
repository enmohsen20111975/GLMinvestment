/**
 * Historical Trades API (P1-GEMS-WIRING)
 * ======================================
 * Reads from predictions.db.historical_trades (13,117 rows).
 *
 * Each row is one completed backtest trade from the prediction engine's
 * simulation pass. Fields:
 *
 *   - id                : row id
 *   - ticker            : symbol traded (may be empty for aggregate strategies)
 *   - strategy          : strategy slug (support_bounce, momentum_breakout, ...)
 *   - buy_date          : ISO date
 *   - buy_price         : entry price
 *   - sell_date         : ISO date (nullable if still open)
 *   - sell_price        : exit price
 *   - pnl_pct           : profit/loss percentage (mapped to `return_pct` in response)
 *   - holding_days      : position duration
 *   - outcome           : WIN / LOSS / BREAKEVEN (mapped to `exit_reason` in response)
 *   - pattern_type, market_condition, rsi_at_buy, volume_ratio_at_buy, lesson_text
 *
 * GET /api/predictions/historical-trades?limit=100&ticker=X&strategy=Y
 *   → { success, total, trades: [{ id, ticker, buy_date, sell_date, buy_price,
 *                                  sell_price, return_pct, exit_reason, ... }] }
 *
 * Query params:
 *   - limit     (default 100, max 1000)
 *   - offset    (default 0, for pagination)
 *   - ticker    (LIKE substring filter, optional)
 *   - strategy  (exact match filter, optional)
 *   - outcome   (WIN|LOSS|BREAKEVEN, optional)
 *   - sort       (buy_date|pnl_pct|holding_days — default buy_date DESC)
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';

type SqlRow = Record<string, unknown>;

const SORTABLE = new Set(['buy_date', 'pnl_pct', 'holding_days', 'sell_date']);

function openDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  try {
    return new Database(dbPath, { readonly: true, timeout: 3000 });
  } catch { // silent fallback (safe-by-design)
    return new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const ticker = url.searchParams.get('ticker');
  const strategy = url.searchParams.get('strategy');
  const outcome = url.searchParams.get('outcome');
  const sortParam = url.searchParams.get('sort') || 'buy_date';

  // PAYWALL Phase 2 — Gate 4 (P0-4, Historical Trades):
  //   Per PAYWALL-STRATEGY-FINAL.md §5.2 row 5 — the full trade table
  //   (13k+ rows of backtested trades) is a Premium feature. Free users
  //   whose trial has expired see the summary card only (total count +
  //   aggregate stats). The `trades` array is stripped.
  //   - Anonymous (no session) → full data (taste hook per §4 — seeing
  //     the trade history being populated is the marketing teaser).
  //   - Authenticated + paid OR within 14-day trial → full data.
  //   - Authenticated + free + trial expired → summary only
  //     (`trades: []` + `trades_locked: true` + summary stats).
  //   Per Rule 50 — backtest insights are not safety.
  const { userId } = await getSessionUserId();
  let tradesLocked = false;
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) tradesLocked = true;
  }

  let limit = 100;
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (Number.isFinite(n)) limit = Math.min(1000, Math.max(1, n));
  }
  let offset = 0;
  if (offsetParam) {
    const n = parseInt(offsetParam, 10);
    if (Number.isFinite(n)) offset = Math.max(0, n);
  }
  const sort = SORTABLE.has(sortParam) ? sortParam : 'buy_date';

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (ticker) {
    where.push('ticker LIKE ?');
    params.push(`%${ticker}%`);
  }
  if (strategy) {
    where.push('strategy = ?');
    params.push(strategy);
  }
  if (outcome === 'WIN' || outcome === 'LOSS' || outcome === 'BREAKEVEN') {
    where.push('outcome = ?');
    params.push(outcome);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const db = openDb();
  try {
    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM historical_trades ${whereSql}`,
    ).get(...params) as SqlRow).n as number;

    // ── PAYWALL Phase 2 — Gate 4: locked users get summary only ─────
    // For locked users we skip the per-row SELECT entirely (saves the
    // 13k-row scan + transfer) and compute a compact summary card so
    // the UI can still render the header (total / win-rate / avg pnl /
    // avg holding days / strategy breakdown).
    if (tradesLocked) {
      const summary = db.prepare(
        `SELECT
           COUNT(*)                                       AS total,
           SUM(CASE WHEN outcome = 'WIN'     THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN outcome = 'LOSS'    THEN 1 ELSE 0 END) AS losses,
           COALESCE(AVG(pnl_pct),        0)                 AS avg_pnl_pct,
           COALESCE(AVG(holding_days),   0)                 AS avg_holding_days
         FROM historical_trades ${whereSql}`,
      ).get(...params) as SqlRow;

      const distinctStrategiesLocked = db.prepare(
        `SELECT DISTINCT strategy FROM historical_trades
         WHERE strategy IS NOT NULL AND strategy != ''
         ORDER BY strategy ASC LIMIT 100`,
      ).all() as { strategy: string }[];

      const winsNum = Number(summary.wins ?? 0);
      const lossesNum = Number(summary.losses ?? 0);
      const verified = winsNum + lossesNum;
      const winRatePct = verified > 0
        ? Math.round((winsNum / verified) * 1000) / 10
        : 0;

      return NextResponse.json({
        success: true,
        total,
        returned: 0,
        offset,
        filters: { limit, offset, ticker: ticker || null, strategy: strategy || null, outcome: outcome || null, sort },
        strategies: distinctStrategiesLocked.map((r) => r.strategy),
        trades: [],
        trades_locked: true,
        upgradeUrl: '/pricing',
        summary: {
          total,
          wins: winsNum,
          losses: lossesNum,
          win_rate_pct: winRatePct,
          avg_pnl_pct: Math.round(Number(summary.avg_pnl_pct ?? 0) * 100) / 100,
          avg_holding_days: Math.round(Number(summary.avg_holding_days ?? 0) * 10) / 10,
        },
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const rows = db.prepare(
      `SELECT
         id,
         ticker,
         strategy,
         buy_date,
         buy_price,
         sell_date,
         sell_price,
         pnl_pct     AS return_pct,
         holding_days,
         outcome     AS exit_reason,
         pattern_type,
         market_condition,
         rsi_at_buy,
         volume_ratio_at_buy,
         lesson_text,
         fed_to_ai,
         created_at
       FROM historical_trades
       ${whereSql}
       ORDER BY ${sort} DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as SqlRow[];

    // Distinct strategies for the dropdown filter
    const distinctStrategies = db.prepare(
      `SELECT DISTINCT strategy FROM historical_trades
       WHERE strategy IS NOT NULL AND strategy != ''
       ORDER BY strategy ASC LIMIT 100`,
    ).all() as { strategy: string }[];

    return NextResponse.json({
      success: true,
      total,
      returned: rows.length,
      offset,
      filters: { limit, offset, ticker: ticker || null, strategy: strategy || null, outcome: outcome || null, sort },
      strategies: distinctStrategies.map((r) => r.strategy),
      trades: rows,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[predictions:historical-trades]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 },
    );
  } finally {
    db.close();
  }
}
