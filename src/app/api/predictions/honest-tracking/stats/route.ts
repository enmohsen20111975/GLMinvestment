/**
 * Honest Prediction Tracking API — Stats
 * =======================================
 * RULE20-FIX (2026-10-11): Converted from 641 lines of Node DB queries
 * to a thin proxy to Python /api/stored-analysis/live-tracking.
 *
 * Rule 20 (Python = brain, Node = display only): removed all DB queries,
 * win_rate/profit_factor/expectancy computations, dedup logic, channel
 * separation, cumulative_returns time-series, and lessons extraction.
 *
 * The Python endpoint /api/stored-analysis/live-tracking returns `stats`
 * and `statsByPersona` computed from the `predictions` table (79 columns).
 * This route extracts those stats and returns them in the format the
 * admin page expects.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
const PROD_VPS = 'https://invist.m2y.net';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'all';

  const pyParams = new URLSearchParams();
  pyParams.set('market', market === 'all' ? 'EGX' : market);
  pyParams.set('days', '999'); // all history
  pyParams.set('limit', '2000');

  const fetchFromUrl = async (baseUrl: string) => {
    const url = `${baseUrl.replace(/\/$/, '')}/api/stored-analysis/live-tracking?${pyParams.toString()}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  try {
    // 1. Try local Python backend
    let data = await fetchFromUrl(PY);

    // 2. Fallback to production VPS
    if (!data || !data.success) {
      data = await fetchFromUrl(PROD_VPS);
    }

    if (!data || !data.success) {
      // Graceful degradation (Rule 27: NO-FAKE-DATA)
      return NextResponse.json({
        success: true,
        stats: {
          published_only: true,
          total_predictions: 0,
          closed_predictions: 0,
          active_predictions: 0,
          pending_predictions: 0,
          target_hits: 0,
          stop_hits: 0,
          wins: 0,
          losses: 0,
          real_win_rate: 0,
          avg_return: null,
          avg_profit: null,
          avg_loss: null,
          net_pl: 0,
          n_raw: 0,
          n_valid: 0,
          n_excluded: 0,
          capped_rows: 0,
          hard_cap: 50,
          audit_status: 'unavailable',
        },
        by_market: [],
        by_channel: [],
        candlestick_patterns: [],
        lessons: [],
        monthly_breakdown: [],
        cumulative_returns: [],
        source: 'unavailable',
      }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      });
    }

    // 3. Extract stats from Python response (display formatting)
    const stats = data.stats || {};
    const statsByPersona = data.statsByPersona || {};

    // Build by_channel from statsByPersona (Python computes per-persona)
    const byChannel = Object.entries(statsByPersona).map(([channel, s]: [string, any]) => ({
      channel,
      n: s.closedCount || 0,
      n_raw: s.total || 0,
      n_closed: s.closedCount || 0,
      capped: 0,
      win_rate: s.winRate || 0,
      profit_factor: s.profitFactor || 0,
      expectancy_pct: s.avgWinPct || 0,
      avg_win_pct: s.avgWinPct || 0,
      avg_loss_pct: s.avgLossPct || 0,
      max_loss_pct: 0,
      net_pl: 0,
    }));

    return NextResponse.json({
      success: true,
      stats: {
        published_only: true,
        total_predictions: stats.total || 0,
        closed_predictions: stats.closedCount || stats.settled || 0,
        active_predictions: stats.pending || 0,
        pending_predictions: stats.pending || 0,
        target_hits: 0,
        stop_hits: 0,
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        real_win_rate: stats.winRate || 0,
        avg_return: stats.avgWinPct ? Math.round(stats.avgWinPct * 100) / 100 : null,
        avg_profit: stats.avgWinPct ? Math.round(stats.avgWinPct * 100) / 100 : null,
        avg_loss: stats.avgLossPct ? -Math.abs(Math.round(stats.avgLossPct * 100) / 100) : null,
        net_pl: 0,
        avg_risk_reward: null,
        avg_holding_days: null,
        avg_confidence: null,
        sr_adoption_rate: 0,
        candlestick_adoption_rate: 0,
        date_range: { earliest: null, latest: null },
        markets_covered: [],
        n_raw: stats.total || 0,
        n_valid: stats.settled || 0,
        n_excluded: 0,
        capped_rows: 0,
        hard_cap: 50,
        audit_status: 'python-proxy',
        audit_note_ar: 'الإحصائيات محسوبة من Python backend (Rule 20: Python = brain)',
      },
      by_market: [{ market: market === 'all' ? 'EGX' : market, ...stats }],
      by_channel: byChannel,
      candlestick_patterns: [],
      lessons: [],
      monthly_breakdown: [],
      cumulative_returns: [],
      source: data.source || 'python-live-tracking-v2',
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-live-tracking-v2',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:stats] proxy error:', error);
    return NextResponse.json({
      success: true,
      stats: {
        published_only: true,
        total_predictions: 0,
        closed_predictions: 0,
        wins: 0,
        losses: 0,
        real_win_rate: 0,
        audit_status: 'error-fallback',
      },
      by_market: [],
      by_channel: [],
      source: 'error-fallback',
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }
}
