/**
 * Prediction Credibility API
 * ===========================
 * Reads REAL prediction data from predictions.db (predictions table)
 * and returns the schema expected by PredictionCredibilityTable.tsx:
 *   { predictions: Prediction[], summary: Summary, daily_pl: DailyPlPoint[] }
 *
 * FIXED: was proxying to /api/market-pulse (wrong data entirely) — see worklog FIX-CREDIBILITY
 *
 * KPI-AUDIT (gold-standard alignment with /api/admin/platform-performance):
 *   - HARD cap: ABS(actual_return) <= 50 (Constitution Rule 7)
 *   - Dedup on (ticker, prediction_date, channel, entry_price)
 *   - Channel separation: balanced ≠ morning_bell (morning_bell=1)
 *   - audit fields in summary: n_raw, n_valid, n_excluded,
 *     exclusion_breakdown, capped_rows, by_channel
 *   - avg_loss always negative
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

// Gold-standard constants (mirror /api/admin/platform-performance)
const HARD_CAP = 50.0; // Constitution Rule 7: ABS(actual_return) <= 50

function openDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  try {
    return new Database(dbPath, { readonly: true, timeout: 3000 });
  } catch {
    return new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
  }
}

// Egyptian ticker detection: EGX tickers are alphabetic (COMI, FWRY, ESRS),
// Saudi tickers are numeric (1120, 2222), Kuwaiti start with a digit too.
function inferMarket(ticker: string): string {
  if (!ticker) return 'EGX';
  if (/^\d+$/.test(ticker)) return 'TADAWUL';
  return 'EGX';
}

function inferPersona(masterScore: number | null, signal: string): string {
  if (signal === 'HOLD') return 'general';
  if (masterScore !== null && masterScore >= 70) return 'investor';
  return 'gambler';
}

// P29-V20-CREDIBILITY: helper for safe boolean coercion from DB/JSON values
function bool(v: any): boolean {
  if (v === true || v === 1 || v === 'true' || v === '1') return true;
  return false;
}

export async function GET(request: NextRequest) {
  const db = openDb();
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || ''; // YYYY-MM
    const market = searchParams.get('market') || ''; // EGX, TADAWUL, ...
    const persona = searchParams.get('persona') || 'all'; // all, investor, gambler, general
    const limit = Math.min(parseInt(searchParams.get('limit') || '2000'), 5000);
    const minScore = parseFloat(searchParams.get('min_score') || '0');

    // Build query with filters
    // P29-RESILIENT: detect available columns once (sandbox may lack prediction_date/outcome_date)
    const predCols = db.prepare("PRAGMA table_info(predictions)").all() as any[];
    const hasCol = (name: string) => predCols.some(c => c.name === name);
    const dateCol = hasCol('prediction_date') ? 'prediction_date' : 'created_at';
    const outCol = hasCol('outcome_date') ? 'outcome_date' : 'closed_at';
    const exitCol = hasCol('exit_price') ? 'exit_price' : 'NULL';
    const highCol = hasCol('highest_price_reached') ? 'highest_price_reached' : 'NULL';
    const atrCol = hasCol('atr_at_entry') ? 'atr_at_entry' : 'NULL';
    const scoreCol = hasCol('master_score') ? 'master_score' : (hasCol('score') ? 'score' : 'confidence');
    const notesCol = hasCol('notes') ? 'notes' : 'NULL';
    // KPI-AUDIT: morning_bell for channel separation (gold standard)
    const morningBellCol = hasCol('morning_bell') ? 'morning_bell' : '0';
    const personaCol = hasCol('persona') ? 'persona' : "'balanced'";

    const conditions: string[] = [];
    const params: any[] = [];

    if (month) {
      conditions.push(`${dateCol} LIKE ?`);
      params.push(`${month}%`);
    }
    if (minScore > 0) {
      conditions.push(`(${scoreCol} >= ? OR ${scoreCol} IS NULL)`);
      params.push(minScore);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Show newest predictions first across all days (July 30, July 29, July 28, etc.)
    // P29-RESILIENT: use detected column names (dateCol) for sandbox/prod compatibility
    const orderBy = `ORDER BY ${dateCol} DESC, id DESC`;

    // Fetch ALL matching predictions (no SQL LIMIT).
    // The summary + daily_pl below are computed from this full filtered set so
    // they reflect the global picture — not just the displayed page. The
    // `predictions` array sent to the UI is sliced to `limit` at the end for
    // display performance. (Previously: SQL LIMIT ? → summary only reflected
    // the displayed page, so a closed prediction outside the page was
    // invisible to win_rate / daily_pl. See VERIFY-PENDING worklog.)
    const rows = db.prepare(`
      SELECT id, ticker, signal, signal_type, ${dateCol} as prediction_date,
             entry_price, target_price, stop_loss, ${scoreCol} as master_score,
             technical_score, fundamental_score, ai_pattern_score, sentiment_score,
             ${outCol} as outcome_date, ${exitCol} as exit_price, actual_return, hit_target, hit_stop,
             is_correct, holding_days, ${notesCol} as notes, created_at,
             ${highCol} as highest_price_reached, ${atrCol} as atr_at_entry,
             ${morningBellCol} as morning_bell, ${personaCol} as persona
      FROM predictions
      ${whereClause}
      ${orderBy}
    `).bind(...params).all() as any[];

    // P29-V20-CREDIBILITY: استخرج مؤشرات الـ V20 Fusion + SMC + Dip Buying
    // من stored_analyses.analysis_json (نفس الـ DB). ده بيخلي المستخدم يشوف
    // العقل بيفكر إزاي: V20 Score، SMC Order Blocks، Dip Buying badge.
    // بنعمل map بـ ticker لأن stored_analyses آخر تحليل لكل سهم.
    // ملاحظة: بنشتغل بس لو فيه predictions (توفير memory لو الـ table فاضي).
    const v18Indicators: Record<string, { v20_score: number | null; smc_score: number | null; dip_buy: boolean; dip_reason: string; fusion_ready: boolean }> = {};
    if (rows.length > 0) {
      try {
        const tickers = [...new Set(rows.map((r: any) => r.ticker))];
        const placeholders = tickers.map(() => '?').join(',');
        const saRows = db.prepare(`
          SELECT ticker, analysis_json FROM stored_analyses
          WHERE ticker IN (${placeholders})
          ORDER BY updated_at DESC
        `).bind(...tickers).all() as any[];
        for (const sa of saRows) {
          if (v18Indicators[sa.ticker]) continue;
          let aj: any = {};
          try { aj = JSON.parse(sa.analysis_json || '{}'); } catch { aj = {}; }
          const fusion = aj.fusion_metrics || aj.fusionMetrics || {};
          const risk = aj.risk_profile || aj.riskProfile || {};
          v18Indicators[sa.ticker] = {
            v20_score: fusion.score != null ? Number(fusion.score) : (aj.fusion_score != null ? Number(aj.fusion_score) : null),
            smc_score: aj.smc_score != null ? Number(aj.smc_score) : null,
            dip_buy: bool(risk.dip_buy_qualified),
            dip_reason: String(risk.dip_buy_reason || ''),
            fusion_ready: bool(fusion.ready),
          };
        }
      } catch {
        // stored_analyses table might not exist — skip silently
      }
    }

    // Transform to frontend schema + apply post-query filters (market, persona)
    const allFiltered = rows
      .map((r) => {
        const pMarket = inferMarket(r.ticker);
        const pPersona = inferPersona(r.master_score, r.signal);
        // KPI-AUDIT: channel from morning_bell column (gold standard)
        const isMorningBell = Number(r.morning_bell || 0) === 1;
        const channel = isMorningBell ? 'morning_bell' : 'balanced';
        let status: 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | 'PROFIT_TAKEN' | 'PENDING';
        if (r.outcome_date && r.hit_target) status = 'TARGET_HIT';
        else if (r.outcome_date && r.hit_stop) status = 'STOPPED';
        else if (r.outcome_date && r.actual_return !== null && Number(r.actual_return) > 0) {
          // Closed with profit but didn't hit exact target → PROFIT_TAKEN
          // (technical exit signal: RSI overbought, MA reversal, trailing stop)
          status = 'PROFIT_TAKEN';
        }
        else if (r.outcome_date) status = 'EXPIRED';
        else status = 'PENDING';

        const actualReturn = r.actual_return !== null ? Number(r.actual_return) : null;
        const isClosed = status !== 'PENDING';
        const daysHeld = isClosed ? (r.holding_days || 0) : 0;

        // best_price = highest_price_reached or exit_price
        const bestPrice = r.highest_price_reached !== null
          ? Number(r.highest_price_reached)
          : (r.exit_price !== null ? Number(r.exit_price) : null);

        let profitAtBest: number | null = null;
        if (bestPrice !== null && r.entry_price) {
          profitAtBest = ((bestPrice - r.entry_price) / r.entry_price) * 100;
        }

        return {
          id: String(r.id),
          source: 'maestro',
          ticker: r.ticker,
          name_ar: null,
          recommendation: r.signal || 'HOLD',
          recommendation_ar: null,
          confidence: r.master_score !== null ? Number(r.master_score) : null,
          entry_price: r.entry_price ? Number(r.entry_price) : 0,
          target_price: r.target_price !== null ? Number(r.target_price) : null,
          stop_loss: r.stop_loss !== null ? Number(r.stop_loss) : null,
          market: pMarket,
          persona: pPersona,
          // KPI-AUDIT: channel for balanced/morning_bell separation
          channel,
          is_morning_bell: isMorningBell,
          prediction_date: r.prediction_date,
          master_score: r.master_score !== null ? Number(r.master_score) : null,
          technical_score: r.technical_score !== null ? Number(r.technical_score) : null,
          // P29-V20-CREDIBILITY: مؤشرات العقل الجديد (V20 Fusion + SMC + Dip Buying)
          v20_score: v18Indicators[r.ticker]?.v20_score ?? null,
          smc_score: v18Indicators[r.ticker]?.smc_score ?? null,
          dip_buy_qualified: v18Indicators[r.ticker]?.dip_buy ?? false,
          dip_buy_reason: v18Indicators[r.ticker]?.dip_reason ?? '',
          fusion_ready: v18Indicators[r.ticker]?.fusion_ready ?? false,
          status,
          actual_return: actualReturn,
          highest_price: r.highest_price_reached !== null ? Number(r.highest_price_reached) : null,
          highest_date: null,
          days_to_highest: null,
          profit_at_highest: profitAtBest,
          lowest_price: null,
          days_to_lowest: null,
          profit_at_lowest: null,
          best_price: bestPrice,
          best_date: r.outcome_date,
          days_to_best: isClosed ? daysHeld : null,
          profit_at_best: profitAtBest,
          outcome_date: r.outcome_date,
          days_to_result: isClosed ? daysHeld : null,
          final_price: r.exit_price !== null ? Number(r.exit_price) : null,
          is_closed: isClosed,
          days_held: daysHeld,
          recommendation_date: r.prediction_date,
          created_at: r.created_at,
        };
      })
      .filter((p) => {
        if (market && p.market !== market.toUpperCase()) return false;
        if (persona !== 'all' && p.persona !== persona) return false;
        return true;
      });

    // ===== KPI-AUDIT (gold-standard alignment) =====
    // Dedup on (ticker, prediction_date, channel, entry_price), track raw /
    // valid / excluded / capped breakdown, and split by channel.
    const auditSeenKeys = new Set<string>();
    const exclusionBreakdown: Record<string, number> = {};
    let nRaw = 0;
    let nCapped = 0;
    const byChannelMap: Record<string, {
      n_raw: number; n_closed: number; wins: number; losses: number;
      net_pl: number; returns: number[]; capped: number;
    }> = {
      balanced: { n_raw: 0, n_closed: 0, wins: 0, losses: 0, net_pl: 0, returns: [], capped: 0 },
      morning_bell: { n_raw: 0, n_closed: 0, wins: 0, losses: 0, net_pl: 0, returns: [], capped: 0 },
    };

    const dedupedFiltered: typeof allFiltered = [];
    for (const p of allFiltered) {
      nRaw++;
      const tickerNorm = String(p.ticker || '').trim().toUpperCase();
      const entry = Number(p.entry_price) || 0;
      const ch = (p as any).channel as 'balanced' | 'morning_bell';
      const dedupKey = `${tickerNorm}|${p.prediction_date || ''}|${ch}|${entry.toFixed(4)}`;

      // Validate ticker + entry (gold-standard rules)
      if (!tickerNorm || tickerNorm.includes(' ') || tickerNorm.length > 12) {
        exclusionBreakdown['ticker_invalid'] = (exclusionBreakdown['ticker_invalid'] || 0) + 1;
        continue;
      }
      if (!entry || entry <= 0) {
        exclusionBreakdown['entry_price_zero'] = (exclusionBreakdown['entry_price_zero'] || 0) + 1;
        continue;
      }
      if (auditSeenKeys.has(dedupKey)) {
        exclusionBreakdown['duplicate'] = (exclusionBreakdown['duplicate'] || 0) + 1;
        continue;
      }
      auditSeenKeys.add(dedupKey);
      dedupedFiltered.push(p);

      byChannelMap[ch].n_raw++;
      if (p.is_closed) {
        byChannelMap[ch].n_closed++;
        if (p.actual_return !== null) {
          const r = p.actual_return as number;
          if (Math.abs(r) > HARD_CAP) {
            // capped — excluded from KPI averages (gold standard)
            nCapped++;
            exclusionBreakdown['capped_outside_50'] = (exclusionBreakdown['capped_outside_50'] || 0) + 1;
            byChannelMap[ch].capped++;
          } else {
            byChannelMap[ch].returns.push(r);
            byChannelMap[ch].net_pl += r;
            if (r > 0) byChannelMap[ch].wins++;
            else if (r < 0) byChannelMap[ch].losses++;
          }
        } else {
          exclusionBreakdown['no_return'] = (exclusionBreakdown['no_return'] || 0) + 1;
        }
      }
    }

    // n_excluded = rows excluded by a real reason (sum of exclusion_breakdown)
    const nExcluded = Object.values(exclusionBreakdown).reduce((s, v) => s + v, 0);

    // Compute summary from the FULL filtered set (not just the displayed page)
    // 🔥 P0-UI FIX: cap على |actual_return| بـ 50% (كان 200% — بـ يمرّر toxic rows).
    // الـ toxic rows (AGIN/UNFO بـ actual_return ≈ -10814%) كانت بـ تخرب المتوسطات
    // حتى بعد ما purge_prediction_disasters.py صنّفها 'toxic'. الـ cap ده defense-in-depth
    // alongside the data_quality='clean' filter at the SQL level (where applicable).
    // KPI-AUDIT: RETURN_CAP = HARD_CAP (50) — gold standard.
    const RETURN_CAP = HARD_CAP;
    const validForStats = dedupedFiltered.filter((p) => {
      if (p.actual_return === null) return true; // PENDING — include in total
      const r = p.actual_return as number;
      return Math.abs(r) <= RETURN_CAP; // exclude toxic/impossible returns
    });

    const total = validForStats.length;
    const targetHit = validForStats.filter((p) => p.status === 'TARGET_HIT').length;
    const stopped = validForStats.filter((p) => p.status === 'STOPPED').length;
    const expired = validForStats.filter((p) => p.status === 'EXPIRED').length;
    const profitTaken = validForStats.filter((p) => p.status === 'PROFIT_TAKEN').length;
    const active = validForStats.filter((p) => p.status === 'PENDING').length;
    const closed = targetHit + stopped + expired + profitTaken;

    // Win rate = profitability-based (is_correct = actual_return > 0)
    const returns = validForStats
      .filter((p) => p.actual_return !== null && Math.abs(p.actual_return as number) <= RETURN_CAP)
      .map((p) => p.actual_return as number);
    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r < 0);
    const winRate = returns.length > 0 ? (wins.length / returns.length) * 100 : 0;

    const avgProfit = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    // KPI-AUDIT: avg_loss ALWAYS negative (gold standard).
    // losses[] are already negative numbers; -Math.abs() is defensive.
    const avgLossRaw = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    const avgLoss = losses.length > 0 ? -Math.abs(avgLossRaw) : 0;
    const totalProfit = wins.reduce((a, b) => a + b, 0);
    const totalLoss = losses.reduce((a, b) => a + b, 0); // negative
    const netPl = totalProfit + totalLoss;

    // best opportunity: highest profit_at_best among closed
    let bestOpp: { ticker: string; profit_at_best: number | null; days_to_best: number | null } | null = null;
    const closedPreds = dedupedFiltered.filter((p) => p.is_closed && p.profit_at_best !== null);
    if (closedPreds.length > 0) {
      const best = closedPreds.reduce((a, b) =>
        (a.profit_at_best || -Infinity) > (b.profit_at_best || -Infinity) ? a : b
      );
      bestOpp = {
        ticker: best.ticker,
        profit_at_best: best.profit_at_best,
        days_to_best: best.days_to_best,
      };
    }

    // by_market breakdown
    const byMarket: Record<string, { total: number; target_hit: number; stopped: number; active: number; win_rate: number }> = {};
    for (const p of dedupedFiltered) {
      if (!byMarket[p.market]) {
        byMarket[p.market] = { total: 0, target_hit: 0, stopped: 0, active: 0, win_rate: 0 };
      }
      const m = byMarket[p.market];
      m.total++;
      if (p.status === 'TARGET_HIT') m.target_hit++;
      else if (p.status === 'STOPPED') m.stopped++;
      else if (p.status === 'PENDING') m.active++;
    }
    for (const key of Object.keys(byMarket)) {
      const m = byMarket[key];
      const mClosed = m.target_hit + m.stopped;
      m.win_rate = mClosed > 0 ? (m.target_hit / mClosed) * 100 : 0;
    }

    // KPI-AUDIT: by_channel stats (gold-standard ChannelStats shape)
    const byChannel = (Object.keys(byChannelMap) as Array<'balanced' | 'morning_bell'>)
      .filter((ch) => byChannelMap[ch].n_raw > 0)
      .map((ch) => {
        const v = byChannelMap[ch];
        const chReturns = v.returns;
        const chWins = chReturns.filter((r) => r > 0);
        const chLosses = chReturns.filter((r) => r < 0);
        const grossProfit = chWins.reduce((s, r) => s + r, 0);
        const grossLossAmount = chLosses.reduce((s, r) => s + Math.abs(r), 0);
        const pf = grossLossAmount > 0 ? grossProfit / grossLossAmount : (grossProfit > 0 ? Infinity : 0);
        const avgWin = chWins.length > 0 ? grossProfit / chWins.length : 0;
        // avg_loss ALWAYS negative (gold standard)
        const avgLossCh = chLosses.length > 0 ? -(grossLossAmount / chLosses.length) : 0;
        const expectancy = chReturns.length > 0
          ? chReturns.reduce((s, r) => s + r, 0) / chReturns.length : 0;
        const maxLoss = chLosses.length > 0 ? Math.min(...chLosses) : 0;
        return {
          channel: ch,
          n: chReturns.length,
          n_raw: v.n_raw,
          n_closed: v.n_closed,
          capped: v.capped,
          win_rate: chReturns.length > 0 ? (chWins.length / chReturns.length) * 100 : 0,
          profit_factor: pf === Infinity ? 0 : pf,
          expectancy_pct: expectancy,
          avg_win_pct: avgWin,
          avg_loss_pct: avgLossCh, // negative
          max_loss_pct: maxLoss, // negative
          net_pl: v.net_pl,
        };
      });

    // KPI-AUDIT: n_valid = rows that passed dedup + validation AND have a
    // measurable return within ±50 (i.e. the rows in by_channel.returns summed).
    const nValid = byChannelMap.balanced.returns.length + byChannelMap.morning_bell.returns.length;

    const summary = {
      total,
      target_hit: targetHit,
      stopped,
      expired,
      active,
      win_rate: winRate,
      avg_profit: avgProfit,
      avg_loss: avgLoss,
      total_profit: totalProfit,
      total_loss: totalLoss,
      net_pl: netPl,
      best_opportunity: bestOpp,
      by_market: byMarket,

      // ===== KPI-AUDIT: gold-standard alignment fields =====
      // (mirror /api/admin/platform-performance KPIs shape)
      n_raw: nRaw,
      n_valid: nValid,
      n_excluded: nExcluded,
      exclusion_breakdown: exclusionBreakdown,
      capped_rows: nCapped,
      hard_cap: HARD_CAP,
      by_channel: byChannel,
      audit_status: 'aligned',
      audit_note_ar:
        'KPI-AUDIT: محاذي مع gold standard. تم تطبيق HARD cap ±50، dedup على ' +
        '(ticker|prediction_date|channel|entry_price)، فصل القنوات ' +
        '(balanced/morning_bell)، و avg_loss سالب دائماً. ' +
        'ملاحظة: summary.total يشمل PENDING + closed-with-return-within-±50 ' +
        'من الـ dedupedFiltered (وليس كل الـ rows الأصلية). ' +
        'الـ KPI الجديدة (n_raw/n_valid/n_excluded/exclusion_breakdown) ' +
        'هي المصدر الدقيق.',
    };

    // daily_pl: aggregate by date over ALL closed predictions (full filtered set)
    const dailyMap: Record<string, { daily: number; wins: number; losses: number }> = {};
    for (const p of dedupedFiltered) {
      if (!p.is_closed || p.actual_return === null) continue;
      // KPI-AUDIT: respect HARD cap ±50 (gold standard)
      if (Math.abs(p.actual_return as number) > HARD_CAP) continue;
      const date = (p.outcome_date || p.created_at || '').slice(0, 10);
      if (!date) continue;
      if (!dailyMap[date]) dailyMap[date] = { daily: 0, wins: 0, losses: 0 };
      dailyMap[date].daily += p.actual_return as number;
      if ((p.actual_return as number) > 0) dailyMap[date].wins++;
      else if ((p.actual_return as number) < 0) dailyMap[date].losses++;
    }
    const dailyPl = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, daily: v.daily, wins: v.wins, losses: v.losses, cumulative: 0 }));

    // cumulative
    let cum = 0;
    for (const d of dailyPl) {
      cum += d.daily;
      d.cumulative = cum;
    }

    // Display list: slice to `limit` for UI rendering perf.
    // (Summary + daily_pl above already reflect the full filtered set — now deduped.)
    const predictions = dedupedFiltered.slice(0, limit);

    return NextResponse.json({
      success: true,
      predictions,
      summary,
      daily_pl: dailyPl,
      count: predictions.length,
      total_matching: dedupedFiltered.length,
    });
  } catch (e) {
    console.error('[predictions:credibility]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error', predictions: [], summary: null, daily_pl: [] },
      { status: 500 }
    );
  } finally {
    db.close();
  }
}
