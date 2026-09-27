/**
 * GET /api/market/regime
 * ========================
 * REGIME-ENGINE (2026-09-27)
 *
 * Returns the current MarketRegimeEngine state for a given market:
 *   - regime: DEFENSIVE | NORMAL | AGGRESSIVE
 *   - raw_regime + candidate_regime + candidate_days (hysteresis bookkeeping)
 *   - 6 indicators (SMA20/50/200, breadth, ATR, turnover, loss streak, drawdown)
 *   - per-regime thresholds (min_rr, min_score, max_picks_per_day, ...)
 *   - reasons (human-readable bullet list)
 *   - history (last N entries from market_regime_log)
 *
 * Query params:
 *   ?market=EGX         (default) — one of EGX / TADAWUL / KSE / QSE / CRYPTO / GOLD
 *   ?history=30         (default) — number of log entries to return (0 = none)
 *   ?refresh=1          (optional) — force recompute the regime before returning
 *
 * Constitution §1 (Python is the brain, Next.js is display only):
 * This endpoint is DISPLAY-ONLY. It reads from `system_settings` +
 * `market_regime_log` in stocks.db. The actual regime computation happens
 * in `vps-service/analyzers/market_regime_engine.py` (cron + V40.2 hook).
 *
 * If ?refresh=1 is passed AND the Python backend is reachable, we forward
 * the request to the Python service to recompute + persist. Otherwise we
 * just read what's in the DB.
 */
import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

const SUPPORTED_MARKETS = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'CRYPTO', 'GOLD'];
const MARKET_ALIAS: Record<string, string> = {
  KSA: 'TADAWUL', SA: 'TADAWUL', SAUDI: 'TADAWUL',
  QATAR: 'QSE', PAK: 'KSE',
  BTC: 'CRYPTO', XAU: 'GOLD', XAUUSD: 'GOLD',
};

type RegimeIndicators = {
  index_sma20?: number | null;
  index_sma50?: number | null;
  index_sma200?: number | null;
  index_current?: number | null;
  index_daily_change_pct?: number;
  breadth_pct?: number;
  breadth_advances?: number;
  breadth_declines?: number;
  breadth_total?: number;
  atr_14?: number;
  atr_20d_avg?: number;
  atr_ratio?: number;
  avg_turnover_today?: number;
  avg_turnover_10d?: number;
  turnover_ratio?: number;
  loss_streak_days?: number;
  short_term_drawdown_pct?: number;
  index_ticker_used?: string;
  index_source?: string;
  sample_size?: number;
  latest_date?: string;
};

type RegimeState = {
  current_regime?: string;
  candidate_regime?: string;
  candidate_days?: number;
  last_update?: string;
  last_raw_regime?: string;
  market?: string;
};

type LogRow = {
  date: string;
  market: string;
  regime: string;
  raw_regime?: string | null;
  candidate_regime?: string | null;
  candidate_days?: number | null;
  confidence?: number | null;
  index_current?: number | null;
  index_daily_change_pct?: number | null;
  breadth_pct?: number | null;
  atr_ratio?: number | null;
  turnover_ratio?: number | null;
  loss_streak_days?: number | null;
  short_term_drawdown_pct?: number | null;
  computed_at?: string | null;
  reasons?: string | null;
  indicators?: string | null;
};

const REGIME_THRESHOLDS: Record<string, Record<string, number>> = {
  DEFENSIVE: {
    min_rr: 2.0,
    min_score: 75,
    position_size_multiplier: 0.5,
    max_picks_per_day: 2,
    atr_stop_multiplier: 1.5,
    falling_knife_threshold: 0.12,
    min_turnover_multiplier: 2.0,
    max_open_positions: 3,
  },
  NORMAL: {
    min_rr: 1.5,
    min_score: 60,
    position_size_multiplier: 0.8,
    max_picks_per_day: 5,
    atr_stop_multiplier: 2.0,
    falling_knife_threshold: 0.15,
    min_turnover_multiplier: 1.0,
    max_open_positions: 5,
  },
  AGGRESSIVE: {
    min_rr: 1.5,
    min_score: 70,
    position_size_multiplier: 1.0,
    max_picks_per_day: 7,
    atr_stop_multiplier: 2.0,
    falling_knife_threshold: 0.18,
    min_turnover_multiplier: 0.8,
    max_open_positions: 7,
  },
};

function parseReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // not JSON — treat as plain text
    return [raw];
  }
  return [];
}

