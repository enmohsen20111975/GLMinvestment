/**
 * Honest Prediction Tracking API — Stats
 * =======================================
 * Updated: reads market column from predictions table (not inferMarket).
 * Also tracks S/R, candlestick, heaviest losers, lessons.
 *
 * Returns: total, closed, target_hits, stopped, expired, profit_taken,
 * active, win_rate, avg_return, by_market, by_signal, date_range, lessons
 *
 * KPI-AUDIT (gold-standard alignment with /api/admin/platform-performance):
 *   - HARD cap: ABS(actual_return) <= 50 (Constitution Rule 7)
 *   - Dedup on (ticker, prediction_date, channel, entry_price)
 *   - Channel separation: balanced ≠ morning_bell (morning_bell=1)
 *   - audit fields: n_raw, n_valid, n_excluded, exclusion_breakdown,
 *     capped_rows, by_channel
 *   - avg_loss always negative
 *   NOTE: legacy `total_predictions`/`closed_predictions` etc. come from the
 *   `overall` SQL aggregation (no dedup) for backward compat. The new audit
 *   fields (`n_raw`, `n_valid`, `n_excluded`, `exclusion_breakdown`,
 *   `capped_rows`, `by_channel`) are computed row-by-row with dedup and the
 *   ±50 HARD cap. Frontend should prefer audit fields for KPI displays.
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureSchema } from '@/lib/honest-tracking/maestro';
import type { PredictionLesson } from '@/lib/honest-tracking/maestro';

export const dynamic = 'force-dynamic';

// Gold-standard constants (mirror /api/admin/platform-performance)
const HARD_CAP = 50.0; // Constitution Rule 7: ABS(actual_return) <= 50

/** Generic SQL row returned by better-sqlite3.get()/.all(). */
type SqlRow = Record<string, unknown>;

/** Result row shape for `SELECT COUNT(*) as c ...` queries. */
interface CountRow extends SqlRow {
  c?: number | string | null;
}

/** Aggregated stats row returned by the overall predictions query. */
interface OverallStatsRow extends SqlRow {
  total?: number | string | null;
  closed?: number | string | null;
  active?: number | string | null;
  target_hits?: number | string | null;
  stopped?: number | string | null;
  profit_taken?: number | string | null;
  expired?: number | string | null;
  wins?: number | string | null;
  buys?: number | string | null;
  sells?: number | string | null;
  avg_return?: number | string | null;
  avg_profit?: number | string | null;
  avg_loss?: number | string | null;
  net_pl?: number | string | null;
  avg_rr?: number | string | null;
  avg_holding_days?: number | string | null;
  avg_confidence?: number | string | null;
}

function openDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  // HONEST-V2: ensure schema exists (creates predictions table if missing)
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
  const db = openDb();
  try {
    const { searchParams } = new URL(request.url);
    const marketFilter = searchParams.get('market') || 'all';

    // FIX-P2-PREDICTIONS (AUDIT-1-PREDICTIONS): overall stats now filter on
    // `was_published = 1` so the win rate / success rate ONLY counts
    // predictions that were actually published to Telegram. Test/backfill
    // rows (and predictions that only exist in the DB without being sent to
    // subscribers) are excluded from the success-rate math. The legacy
    // `total_predictions` / `closed_predictions` fields are also filtered so
    // the win/loss math stays consistent (wins + losses == closed).
    //
    // The response includes `published_only: true` so the frontend can show
    // a "هذه الإحصائيات تشمل التوقعات المنشورة فقط" note next to the win rate.
    //
    // SCHEMA-MISMATCH-FIX: التوقعات المقفولة = outcome_date OR status='CLOSED'
    // OR exit_type IS NOT NULL. العائد الفعلي = COALESCE(actual_return, pnl_pct).
    const overall = db.prepare(`
      WITH pred AS (
        SELECT *,
          (outcome_date IS NOT NULL
            OR UPPER(TRIM(COALESCE(status, ''))) = 'CLOSED'
            OR exit_type IS NOT NULL) AS is_closed,
          COALESCE(actual_return, pnl_pct) AS eff_return
        FROM predictions
        WHERE was_published = 1
      )
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_closed THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN NOT is_closed THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_closed AND hit_target = 1 THEN 1 ELSE 0 END) as target_hits,
        SUM(CASE WHEN is_closed AND hit_stop = 1 THEN 1 ELSE 0 END) as stopped,
        SUM(CASE WHEN is_closed AND hit_target = 0 AND hit_stop = 0 AND eff_return > 0 THEN 1 ELSE 0 END) as profit_taken,
        SUM(CASE WHEN is_closed AND hit_target = 0 AND hit_stop = 0 AND eff_return <= 0 THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN is_closed AND (is_correct = 1 OR (is_correct IS NULL AND eff_return > 0)) THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN signal_type = 'BUY' THEN 1 ELSE 0 END) as buys,
        SUM(CASE WHEN signal_type = 'SELL' THEN 1 ELSE 0 END) as sells,
        -- FILTER OUT impossible returns (HARD cap ±50 — gold standard).
        -- Returns outside ±50% are treated as data errors (stock splits,
        -- denomination changes, etc.) and excluded from KPI averages.
        -- KPI-AUDIT: HARD cap tightened from ±100/-90 to ±50 (gold standard)
        AVG(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return <= 50 AND eff_return >= -50 THEN eff_return END) as avg_return,
        AVG(CASE WHEN is_closed AND eff_return > 0 AND eff_return <= 50 THEN eff_return END) as avg_profit,
        AVG(CASE WHEN is_closed AND eff_return < 0 AND eff_return >= -50 THEN eff_return END) as avg_loss,
        SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return <= 50 AND eff_return >= -50 THEN eff_return ELSE 0 END) as net_pl,
        AVG(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return <= 50 AND eff_return >= -50 THEN risk_reward END) as avg_rr,
        AVG(CASE WHEN is_closed THEN holding_days END) as avg_holding_days,
        AVG(CASE WHEN is_closed AND master_score IS NOT NULL THEN master_score END) as avg_confidence
      FROM pred
    `).get() as OverallStatsRow;

    // By market — use actual market column with fallback
    // KPI-AUDIT: include morning_bell for channel separation
    // FIX-P2-PREDICTIONS: filter on was_published = 1 (same as overall SQL)
    const allRows = db.prepare(`
      SELECT ticker, market, signal_type, outcome_date, status, exit_type,
             hit_target, hit_stop, actual_return, pnl_pct, is_correct, notes,
             morning_bell, prediction_date, entry_price, persona
      FROM predictions
      WHERE was_published = 1
    `).all() as Array<SqlRow>;

    const byMarketMap: Record<string, { total: number; wins: number; losses: number; closed: number; active: number; pending: number; win_rate: number; net_pl: number; sr_adoption: number; avg_return: number | null }> = {};
    const returnsByMarket: Record<string, number[]> = {};

    // KPI-AUDIT (gold-standard alignment): track raw / valid / excluded / capped
    // and split by channel (balanced vs morning_bell). Dedup on
    // (ticker, prediction_date, channel, entry_price). HARD cap ±50.
    let auditNRaw = 0;
    let auditNCapped = 0;
    const auditExclusionBreakdown: Record<string, number> = {};
    const auditSeenKeys = new Set<string>();
    const byChannelMap: Record<string, {
      total: number; closed: number; wins: number; losses: number;
      net_pl: number; returns: number[]; capped: number;
    }> = {
      balanced: { total: 0, closed: 0, wins: 0, losses: 0, net_pl: 0, returns: [], capped: 0 },
      morning_bell: { total: 0, closed: 0, wins: 0, losses: 0, net_pl: 0, returns: [], capped: 0 },
    };

    for (const r of allRows) {
      auditNRaw++;

      // Channel: morning_bell=1 → morning_bell, else balanced
      const isMorningBell = Number(r.morning_bell || 0) === 1;
      const channel = isMorningBell ? 'morning_bell' : 'balanced';

      // Dedup key (same logic as gold standard)
      const tickerNorm = String(r.ticker || '').trim().toUpperCase();
      const predDate = String(r.prediction_date || '');
      const entryVal = r.entry_price !== null && r.entry_price !== undefined
        ? Number(r.entry_price) : 0;
      const dedupKey = `${tickerNorm}|${predDate}|${channel}|${entryVal.toFixed(4)}`;
      if (auditSeenKeys.has(dedupKey)) {
        auditExclusionBreakdown['duplicate'] = (auditExclusionBreakdown['duplicate'] || 0) + 1;
        continue; // skip duplicate from by_market stats too (gold-standard behavior)
      }
      auditSeenKeys.add(dedupKey);

      // Validate ticker + entry (gold standard rules)
      if (!tickerNorm || tickerNorm.includes(' ') || tickerNorm.length > 12) {
        auditExclusionBreakdown['ticker_invalid'] = (auditExclusionBreakdown['ticker_invalid'] || 0) + 1;
        continue;
      }
      if (!entryVal || entryVal <= 0) {
        auditExclusionBreakdown['entry_price_zero'] = (auditExclusionBreakdown['entry_price_zero'] || 0) + 1;
        continue;
      }

      // By market (existing logic, preserved)
      const m = inferMarket(r.ticker, r.market);
      if (!byMarketMap[m]) byMarketMap[m] = { total: 0, wins: 0, losses: 0, closed: 0, active: 0, pending: 0, win_rate: 0, net_pl: 0, sr_adoption: 0, avg_return: null };
      if (!returnsByMarket[m]) returnsByMarket[m] = [];
      byMarketMap[m].total++;
      byChannelMap[channel].total++;
      // SCHEMA-MISMATCH-FIX: is_closed = outcome_date OR status='CLOSED' OR exit_type
      const statusNorm = (r.status || '').toString().trim().toUpperCase();
      const isClosed = !!r.outcome_date || statusNorm === 'CLOSED' || !!r.exit_type;
      const effReturn = r.actual_return !== null && r.actual_return !== undefined
        ? Number(r.actual_return)
        : (r.pnl_pct !== null && r.pnl_pct !== undefined ? Number(r.pnl_pct) : null);
      if (isClosed) {
        byMarketMap[m].closed++;
        byChannelMap[channel].closed++;
        const isWin = r.is_correct === 1
          || (r.is_correct === null && effReturn !== null && effReturn > 0);
        if (isWin) { byMarketMap[m].wins++; byChannelMap[channel].wins++; }
        else { byMarketMap[m].losses++; byChannelMap[channel].losses++; }
        if (effReturn !== null) {
          // KPI-AUDIT: HARD cap tightened from ±100/-90 to ±50 (gold standard)
          if (Math.abs(effReturn) > HARD_CAP) {
            // capped / excluded from KPI averages
            auditNCapped++;
            auditExclusionBreakdown['capped_outside_50'] = (auditExclusionBreakdown['capped_outside_50'] || 0) + 1;
            byChannelMap[channel].capped++;
          } else {
            byMarketMap[m].net_pl += effReturn;
            returnsByMarket[m].push(effReturn);
            byChannelMap[channel].net_pl += effReturn;
            byChannelMap[channel].returns.push(effReturn);
          }
        } else {
          auditExclusionBreakdown['no_return'] = (auditExclusionBreakdown['no_return'] || 0) + 1;
        }
      } else {
        byMarketMap[m].active++;
        byMarketMap[m].pending++;
      }
      if (r.notes && (r.notes.includes('support=') || r.notes.includes('resistance='))) {
        byMarketMap[m].sr_adoption++;
      }
    }

    // KPI-AUDIT: compute by_channel stats (gold-standard ChannelStats shape)
    const byChannel = (Object.keys(byChannelMap) as Array<'balanced' | 'morning_bell'>)
      .filter((ch) => byChannelMap[ch].total > 0)
      .map((ch) => {
        const v = byChannelMap[ch];
        const wins = v.returns.filter((r) => r > 0);
        const losses = v.returns.filter((r) => r < 0);
        const grossProfit = wins.reduce((s, r) => s + r, 0);
        const grossLossAmount = losses.reduce((s, r) => s + Math.abs(r), 0);
        const pf = grossLossAmount > 0 ? grossProfit / grossLossAmount : (grossProfit > 0 ? Infinity : 0);
        const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
        // avg_loss ALWAYS negative (gold standard)
        const avgLoss = losses.length > 0 ? -(grossLossAmount / losses.length) : 0;
        const expectancy = v.returns.length > 0
          ? v.returns.reduce((s, r) => s + r, 0) / v.returns.length : 0;
        const maxLoss = losses.length > 0 ? Math.min(...losses) : 0;
        return {
          channel: ch,
          n: v.returns.length,
          n_raw: v.total,
          n_closed: v.closed,
          capped: v.capped,
          win_rate: v.returns.length > 0 ? (wins.length / v.returns.length) * 100 : 0,
          profit_factor: pf === Infinity ? 0 : pf,
          expectancy_pct: expectancy,
          avg_win_pct: avgWin,
          avg_loss_pct: avgLoss, // negative
          max_loss_pct: maxLoss, // negative
          net_pl: v.net_pl,
        };
      });
    const byMarket = Object.keys(byMarketMap).sort().map((market) => {
      const v = byMarketMap[market];
      const returns = returnsByMarket[market];
      const avgReturn = returns && returns.length > 0
        ? Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 100) / 100
        : null;
      return {
        market,
        total: v.total,
        wins: v.wins,
        losses: v.losses,
        closed: v.closed,
        active: v.active,
        pending: v.pending,
        win_rate: v.closed > 0 ? Math.round((v.wins / v.closed) * 1000) / 10 : 0,
        net_pl: Math.round(v.net_pl * 100) / 100,
        avg_return: avgReturn,
        sr_adoption: v.total > 0 ? Math.round((v.sr_adoption / v.total) * 1000) / 10 : 0,
      };
    });

    // Date range
    const dateRange = db.prepare(`
      SELECT MIN(prediction_date) as earliest, MAX(prediction_date) as latest
      FROM predictions
    `).get() as SqlRow;

    // S/R confidence
    const srCount = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE notes LIKE '%support=%' OR notes LIKE '%resistance=%'
    `).get() as CountRow;
    const srRate = Number(overall.total || 0) > 0 ? Math.round((Number(srCount.c || 0) / Number(overall.total)) * 1000) / 10 : 0;

    // Candlestick patterns
    const candleCount = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE notes LIKE '%candle=%'
    `).get() as CountRow;
    const candlestickRate = Number(overall.total || 0) > 0 ? Math.round((Number(candleCount.c || 0) / Number(overall.total)) * 1000) / 10 : 0;

    // Candlestick pattern performance
    const candlePatterns = db.prepare(`
      SELECT notes, hit_target, hit_stop, is_correct, outcome_date
      FROM predictions
      WHERE notes LIKE '%candle=%'
    `).all() as Array<SqlRow>;
    const patternMap: Record<string, { count: number; wins: number; losses: number }> = {};
    for (const r of candlePatterns) {
      const match = (String(r.notes ?? '')).match(/candle=([A-Z_]+)/);
      if (!match) continue;
      const pat = match[1];
      if (!patternMap[pat]) patternMap[pat] = { count: 0, wins: 0, losses: 0 };
      patternMap[pat].count++;
      if (r.outcome_date) {
        if (r.is_correct === 1) patternMap[pat].wins++;
        else patternMap[pat].losses++;
      }
    }
    const patternStats = Object.entries(patternMap).map(([name, v]) => ({
      name,
      count: v.count,
      wins: v.wins,
      losses: v.losses,
      win_rate: v.count > 0 ? Math.round((v.wins / (v.wins + v.losses)) * 1000) / 10 : 0,
    })).sort((a, b) => b.count - a.count);

    // Extract lessons from closed predictions
    const lessons = extractLessons(db, overall);

    // ---- HONEST-V2: monthly_breakdown + cumulative_returns ----
    // FIX-P2-PREDICTIONS: filter on was_published = 1 so monthly stats +
    // cumulative returns only reflect published predictions.
    const monthlyRows = db.prepare(`
      SELECT
        SUBSTR(prediction_date, 1, 7) as month,
        COUNT(*) as total,
        SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN outcome_date IS NOT NULL AND is_correct = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN outcome_date IS NOT NULL AND actual_return IS NOT NULL THEN actual_return ELSE 0 END) as net_pl
      FROM predictions
      WHERE was_published = 1
      GROUP BY SUBSTR(prediction_date, 1, 7)
      ORDER BY month ASC
    `).all() as Array<SqlRow>;
    const monthly_breakdown = monthlyRows.map(r => ({
      month: String(r.month || ''),
      net_pl: Math.round(Number(r.net_pl || 0) * 100) / 100,
      closed: Number(r.closed || 0),
      wins: Number(r.wins || 0),
      win_rate: Number(r.closed || 0) > 0 ? Math.round((Number(r.wins) / Number(r.closed)) * 1000) / 10 : 0,
    }));

    // Cumulative returns time-series (closed predictions sorted by outcome_date / closed_at)
    // SCHEMA-MISMATCH-FIX: شامل التوقعات المقفولة بـ trading pipeline (status/exit_type)
    // FIX-P2-PREDICTIONS: filter on was_published = 1 (audit-trail consistency).
    const closedRows = db.prepare(`
      SELECT COALESCE(outcome_date, closed_at) as close_date, COALESCE(actual_return, pnl_pct) as eff_return
      FROM predictions
      WHERE (outcome_date IS NOT NULL OR UPPER(TRIM(COALESCE(status,''))) = 'CLOSED' OR exit_type IS NOT NULL)
        AND COALESCE(actual_return, pnl_pct) IS NOT NULL
        AND COALESCE(outcome_date, closed_at) IS NOT NULL
        AND was_published = 1
      ORDER BY close_date ASC
    `).all() as Array<SqlRow>;
    let cum = 0;
    const cumulative_returns: Array<{ date: string; cumulative_return: number; closed: number }> = [];
    let closedIdx = 0;
    for (const r of closedRows) {
      cum += Number(r.eff_return);
      closedIdx++;
      const d = String(r.close_date).slice(0, 10);
      if (cumulative_returns.length > 0 && cumulative_returns[cumulative_returns.length - 1].date === d) {
        cumulative_returns[cumulative_returns.length - 1].cumulative_return = Math.round(cum * 100) / 100;
        cumulative_returns[cumulative_returns.length - 1].closed = closedIdx;
      } else {
        cumulative_returns.push({
          date: d,
          cumulative_return: Math.round(cum * 100) / 100,
          closed: closedIdx,
        });
      }
    }
    // Cap to last 200 points for chart readability
    const cappedCumulative = cumulative_returns.length > 200
      ? cumulative_returns.slice(-200)
      : cumulative_returns;

    // Filter by market if specified
    let filteredTotal = overall.total;
    let filteredClosed = overall.closed;
    let filteredWins = overall.wins;
    if (marketFilter !== 'all') {
      const m = marketFilter.toUpperCase();
      const marketData = byMarket.find((x) => x.market === m);
      if (marketData) {
        filteredTotal = marketData.total;
        filteredClosed = marketData.closed;
        filteredWins = marketData.wins;
      }
    }

    const winRate = filteredClosed > 0
      ? Math.round((Number(filteredWins) / filteredClosed) * 1000) / 10
      : 0;

    // KPI-AUDIT: compute audit fields (gold-standard alignment)
    // n_valid = rows that passed dedup + validation AND have a measurable return within ±50
    const auditNValid = byChannelMap.balanced.returns.length + byChannelMap.morning_bell.returns.length;
    const auditNExcluded = auditNRaw - auditNValid -
      // open/non-closed rows aren't 'excluded' — they're just not measured.
      // Count only rows excluded by a real reason in exclusion_breakdown.
      0;
    // Recompute n_excluded strictly as the sum of exclusion_breakdown entries
    const auditNExcludedStrict = Object.values(auditExclusionBreakdown)
      .reduce((s, v) => s + v, 0);

    return NextResponse.json({
      success: true,
      stats: {
        // FIX-P2-PREDICTIONS: every success-rate / win-rate / closed-count
        // field below is computed from rows WHERE was_published = 1.
        // Test/backfill predictions are excluded so the success rate only
        // reflects recommendations subscribers actually received. Frontends
        // can read `published_only` to display the corresponding disclaimer.
        published_only: true,
        total_predictions: filteredTotal,
        closed_predictions: filteredClosed,
        active_predictions: overall.active,
        pending_predictions: overall.active,
        pending: overall.active,
        target_hits: overall.target_hits,
        stop_hits: overall.stopped,
        stopped: overall.stopped,
        profit_taken: overall.profit_taken,
        expired: overall.expired,
        wins: filteredWins,
        losses: filteredClosed - filteredWins,
        buy_signals: overall.buys,
        sell_signals: overall.sells,
        real_win_rate: winRate,
        avg_return: overall.avg_return !== null ? Math.round(Number(overall.avg_return) * 100) / 100 : null,
        avg_profit: overall.avg_profit !== null ? Math.round(Number(overall.avg_profit) * 100) / 100 : null,
        // KPI-AUDIT: avg_loss must always be negative (gold standard)
        avg_loss: overall.avg_loss !== null
          ? -Math.abs(Math.round(Number(overall.avg_loss) * 100) / 100)
          : null,
        avg_max_profit: overall.avg_profit !== null ? Math.round(Number(overall.avg_profit) * 100) / 100 : null,
        avg_max_loss: overall.avg_loss !== null ? Math.round(Number(overall.avg_loss) * 100) / 100 : null,
        net_pl: Math.round(Number(overall.net_pl) * 100) / 100,
        avg_risk_reward: overall.avg_rr !== null ? Math.round(Number(overall.avg_rr) * 100) / 100 : null,
        avg_holding_days: overall.avg_holding_days !== null ? Math.round(Number(overall.avg_holding_days) * 10) / 10 : null,
        avg_confidence: overall.avg_confidence !== null ? Math.round(Number(overall.avg_confidence)) : null,
        sr_adoption_rate: srRate,
        candlestick_adoption_rate: candlestickRate,
        date_range: {
          earliest: dateRange.earliest,
          latest: dateRange.latest,
        },
        markets_covered: byMarket.map((m) => m.market),

        // ===== KPI-AUDIT: gold-standard alignment fields =====
        // (mirror /api/admin/platform-performance KPIs shape)
        n_raw: auditNRaw,
        n_valid: auditNValid,
        n_excluded: auditNExcludedStrict,
        n_excluded_total: auditNExcluded, // legacy alias (raw - valid)
        exclusion_breakdown: auditExclusionBreakdown,
        capped_rows: auditNCapped,
        hard_cap: HARD_CAP,
        audit_status: 'aligned',
        audit_note_ar:
          'KPI-AUDIT: محاذي مع gold standard. تم تطبيق HARD cap ±50، dedup على ' +
          '(ticker|prediction_date|channel|entry_price)، فصل القنوات ' +
          '(balanced/morning_bell)، و avg_loss سالب دائماً. ' +
          'ملاحظة: إحصائيات total_predictions/closed_predictions التراثية ' +
          'تأتي من SQL aggregation بدون dedup (للـ backward compat) — ' +
          'الـ KPI الجديدة (n_raw/n_valid/n_excluded/exclusion_breakdown) ' +
          'هي المصدر الدقيق.',
      },
      by_market: byMarket,
      // KPI-AUDIT: channel separation (gold standard)
      by_channel: byChannel,
      candlestick_patterns: patternStats,
      lessons,
      // HONEST-V2: extra fields for the new dashboard charts
      monthly_breakdown,
      cumulative_returns: cappedCumulative,
    }, {
      // GHOST-BUSTER-024: Cache-Control: no-store عشان نمنع التخزين على كل المستويات
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:stats]', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  } finally {
    db.close();
  }
}

