/**
 * Honest Live Tracking — Lightweight SQLite-based replacement for Python live-tracking
 * ============================================================================
 * يرجع بيانات التتبع بنفس الفورمات اللي Python live-tracking بيرجعه،
 * بس بيقرأ من SQLite مباشرةً بدون الحاجة لـ Python.
 *
 * الفرق عن /list: ده endpoint خفيف بيرجع بس top-N predictions لكل شخصية
 * + إحصائيات محسوبة في SQL مباشرةً (مش في JS) — أسرع وأخف في الذاكرة.
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureSchema } from '@/lib/honest-tracking/maestro';
import { applyProtectionFilter, isProtectionActive, getProtectionDescription, getProtectionSqlFilter } from '@/lib/protection/display-protection';

export const dynamic = 'force-dynamic';

function openDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  try {
    const db = new Database(dbPath, { timeout: 3000 });
    ensureSchema(db);
    return db;
  } catch {
    return new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
  }
}

function inferMarket(ticker: string, marketCol: string | null): string {
  if (marketCol && marketCol !== '') return marketCol;
  if (!ticker) return 'EGX';
  if (/^\d+$/.test(ticker)) return 'TADAWUL';
  return 'EGX';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50'), 10), 300); // up to 300 per persona
  const days = parseInt(searchParams.get('days') || '0'); // 0 = all, 999 = YTD
  const minScore = parseInt(searchParams.get('minScore') || '0');

  // P0-12-SQLI fix (2026-09-27): parameterize market filter to prevent SQL injection.
  // Previously `${market.toUpperCase()}` was interpolated directly into SQL strings,
  // allowing injection via e.g. ?market=EGX'; DROP TABLE predictions; --
  // Now we use `?` placeholders and pass marketUpper as a bound parameter.
  const marketUpper = market !== 'all' ? market.toUpperCase() : null;
  const marketWhereClause = marketUpper ? 'WHERE market = ?' : '';
  const marketAndClause = marketUpper ? 'AND market = ?' : '';
  const marketParams: string[] = marketUpper ? [marketUpper] : [];

  const db = openDb();

  try {
    // ── Compute stats in SQL (very lightweight) ──
    // SCHEMA-MISMATCH-FIX: التوقعات المقفولة بتتعرف بـ outcome_date OR status='CLOSED'
    // OR exit_type IS NOT NULL. الـ trading pipeline بـ يكتب status/exit_type/pnl_pct
    // بس مش outcome_date/actual_return/is_correct. فـ بنـ use COALESCE(actual_return,
    // pnl_pct) كـ العائد الفعلي، و is_correct IS NULL → نحكم بـ eff_return.
    const statsRow = db.prepare(`
      WITH pred AS (
        SELECT
          outcome_date, status, exit_type, is_correct,
          actual_return, pnl_pct,
          (outcome_date IS NOT NULL
            OR UPPER(TRIM(COALESCE(status, ''))) = 'CLOSED'
            OR exit_type IS NOT NULL) AS is_closed,
          COALESCE(actual_return, pnl_pct) AS eff_return
        FROM predictions
        ${marketWhereClause}
      )
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_closed THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN NOT is_closed THEN 1 ELSE 0 END) as pending,
        -- Constitution Rule 7 (HARD cap): استبعاد العوائد السامة |eff_return| > 50% من كل الـ KPIs.
        SUM(CASE WHEN is_closed AND (eff_return IS NULL OR ABS(eff_return) <= 50) AND (is_correct = 1 OR (is_correct IS NULL AND eff_return > 0)) THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN is_closed AND (eff_return IS NULL OR ABS(eff_return) <= 50) AND (is_correct = 0 OR (is_correct IS NULL AND eff_return < 0)) THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND ABS(eff_return) <= 50 AND eff_return > 0 THEN eff_return ELSE 0 END) as win_returns,
        SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND ABS(eff_return) <= 50 AND eff_return < 0 THEN eff_return ELSE 0 END) as loss_returns,
        SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return > 0 AND ABS(eff_return) <= 50 THEN 1 ELSE 0 END) as win_count,
        SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return < 0 AND ABS(eff_return) <= 50 THEN 1 ELSE 0 END) as loss_count
      FROM pred
    `).get(...marketParams) as any;

    const closedCount = Number(statsRow.closed || 0);
    const wins = Number(statsRow.wins || 0);
    const losses = Number(statsRow.losses || 0);
    const settled = wins + losses;
    const winRate = settled > 0 ? Math.round((wins / settled) * 1000) / 10 : 0;
    const winReturnsSum = Number(statsRow.win_returns || 0);
    const lossReturnsSum = Number(statsRow.loss_returns || 0);
    const winCount = Number(statsRow.win_count || 0);
    const lossCount = Number(statsRow.loss_count || 0);
    const avgWinPct = winCount > 0 ? Math.round((winReturnsSum / winCount) * 100) / 100 : 0;
    const avgLossPct = lossCount > 0 ? Math.round((lossReturnsSum / lossCount) * 100) / 100 : 0;
    const profitFactor = lossReturnsSum < 0
      ? Math.round((winReturnsSum / Math.abs(lossReturnsSum)) * 100) / 100
      : (winReturnsSum > 0 ? 999 : 0);

    // ── Fetch top-N predictions per persona (lightweight) ──
    let dayFilter = '';
    if (days === 999) {
      // YTD: من أول السنة الحالية
      dayFilter = "AND COALESCE(outcome_date, prediction_date) >= date('now', 'start of year')";
    } else if (days > 0) {
      dayFilter = `AND COALESCE(outcome_date, prediction_date) >= date('now', 'localtime', '-${days} days')`;
    }
    const scoreFilter = minScore > 0
      ? `AND master_score >= ${minScore}`
      : '';

    // V40.1: schema-aware — add evidence_count, morning_bell, kill_filter_result if present
    let v40Cols = false;
    try {
      const cols = db.prepare("PRAGMA table_info(predictions)").all() as Array<{ name: string }>;
      v40Cols = cols.some((c) => c.name === 'evidence_count') && cols.some((c) => c.name === 'morning_bell');
    } catch { v40Cols = false; }
    const v40Sel = v40Cols ? ', evidence_count, morning_bell, kill_filter_result' : '';

    // V40.2-PROTECTION: SQL-level filter for morning_bell / hide_weak modes
    const protFilter = getProtectionSqlFilter();
    let protClause = protFilter.clause;
    if (protFilter.params.length > 0) {
      protFilter.params.forEach((p) => {
        protClause = protClause.replace('?', String(Number(p)));
      });
    }
    const protSql = protClause ? `AND ${protClause}` : '';

    const predictionsQuery = `
      SELECT
        id, ticker, market, signal_type, prediction_date,
        entry_price, target_price, stop_loss,
        master_score, confidence,
        outcome_date, exit_price, actual_return, exit_reason,
        hit_target, hit_stop, is_correct, holding_days,
        notes, persona, exit_type, status, pnl_pct, closed_at,
        highest_price_reached, lowest_price_reached${v40Sel}
      FROM predictions
      WHERE 1=1 ${dayFilter} ${scoreFilter} ${protSql}
      ${marketAndClause}
      ORDER BY (outcome_date IS NULL AND UPPER(TRIM(COALESCE(status,''))) != 'CLOSED' AND exit_type IS NULL) DESC, prediction_date DESC, master_score DESC, outcome_date DESC, closed_at DESC
      LIMIT ${limit * 3}
    `;

    const rows = db.prepare(predictionsQuery).all(...marketParams) as any[];

    // Group by persona and limit
    const buckets: Record<string, any[]> = { gambler: [], balanced: [], conservative: [] };
    for (const r of rows) {
      let persona = 'balanced';
      const rawPersona = (r.persona || '').toLowerCase().trim();
      if (rawPersona === 'gambler') persona = 'gambler';
      else if (rawPersona === 'investor' || rawPersona === 'conservative') persona = 'conservative';

      // Determine outcome — SCHEMA-MISMATCH-FIX: التوقعات المقفولة بـ trading
      // pipeline (status='CLOSED' / exit_type) بتتعامل زي outcome_date. العائد
      // الفعلي = COALESCE(actual_return, pnl_pct).
      let outcome: 'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING' = 'PENDING';
      const actualReturn = r.actual_return !== null && r.actual_return !== undefined ? Number(r.actual_return) : null;
      const pnlPct = r.pnl_pct !== null && r.pnl_pct !== undefined ? Number(r.pnl_pct) : null;
      const effReturn = actualReturn !== null ? actualReturn : pnlPct;
      const statusNorm = (r.status || '').toString().trim().toUpperCase();
      const isClosed = !!r.outcome_date || statusNorm === 'CLOSED' || !!r.exit_type;
      if (!isClosed) {
        outcome = 'PENDING';
      } else if (effReturn !== null && effReturn > 0) {
        outcome = 'WIN';
      } else if (effReturn !== null && effReturn < 0) {
        outcome = 'LOSS';
      } else if (r.hit_stop === 1) {
        outcome = 'LOSS';
      } else if (r.hit_target === 1) {
        outcome = 'WIN';
      } else {
        outcome = 'EXPIRED';
      }

      const item = {
        ticker: r.ticker,
        nameAr: r.ticker,
        persona,
        signal: r.signal_type || '',
        entryDate: r.prediction_date,
        entryPrice: Number(r.entry_price || 0),
        targetPrice: Number(r.target_price || 0),
        stopLoss: Number(r.stop_loss || 0),
        currentPrice: r.exit_price ? Number(r.exit_price) : Number(r.entry_price || 0),
        outcome,
        returnPct: effReturn,
        daysSinceEntry: r.holding_days || 0,
        closedAt: r.outcome_date || r.closed_at || null,
        exitPrice: r.exit_price ? Number(r.exit_price) : null,
        maestroScore: r.master_score != null ? Number(r.master_score) : 0,
        confidence: r.confidence != null ? Number(r.confidence) : (r.master_score != null ? Number(r.master_score) : 0),
        exit_type: r.exit_type || null,
        exitType: r.exit_type || null,
        highest_price_reached: r.highest_price_reached != null ? Number(r.highest_price_reached) : null,
        lowest_price_reached: r.lowest_price_reached != null ? Number(r.lowest_price_reached) : null,
        // V40.1: Evidence-based fields
        evidence_count: r.evidence_count != null ? Number(r.evidence_count) : 0,
        morning_bell: r.morning_bell === 1,
        kill_filter_result: r.kill_filter_result || null,
      };

      if (buckets[persona].length < limit) {
        buckets[persona].push(item);
      }
    }

    // ── Per-persona stats (computed from SQL) ──
    const personas = ['gambler', 'balanced', 'conservative'] as const;
    const statsByPersona: Record<string, any> = {};
    for (const p of personas) {
      const pStats = db.prepare(`
        WITH pred AS (
          SELECT
            outcome_date, status, exit_type, is_correct,
            actual_return, pnl_pct,
            (outcome_date IS NOT NULL
              OR UPPER(TRIM(COALESCE(status, ''))) = 'CLOSED'
              OR exit_type IS NOT NULL) AS is_closed,
            COALESCE(actual_return, pnl_pct) AS eff_return
          FROM predictions
          WHERE (persona = ? OR notes LIKE ?)
          ${marketAndClause}
        )
        SELECT
          COUNT(*) as total,
          -- Constitution Rule 7 (HARD cap): استبعاد العوائد السامة |eff_return| > 50%.
          SUM(CASE WHEN is_closed AND (eff_return IS NULL OR ABS(eff_return) <= 50) AND (is_correct = 1 OR (is_correct IS NULL AND eff_return > 0)) THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN is_closed AND (eff_return IS NULL OR ABS(eff_return) <= 50) AND (is_correct = 0 OR (is_correct IS NULL AND eff_return < 0)) THEN 1 ELSE 0 END) as losses,
          SUM(CASE WHEN NOT is_closed THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND ABS(eff_return) <= 50 AND eff_return > 0 THEN eff_return ELSE 0 END) as win_returns,
          SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND ABS(eff_return) <= 50 AND eff_return < 0 THEN eff_return ELSE 0 END) as loss_returns,
          SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return > 0 AND ABS(eff_return) <= 50 THEN 1 ELSE 0 END) as win_count,
          SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return < 0 AND ABS(eff_return) <= 50 THEN 1 ELSE 0 END) as loss_count
        FROM pred
      `).get(p, `%persona=${p}%`, ...marketParams) as any;

      const pWins = Number(pStats.wins || 0);
      const pLosses = Number(pStats.losses || 0);
      const pSettled = pWins + pLosses;
      const pWinRate = pSettled > 0 ? Math.round((pWins / pSettled) * 1000) / 10 : 0;
      const pWinReturns = Number(pStats.win_returns || 0);
      const pLossReturns = Number(pStats.loss_returns || 0);
      const pWinCount = Number(pStats.win_count || 0);
      const pLossCount = Number(pStats.loss_count || 0);
      const pAvgWin = pWinCount > 0 ? Math.round((pWinReturns / pWinCount) * 100) / 100 : 0;
      const pAvgLoss = pLossCount > 0 ? Math.round((pLossReturns / pLossCount) * 100) / 100 : 0;
      const pPF = pLossReturns < 0 ? Math.round((pWinReturns / Math.abs(pLossReturns)) * 100) / 100 : (pWinReturns > 0 ? 999 : 0);

      statsByPersona[p] = {
        total: Number(pStats.total || 0),
        wins: pWins,
        losses: pLosses,
        pending: Number(pStats.pending || 0),
        settled: pSettled,
        winRate: pWinRate,
        avgWinPct: pAvgWin,
        avgLossPct: pAvgLoss,
        profitFactor: pPF,
        closedCount: pSettled,
      };
    }

    // V40.2-PROTECTION: JS-side filter for top_confidence mode (per-persona top-N)
    if (isProtectionActive()) {
      for (const p of Object.keys(buckets)) {
        buckets[p] = applyProtectionFilter(buckets[p]);
      }
    }

    db.close();

    return NextResponse.json({
      success: true,
      predictions: buckets,
      protection: isProtectionActive() ? getProtectionDescription() : undefined,
      stats: {
        total: Number(statsRow.total || 0),
        wins,
        losses,
        pending: Number(statsRow.pending || 0),
        settled,
        winRate,
        avgWinPct,
        avgLossPct,
        profitFactor,
        closedCount,
        expired: 0,
      },
      statsByPersona,
      market_session: {
        is_open: false,
        server_time: new Date().toISOString(),
        next_refresh_seconds: 300,
        session_name: 'unknown',
      },
      last_updated: new Date().toISOString(),
      source: 'honest-live-tracking',
      market,
      daysWindow: days,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (error) {
    db.close();
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
