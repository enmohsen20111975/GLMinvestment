/**
 * GET /api/portfolio/unified-watch
 * ==================================
 * Returns ALL stocks the user is tracking (portfolio + watchlist + radar
 * tracking) with LIVE analysis: current price, prediction, advice, signal,
 * regime impact + exit-radar signal per ticker.
 *
 * Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python `/api/portfolio/unified-watch?user_id=X` ONLY. If Python
 * is unreachable → honest empty watchlist (Rule 27 NO-FAKE-DATA).
 *
 * Previously this route opened `db/stocks.db` (portfolio_assets,
 * user_stock_watchlists, stocks) and `db/predictions.db` directly. All
 * SQL has been removed — Python is the canonical source (Rule 4: Python =
 * brain).
 *
 * Auth: required (getSessionUserId). Returns 401 if no userId (Rule 50:
 * MONEY-AS-CUSTOMER-LIFE — fail closed).
 *
 * Response shape is preserved for consumers (MyStocksBriefing.tsx +
 * DashboardView.tsx):
 *   {
 *     success: true,
 *     user_id: string,
 *     stocks: StockEnriched[],
 *     summary: {
 *       total_stocks, portfolio_stocks, watchlist_stocks, radar_tracked,
 *       total_value, total_cost, total_pnl, total_pnl_pct,
 *       sector_distribution, alerts: {...}, exit_radar_cache_age_seconds
 *     }
 *   }
 *
 * Rule 4  (Python = brain).
 * Rule 27 (NO-FAKE-DATA — empty stocks array + zeroed summary on failure).
 * Rule 50 (MONEY-AS-CUSTOMER-LIFE — auth required, fail closed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { apiErr } from '@/lib/api-response';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

// Empty summary shape — matches the production summary so consumers
// (DashboardView, MyStocksBriefing) render the same "no data" state they
// already handle.
function emptySummary() {
  return {
    total_stocks: 0,
    portfolio_stocks: 0,
    watchlist_stocks: 0,
    radar_tracked: 0,
    total_value: 0,
    total_cost: 0,
    total_pnl: 0,
    total_pnl_pct: 0,
    sector_distribution: {} as Record<string, number>,
    alerts: {
      total: 0,
      critical: 0,
      warning: 0,
      caution: 0,
      by_type: {} as Record<string, number>,
      exit_radar_count: 0,
      take_profit_count: 0,
      stop_loss_count: 0,
      approaching_target_count: 0,
    },
    exit_radar_cache_age_seconds: null,
  };
}

// GET /api/portfolio/unified-watch
// Returns ALL stocks the user is tracking (portfolio + watchlist + radar tracking)
// with LIVE analysis: current price, prediction, advice, signal, regime impact.
//
// FOCUS-5-TASKS (2026-10-01): enhanced to ALSO join exit-radar data per ticker
// so the dashboard widget can show actionable exit alerts directly on the
// portfolio stocks. Single API call gives the widget everything it needs.
// → Now performed by Python (Rule 4).
export async function GET(req: NextRequest) {
  const { userId } = await getSessionUserId();
  if (!userId) return apiErr('auth_required', 'Authentication required', 401);

  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  // ── Python canonical endpoints (primary + direct fallback) ────────────
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/portfolio/unified-watch${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/portfolio/unified-watch${qs ? `?${qs}` : ''}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: {
          // Forward the authenticated user_id so Python can scope the query.
          'x-user-id': userId,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.success) {
          return NextResponse.json(data);
        }
      }
    } catch { // silent fallback (safe-by-design) → try next URL
      // Try next fallback URL.
    }
  }

  // Rule 27: honest empty watchlist — no fabricated holdings/prices/predictions.
  return NextResponse.json({
    success: true,
    user_id: userId,
    stocks: [],
    summary: emptySummary(),
  });
}