function extractLessons(db: Database.Database, overall: OverallStatsRow): PredictionLesson[] {
  const lessons: PredictionLesson[] = [];
  const closed = Number(overall?.closed || 0);
  if (closed === 0) return lessons;

  try {
    // Lesson 1: High RSI failures
    const highRsiFailed = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND notes LIKE '%RSI=%'
      AND CAST(SUBSTR(notes, INSTR(notes, 'RSI=') + 4, 5) AS REAL) > 70
    `).get() as CountRow;
    if (Number(highRsiFailed?.c || 0) > 3) {
      const sample = Number(highRsiFailed.c);
      const failureRate = Math.round((sample / closed) * 100);
      lessons.push({
        type: 'technical',
        category: 'مؤشرات فنية',
        rule: 'لا تشتري عند RSI مرتفع (>70)',
        evidence: `${sample} صفقة خاسرة من ${closed} عند RSI > 70`,
        failure_rate: failureRate,
        sample_size: sample,
        recommendation: 'تفعيل فلتر RSI — تجنب الشراء إذا RSI > 70 إلا في حالة Momentum Accumulation',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 2: Low RSI failures
    const lowRsiFailed = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND notes LIKE '%RSI=%'
      AND CAST(SUBSTR(notes, INSTR(notes, 'RSI=') + 4, 5) AS REAL) < 30
    `).get() as CountRow;
    if (Number(lowRsiFailed?.c || 0) > 3) {
      const sample = Number(lowRsiFailed.c);
      const failureRate = Math.round((sample / closed) * 100);
      lessons.push({
        type: 'technical',
        category: 'مؤشرات فنية',
        rule: 'لا تبيع عند RSI منخفض (<30) — قد يكون ارتداد',
        evidence: `${sample} صفقة خاسرة من ${closed} عند RSI < 30`,
        failure_rate: failureRate,
        sample_size: sample,
        recommendation: 'تفعيل فلتر — عندما RSI < 30، انتظر تأكيد انعكاس قبل الدخول',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 3: Stop loss too tight
    const stopHit = db.prepare(`
      SELECT COUNT(*) as c, AVG(actual_return) as avg_ret FROM predictions
      WHERE outcome_date IS NOT NULL AND hit_stop = 1
    `).get() as CountRow;
    if (Number(stopHit?.c || 0) > 5) {
      const sample = Number(stopHit.c);
      const failureRate = Math.round((sample / closed) * 100);
      lessons.push({
        type: 'risk',
        category: 'إدارة مخاطر',
        rule: 'وقف الخسارة ضيق جداً — {stopHit.c} صفقة ضربت الوقف',
        evidence: `${sample} صفقة ضربت الوقف من ${closed} (${failureRate}%)`,
        failure_rate: failureRate,
        sample_size: sample,
        recommendation: 'توسيع الوقف باستخدام ATR × 2.5 بدل 2.0، أو استخدام Trailing Stop',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 4: Low R:R trades
    const lowRR = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND target_price IS NOT NULL AND stop_loss IS NOT NULL AND entry_price > 0
      AND (target_price - entry_price) / (entry_price - stop_loss) < 1.5
    `).get() as CountRow;
    if (Number(lowRR?.c || 0) > 3) {
      const sample = Number(lowRR.c);
      const failureRate = Math.round((sample / closed) * 100);
      lessons.push({
        type: 'risk',
        category: 'إدارة مخاطر',
        rule: 'صفقات بنسبة R:R أقل من 1.5 فشلت بنسبة عالية',
        evidence: `${sample} صفقة خاسرة من ${closed} بـ R:R < 1.5`,
        failure_rate: failureRate,
        sample_size: sample,
        recommendation: 'رفع الحد الأدنى لـ R:R إلى 1.5 على الأقل، ويفضل 2.0',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 5: SELL signals performance
    const sellWins = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL AND is_correct = 1
    `).get() as CountRow;
    const sellTotal = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL
    `).get() as CountRow;
    if (Number(sellTotal?.c || 0) > 5) {
      const total = Number(sellTotal.c);
      const wins = Number(sellWins?.c || 0);
      const sellWinRate = Math.round((wins / total) * 100);
      if (sellWinRate < 40) {
        lessons.push({
          type: 'strategy',
          category: 'استراتيجية',
          rule: 'إشارات البيع أداؤها ضعيف — نسبة نجاح {sellWinRate}%',
          evidence: `${wins} فوز من ${total} صفقة بيع`,
          failure_rate: 100 - sellWinRate,
          sample_size: total,
          recommendation: 'تجنب صفقات البيع المكشوف في الأسواق الصاعدة — ركز على الشراء فقط',
          created_at: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Lessons extraction is best-effort
  }

  return lessons;
}
