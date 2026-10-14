/**
 * Historical Trades API (P1-GEMS-WIRING → P1-PREDICTIONS-CLUSTER)
 * ===============================================================
 * Phase 1 (P1-PREDICTIONS-CLUSTER): pure Python proxy — NO direct SQLite
 * access. This route previously opened `db/predictions.db` directly
 * (`new Database(...)`) and ran multiple `.prepare()` queries against the
 * `historical_trades` table. That violated Rule 4. Now it proxies to
 * `${PYTHON_BACKEND_URL}/api/predictions/historical-trades` and passes
 * the response through verbatim. If Python is unreachable → honest empty
 * (Rule 27 NO-FAKE-DATA).
 *
 * Response shape is preserved (success, total, returned, offset, filters,
 * strategies, trades, trades_locked, upgradeUrl, summary).
 *
 * PAYWALL Phase 2 — Gate 4 (P0-4, Historical Trades):
 *   Per PAYWALL-STRATEGY-FINAL.md §5.2 row 5 — the full trade table is a
 *   Premium feature. Free users whose trial has expired see the summary
 *   card only (`trades: []` + `trades_locked: true` + summary stats).
 *   - Anonymous (no session) → full data (taste hook per §4).
 *   - Authenticated + paid OR within 14-day trial → full data.
 *   - Authenticated + free + trial expired → summary only.
 *   Per Rule 50 — backtest insights are not safety.
 *
 * GET /api/predictions/historical-trades?limit=100&ticker=X&strategy=Y
 *   → { success, total, returned, offset, filters, strategies, trades }
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';

const SORTABLE = new Set(['buy_date', 'pnl_pct', 'holding_days', 'sell_date']);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const ticker = url.searchParams.get('ticker');
  const strategy = url.searchParams.get('strategy');
  const outcome = url.searchParams.get('outcome');
  const sortParam = url.searchParams.get('sort') || 'buy_date';

  // PAYWALL Phase 2 — Gate 4: compute lock state from session + trial.
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

  // Build query string for Python — forward all filters.
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sort,
  });
  if (ticker) qs.set('ticker', ticker);
  if (strategy) qs.set('strategy', strategy);
  if (outcome) qs.set('outcome', outcome);

  // Python canonical endpoints (primary + direct fallback).
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/predictions/historical-trades?${qs.toString()}`,
    `http://127.0.0.1:8010/api/predictions/historical-trades?${qs.toString()}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || data.success === false) continue;

      const trades = Array.isArray(data.trades) ? data.trades : [];
      const strategies = Array.isArray(data.strategies) ? data.strategies : [];

      // PAYWALL Phase 2 — Gate 4: locked users get summary only.
      if (tradesLocked) {
        return NextResponse.json({
          success: true,
          total: data.total ?? 0,
          returned: 0,
          offset,
          filters: { limit, offset, ticker: ticker || null, strategy: strategy || null, outcome: outcome || null, sort },
          strategies,
          trades: [],
          trades_locked: true,
          upgradeUrl: '/pricing',
          summary: data.summary || {
            total: data.total ?? 0,
            wins: 0,
            losses: 0,
            win_rate_pct: 0,
            avg_pnl_pct: 0,
            avg_holding_days: 0,
          },
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      return NextResponse.json({
        success: true,
        total: data.total ?? trades.length,
        returned: trades.length,
        offset,
        filters: { limit, offset, ticker: ticker || null, strategy: strategy || null, outcome: outcome || null, sort },
        strategies,
        trades,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — no fabricated trade rows.
  const emptyBase: Record<string, unknown> = {
    success: true,
    total: 0,
    returned: 0,
    offset,
    filters: { limit, offset, ticker: ticker || null, strategy: strategy || null, outcome: outcome || null, sort },
    strategies: [],
    trades: [],
    source: 'python_empty',
    message: 'لا توجد بيانات',
  };
  if (tradesLocked) {
    emptyBase.trades_locked = true;
    emptyBase.upgradeUrl = '/pricing';
    emptyBase.summary = {
      total: 0,
      wins: 0,
      losses: 0,
      win_rate_pct: 0,
      avg_pnl_pct: 0,
      avg_holding_days: 0,
    };
  }
  return NextResponse.json(emptyBase, { headers: { 'Cache-Control': 'no-store' } });
}
