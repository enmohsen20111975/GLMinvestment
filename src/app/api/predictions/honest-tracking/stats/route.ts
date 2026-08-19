/**
 * Honest Prediction Tracking API — Stats
 * =======================================
 * Updated: reads market column from predictions table (not inferMarket).
 * Also tracks S/R, candlestick, heaviest losers, lessons.
 *
 * Returns: total, closed, target_hits, stopped, expired, profit_taken,
 * active, win_rate, avg_return, by_market, by_signal, date_range, lessons
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureSchema } from '@/lib/honest-tracking/maestro';

export const dynamic = 'force-dynamic';

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

    // Overall stats from predictions table
    // SCHEMA-MISMATCH-FIX: التوقعات المقفولة = outcome_date OR status='CLOSED' OR
    // exit_type IS NOT NULL. العائد الفعلي = COALESCE(actual_return, pnl_pct).
    const overall = db.prepare(`
      WITH pred AS (
        SELECT *,
          (outcome_date IS NOT NULL
            OR UPPER(TRIM(COALESCE(status, ''))) = 'CLOSED'
            OR exit_type IS NOT NULL) AS is_closed,
          COALESCE(actual_return, pnl_pct) AS eff_return
        FROM predictions
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
        -- FILTER OUT impossible returns (>100% or <-90%) — these are data errors
        -- from wrong entry_price (stock splits, denomination changes, etc.)
        AVG(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return <= 100 AND eff_return >= -90 THEN eff_return END) as avg_return,
        AVG(CASE WHEN is_closed AND eff_return > 0 AND eff_return <= 100 THEN eff_return END) as avg_profit,
        AVG(CASE WHEN is_closed AND eff_return < 0 AND eff_return >= -90 THEN eff_return END) as avg_loss,
        SUM(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return <= 100 AND eff_return >= -90 THEN eff_return ELSE 0 END) as net_pl,
        AVG(CASE WHEN is_closed AND eff_return IS NOT NULL AND eff_return <= 100 AND eff_return >= -90 THEN risk_reward END) as avg_rr,
        AVG(CASE WHEN is_closed THEN holding_days END) as avg_holding_days,
        AVG(CASE WHEN is_closed AND master_score IS NOT NULL THEN master_score END) as avg_confidence
      FROM pred
    `).get() as any;

    // By market — use actual market column with fallback
    const allRows = db.prepare(`
      SELECT ticker, market, signal_type, outcome_date, status, exit_type,
             hit_target, hit_stop, actual_return, pnl_pct, is_correct, notes
      FROM predictions
    `).all() as any[];

    const byMarketMap: Record<string, { total: number; wins: number; losses: number; closed: number; active: number; pending: number; win_rate: number; net_pl: number; sr_adoption: number; avg_return: number | null }> = {};
    const returnsByMarket: Record<string, number[]> = {};
    for (const r of allRows) {
      const m = inferMarket(r.ticker, r.market);
      if (!byMarketMap[m]) byMarketMap[m] = { total: 0, wins: 0, losses: 0, closed: 0, active: 0, pending: 0, win_rate: 0, net_pl: 0, sr_adoption: 0, avg_return: null };
      if (!returnsByMarket[m]) returnsByMarket[m] = [];
      byMarketMap[m].total++;
      // SCHEMA-MISMATCH-FIX: is_closed = outcome_date OR status='CLOSED' OR exit_type
      const statusNorm = (r.status || '').toString().trim().toUpperCase();
      const isClosed = !!r.outcome_date || statusNorm === 'CLOSED' || !!r.exit_type;
      const effReturn = r.actual_return !== null && r.actual_return !== undefined
        ? Number(r.actual_return)
        : (r.pnl_pct !== null && r.pnl_pct !== undefined ? Number(r.pnl_pct) : null);
      if (isClosed) {
        byMarketMap[m].closed++;
        const isWin = r.is_correct === 1
          || (r.is_correct === null && effReturn !== null && effReturn > 0);
        if (isWin) byMarketMap[m].wins++;
        else byMarketMap[m].losses++;
        if (effReturn !== null) {
          // FILTER OUT impossible returns (>100% or <-90%)
          if (effReturn <= 100 && effReturn >= -90) {
            byMarketMap[m].net_pl += effReturn;
            returnsByMarket[m].push(effReturn);
          }
        }
      } else {
        byMarketMap[m].active++;
        byMarketMap[m].pending++;
      }
      if (r.notes && (r.notes.includes('support=') || r.notes.includes('resistance='))) {
        byMarketMap[m].sr_adoption++;
      }
    }
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
    `).get() as any;

    // S/R confidence
    const srCount = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE notes LIKE '%support=%' OR notes LIKE '%resistance=%'
    `).get() as any;
    const srRate = overall.total > 0 ? Math.round((Number(srCount.c) / overall.total) * 1000) / 10 : 0;

    // Candlestick patterns
    const candleCount = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE notes LIKE '%candle=%'
    `).get() as any;
    const candlestickRate = overall.total > 0 ? Math.round((Number(candleCount.c) / overall.total) * 1000) / 10 : 0;

    // Candlestick pattern performance
    const candlePatterns = db.prepare(`
      SELECT notes, hit_target, hit_stop, is_correct, outcome_date
      FROM predictions
      WHERE notes LIKE '%candle=%'
    `).all() as any[];
    const patternMap: Record<string, { count: number; wins: number; losses: number }> = {};
    for (const r of candlePatterns) {
      const match = (r.notes || '').match(/candle=([A-Z_]+)/);
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
    const monthlyRows = db.prepare(`
      SELECT
        SUBSTR(prediction_date, 1, 7) as month,
        COUNT(*) as total,
        SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN outcome_date IS NOT NULL AND is_correct = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN outcome_date IS NOT NULL AND actual_return IS NOT NULL THEN actual_return ELSE 0 END) as net_pl
      FROM predictions
      GROUP BY SUBSTR(prediction_date, 1, 7)
      ORDER BY month ASC
    `).all() as any[];
    const monthly_breakdown = monthlyRows.map(r => ({
      month: r.month,
      net_pl: Math.round(Number(r.net_pl || 0) * 100) / 100,
      closed: Number(r.closed || 0),
      wins: Number(r.wins || 0),
      win_rate: r.closed > 0 ? Math.round((Number(r.wins) / Number(r.closed)) * 1000) / 10 : 0,
    }));

    // Cumulative returns time-series (closed predictions sorted by outcome_date / closed_at)
    // SCHEMA-MISMATCH-FIX: شامل التوقعات المقفولة بـ trading pipeline (status/exit_type)
    const closedRows = db.prepare(`
      SELECT COALESCE(outcome_date, closed_at) as close_date, COALESCE(actual_return, pnl_pct) as eff_return
      FROM predictions
      WHERE (outcome_date IS NOT NULL OR UPPER(TRIM(COALESCE(status,''))) = 'CLOSED' OR exit_type IS NOT NULL)
        AND COALESCE(actual_return, pnl_pct) IS NOT NULL
        AND COALESCE(outcome_date, closed_at) IS NOT NULL
      ORDER BY close_date ASC
    `).all() as any[];
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

    return NextResponse.json({
      success: true,
      stats: {
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
        avg_loss: overall.avg_loss !== null ? Math.round(Number(overall.avg_loss) * 100) / 100 : null,
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
      },
      by_market: byMarket,
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    db.close();
  }
}

function extractLessons(db: Database.Database, overall: any): any[] {
  const lessons: any[] = [];
  const closed = Number(overall?.closed || 0);
  if (closed === 0) return lessons;

  try {
    // Lesson 1: High RSI failures
    const highRsiFailed = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND notes LIKE '%RSI=%'
      AND CAST(SUBSTR(notes, INSTR(notes, 'RSI=') + 4, 5) AS REAL) > 70
    `).get() as any;
    if (highRsiFailed?.c > 3) {
      const failureRate = Math.round((Number(highRsiFailed.c) / closed) * 100);
      lessons.push({
        type: 'technical',
        category: 'مؤشرات فنية',
        rule: 'لا تشتري عند RSI مرتفع (>70)',
        evidence: `${highRsiFailed.c} صفقة خاسرة من ${closed} عند RSI > 70`,
        failure_rate: failureRate,
        sample_size: Number(highRsiFailed.c),
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
    `).get() as any;
    if (lowRsiFailed?.c > 3) {
      const failureRate = Math.round((Number(lowRsiFailed.c) / closed) * 100);
      lessons.push({
        type: 'technical',
        category: 'مؤشرات فنية',
        rule: 'لا تبيع عند RSI منخفض (<30) — قد يكون ارتداد',
        evidence: `${lowRsiFailed.c} صفقة خاسرة من ${closed} عند RSI < 30`,
        failure_rate: failureRate,
        sample_size: Number(lowRsiFailed.c),
        recommendation: 'تفعيل فلتر — عندما RSI < 30، انتظر تأكيد انعكاس قبل الدخول',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 3: Stop loss too tight
    const stopHit = db.prepare(`
      SELECT COUNT(*) as c, AVG(actual_return) as avg_ret FROM predictions
      WHERE outcome_date IS NOT NULL AND hit_stop = 1
    `).get() as any;
    if (stopHit?.c > 5) {
      const failureRate = Math.round((Number(stopHit.c) / closed) * 100);
      lessons.push({
        type: 'risk',
        category: 'إدارة مخاطر',
        rule: 'وقف الخسارة ضيق جداً — {stopHit.c} صفقة ضربت الوقف',
        evidence: `${stopHit.c} صفقة ضربت الوقف من ${closed} (${failureRate}%)`,
        failure_rate: failureRate,
        sample_size: Number(stopHit.c),
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
    `).get() as any;
    if (lowRR?.c > 3) {
      const failureRate = Math.round((Number(lowRR.c) / closed) * 100);
      lessons.push({
        type: 'risk',
        category: 'إدارة مخاطر',
        rule: 'صفقات بنسبة R:R أقل من 1.5 فشلت بنسبة عالية',
        evidence: `${lowRR.c} صفقة خاسرة من ${closed} بـ R:R < 1.5`,
        failure_rate: failureRate,
        sample_size: Number(lowRR.c),
        recommendation: 'رفع الحد الأدنى لـ R:R إلى 1.5 على الأقل، ويفضل 2.0',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 5: SELL signals performance
    const sellWins = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL AND is_correct = 1
    `).get() as any;
    const sellTotal = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL
    `).get() as any;
    if (sellTotal?.c > 5) {
      const sellWinRate = Math.round((Number(sellWins?.c || 0) / Number(sellTotal.c)) * 100);
      if (sellWinRate < 40) {
        lessons.push({
          type: 'strategy',
          category: 'استراتيجية',
          rule: 'إشارات البيع أداؤها ضعيف — نسبة نجاح {sellWinRate}%',
          evidence: `${sellWins?.c || 0} فوز من ${sellTotal.c} صفقة بيع`,
          failure_rate: 100 - sellWinRate,
          sample_size: Number(sellTotal.c),
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
