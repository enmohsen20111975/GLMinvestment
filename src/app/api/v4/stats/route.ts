/**
 * GET /api/v4/stats  (also reachable via /api/python/v4/stats)
 * ============================================================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from predictions.db.predictions — no mock data (Rule 27).
 *
 * Tries Python /api/v4/stats first (5s timeout).
 * On failure, computes stats from the predictions table:
 *   - total predictions
 *   - wins (status = 'TARGET_HIT')
 *   - losses (status = 'STOPPED')
 *   - win_rate
 *   - avg_return (mean of actual_return across closed predictions)
 *   - by_persona breakdown (count + win_rate per persona)
 *   - top_tickers (top 5 tickers by prediction count, with win_rate)
 *
 * Shape: { success, source: 'sqlite_fallback', data: { stats, by_persona, top_tickers } }
 *
 * Note: This module exports `handleV4Stats` so the catch-all
 * `/api/python/[...path]` route can re-use the same logic when the frontend
 * calls `/api/python/v4/stats`.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface PersonaStat {
  persona: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_return: number;
}

interface TickerStat {
  ticker: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_return: number;
}

interface OverallStats {
  total_predictions: number;
  wins: number;
  losses: number;
  pending: number;
  win_rate: number;
  avg_return: number;
  by_signal: Array<{ signal: string; total: number }>;
}

interface V4Stats {
  stats: OverallStats;
  by_persona: PersonaStat[];
  top_tickers: TickerStat[];
}

/**
 * Shared handler — used by both /api/v4/stats and /api/python/v4/stats.
 * Exported so the catch-all `[...path]` route can re-use the same logic.
 */
export async function handleV4Stats(_req: NextRequest): Promise<NextResponse> {
  // 1) Try Python first (5s timeout)
  try {
    const res = await fetch(`${PY}/api/v4/stats`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error('[v4/stats] Python proxy error:', error);
  }

  // 2) Fallback — compute stats from predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json(
        { success: false, error: 'predictions.db not found' },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const overall = db
      .prepare(
        `SELECT
           COUNT(*) AS total_predictions,
           SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) AS losses,
           SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS pending,
           AVG(CASE WHEN actual_return IS NOT NULL THEN actual_return END) AS avg_return
         FROM predictions`
      )
      .get() as Record<string, number | null>;

    const total = Number(overall?.total_predictions ?? 0);
    const wins = Number(overall?.wins ?? 0);
    const losses = Number(overall?.losses ?? 0);
    const pending = Number(overall?.pending ?? 0);
    const closed = wins + losses;
    const winRate = closed > 0 ? Math.round((wins / closed) * 10000) / 100 : 0;
    const avgReturn =
      overall?.avg_return !== null && overall?.avg_return !== undefined
        ? Math.round(Number(overall.avg_return) * 100) / 100
        : 0;

    const bySignal = db
      .prepare(
        `SELECT signal, COUNT(*) AS total
         FROM predictions
         GROUP BY signal
         ORDER BY total DESC`
      )
      .all() as Array<{ signal: string; total: number }>;

    const personaRows = db
      .prepare(
        `SELECT
           COALESCE(NULLIF(persona, ''), 'unspecified') AS persona,
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) AS losses,
           AVG(CASE WHEN actual_return IS NOT NULL THEN actual_return END) AS avg_return
         FROM predictions
         GROUP BY COALESCE(NULLIF(persona, ''), 'unspecified')
         ORDER BY total DESC`
      )
      .all() as Array<{
        persona: string;
        total: number;
        wins: number;
        losses: number;
        avg_return: number | null;
      }>;

    const byPersona: PersonaStat[] = personaRows.map((r) => {
      const personaClosed = Number(r.wins) + Number(r.losses);
      return {
        persona: String(r.persona),
        total: Number(r.total),
        wins: Number(r.wins),
        losses: Number(r.losses),
        win_rate:
          personaClosed > 0
            ? Math.round((Number(r.wins) / personaClosed) * 10000) / 100
            : 0,
        avg_return:
          r.avg_return !== null && r.avg_return !== undefined
            ? Math.round(Number(r.avg_return) * 100) / 100
            : 0,
      };
    });

    const tickerRows = db
      .prepare(
        `SELECT
           ticker,
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) AS losses,
           AVG(CASE WHEN actual_return IS NOT NULL THEN actual_return END) AS avg_return
         FROM predictions
         GROUP BY ticker
         ORDER BY total DESC
         LIMIT 5`
      )
      .all() as Array<{
        ticker: string;
        total: number;
        wins: number;
        losses: number;
        avg_return: number | null;
      }>;

    const topTickers: TickerStat[] = tickerRows.map((r) => {
      const tickerClosed = Number(r.wins) + Number(r.losses);
      return {
        ticker: String(r.ticker),
        total: Number(r.total),
        wins: Number(r.wins),
        losses: Number(r.losses),
        win_rate:
          tickerClosed > 0
            ? Math.round((Number(r.wins) / tickerClosed) * 10000) / 100
            : 0,
        avg_return:
          r.avg_return !== null && r.avg_return !== undefined
            ? Math.round(Number(r.avg_return) * 100) / 100
            : 0,
      };
    });

    db.close();

    const stats: OverallStats = {
      total_predictions: total,
      wins,
      losses,
      pending,
      win_rate: winRate,
      avg_return: avgReturn,
      by_signal: bySignal.map((r) => ({
        signal: String(r.signal || ''),
        total: Number(r.total),
      })),
    };

    const data: V4Stats = {
      stats,
      by_persona: byPersona,
      top_tickers: topTickers,
    };

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      data,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[v4:stats]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}

// Default export for /api/v4/stats direct callers
export async function GET(req: NextRequest) {
  return handleV4Stats(req);
}