function parseIndicators(raw: string | null | undefined): RegimeIndicators {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as RegimeIndicators;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
  const market = MARKET_ALIAS[marketRaw] || (SUPPORTED_MARKETS.includes(marketRaw) ? marketRaw : 'EGX');
  const historyLimit = Math.min(120, Math.max(0, parseInt(url.searchParams.get('history') || '30', 10) || 30));
  const refresh = url.searchParams.get('refresh') === '1';

  // ── Optional refresh: forward to Python backend ──
  if (refresh) {
    try {
      const targetUrl = `${PY}/api/market/regime?market=${market}&history=${historyLimit}&refresh=1`;
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' },
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // fall through to SQLite fallback
    }
  }

  // ── Read from stocks.db directly ──
  let db: Database.Database | null = null;
  try {
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 500 },
      );
    }
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    db = new Database(stocksDbPath, { readonly: true, fileMustExist: true });

    // 1) Read current state from system_settings
    const settingsKey = `current_regime_${market}`;
    let state: RegimeState = {};
    try {
      const row = db
        .prepare('SELECT value FROM system_settings WHERE key = ?')
        .get(settingsKey) as { value?: string } | undefined;
      if (row?.value) {
        state = JSON.parse(row.value) as RegimeState;
      }
    } catch {
      // table missing or row malformed — leave state empty
    }

    const currentRegime = (state.current_regime || 'NORMAL').toUpperCase();
    const thresholds = REGIME_THRESHOLDS[currentRegime] || REGIME_THRESHOLDS.NORMAL;

    // 2) Read latest log entry (full indicators + reasons)
    let latestLog: LogRow | null = null;
    try {
      const logRow = db
        .prepare(
          `SELECT date, market, regime, raw_regime, candidate_regime, candidate_days,
                  confidence, index_current, index_daily_change_pct, breadth_pct, atr_ratio,
                  turnover_ratio, loss_streak_days, short_term_drawdown_pct, computed_at,
                  reasons, indicators
           FROM market_regime_log
           WHERE market = ?
           ORDER BY date DESC, id DESC
           LIMIT 1`,
        )
        .get(market) as LogRow | undefined;
      latestLog = logRow || null;
    } catch {
      // table doesn't exist — first run
    }

    // 3) Read history (lightweight columns only)
    const history: LogRow[] = [];
    if (historyLimit > 0) {
      try {
        const rows = db
          .prepare(
            `SELECT date, market, regime, raw_regime, candidate_regime, candidate_days,
                    confidence, index_current, index_daily_change_pct, breadth_pct, atr_ratio,
                    turnover_ratio, loss_streak_days, short_term_drawdown_pct, computed_at
             FROM market_regime_log
             WHERE market = ?
             ORDER BY date DESC, id DESC
             LIMIT ?`,
          )
          .all(market, historyLimit) as LogRow[];
        history.push(...rows);
      } catch {
        // table missing — ignore
      }
    }

    db.close();
    db = null;

    const indicators = latestLog ? parseIndicators(latestLog.indicators) : {};
    const reasons = latestLog ? parseReasons(latestLog.reasons) : [];

    return NextResponse.json({
      success: true,
      market,
      regime: currentRegime,
      raw_regime: (latestLog?.raw_regime || state.last_raw_regime || currentRegime).toUpperCase(),
      candidate_regime: (state.candidate_regime || currentRegime).toUpperCase(),
      candidate_days: state.candidate_days || 0,
      previous_effective_regime: currentRegime, // legacy field (state doesn't track this on Next side)
      confidence: latestLog?.confidence ?? 0,
      reasons,
      indicators,
      thresholds,
      latest_log: latestLog
        ? {
            date: latestLog.date,
            index_current: latestLog.index_current,
            index_daily_change_pct: latestLog.index_daily_change_pct,
            breadth_pct: latestLog.breadth_pct,
            atr_ratio: latestLog.atr_ratio,
            turnover_ratio: latestLog.turnover_ratio,
            loss_streak_days: latestLog.loss_streak_days,
            short_term_drawdown_pct: latestLog.short_term_drawdown_pct,
            computed_at: latestLog.computed_at,
          }
        : null,
      last_update: state.last_update || null,
      history,
      source: 'sqlite',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    if (db) {
      try { db.close(); } catch {}
    }
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        market: marketRaw,
      },
      { status: 500 },
    );
  }
}
