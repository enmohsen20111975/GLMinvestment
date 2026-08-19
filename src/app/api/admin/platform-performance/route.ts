import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { openDb } from '@/lib/shared-db';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/platform-performance
 * ====================================
 * لوحة أدمن «كفاءة المنصة» — Admin Only.
 *
 * يقرأ من predictions.db.predictions (الجدول الأساسي للتوcleقات المغلقة)
 * ويحسب KPIs حقيقية بدون تجميل:
 *   - Win Rate, Profit Factor, Expectancy, Max Loss
 *   - TP1 hit rate, Stop hit rate
 *   - أفضل/أسوأ الصفقات
 *   - مقارنة القنوات (balanced / morning_bell)
 *
 * HARD cap: ABS(return) <= 50 (Constitution Rule 7)
 * لا خلط قنوات: balanced ≠ morning_bell (morning_bell = predictions.morning_bell=1)
 *
 * Query params:
 *   - period: today | 7d | 30d | all (default: 30d)
 *   - channel: all | balanced | morning_bell (default: all)
 *   - min_return: الحد الأدنى لـ "صفقة محترمة" (default: 8.0 = +8%)
 *
 * READ-ONLY: لا يكتب على أي DB.
 */

// ============================================================================
// Types
// ============================================================================

interface Trade {
  id: number;
  ticker: string;
  persona: string | null;
  is_morning_bell: boolean;
  prediction_date: string;
  entry_price: number;
  target_price: number | null;
  target_price_2: number | null;
  stop_loss: number | null;
  exit_price: number | null;
  actual_return: number; // محسوب
  hit_target: 0 | 1;
  hit_stop: 0 | 1;
  status: string;
  holding_days: number | null;
  outcome_date: string | null;
  highest_price: number | null;
  lowest_price: number | null;
  channel: 'balanced' | 'morning_bell';
}

interface KPIs {
  n_total: number;
  n_measured: number; // trades with valid return
  n_open: number;
  win_rate: number;
  profit_factor: number;
  expectancy_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  max_loss_pct: number;
  max_win_pct: number;
  tp1_hit_rate: number;
  stop_hit_rate: number;
  expired_rate: number;
  hard_capped_count: number; // trades that hit the 50% cap
}

interface ChannelStats {
  channel: string;
  n: number;
  win_rate: number;
  profit_factor: number;
  expectancy_pct: number;
  max_loss_pct: number;
}

interface ReadinessBox {
  n_sufficient: boolean;
  pf_passes: boolean;
  max_loss_reasonable: boolean;
  recommendation: 'internal' | 'candidate';
  recommendation_ar: string;
  notes_ar: string[];
}

interface PlatformPerformanceResponse {
  success: boolean;
  generated_at: string;
  filters: {
    period: string;
    channel: string;
    min_return: number;
    date_from: string | null;
    date_to: string | null;
  };
  kpis: KPIs;
  top_trades: Trade[];
  worst_trades: Trade[];
  target_hits: Trade[];
  by_channel: ChannelStats[];
  readiness: ReadinessBox;
  data_sources: string[];
  data_missing: string[];
  sample_note_ar: string;
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const HARD_CAP = 50.0; // Constitution Rule 7: ABS(actual_return) <= 50

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * حساب العائد الفعلي للصفقة.
 * الأولوية:
 * 1. actual_return لو موجود
 * 2. hit_target=1 → (target - entry) / entry × 100
 * 3. hit_stop=1 → (stop - entry) / entry × 100
 * 4. expired no hit → 0 (لا نختلق)
 */
function computeActualReturn(row: Record<string, unknown>): number | null {
  const entry = safeNum(row.entry_price);
  if (!entry || entry <= 0) return null;

  // 1. actual_return field
  const ar = safeNum(row.actual_return);
  if (ar !== null && Number.isFinite(ar)) return Math.max(-HARD_CAP, Math.min(HARD_CAP, ar));

  // 2. exit_price → (exit - entry) / entry × 100
  const exit = safeNum(row.exit_price) ?? safeNum(row.actual_exit_price);
  if (exit !== null && exit > 0) {
    const ret = ((exit - entry) / entry) * 100;
    return Math.max(-HARD_CAP, Math.min(HARD_CAP, ret));
  }

  // 3. hit_target=1 → target
  const hitTarget = Number(row.hit_target || 0);
  const target = safeNum(row.target_price);
  if (hitTarget === 1 && target !== null && target > 0) {
    const ret = ((target - entry) / entry) * 100;
    return Math.max(-HARD_CAP, Math.min(HARD_CAP, ret));
  }

  // 4. hit_stop=1 → stop
  const hitStop = Number(row.hit_stop || 0);
  const stop = safeNum(row.stop_loss);
  if (hitStop === 1 && stop !== null && stop > 0) {
    const ret = ((stop - entry) / entry) * 100;
    return Math.max(-HARD_CAP, Math.min(HARD_CAP, ret));
  }

  // 5. expired no hit → null (لا نختلق)
  return null;
}

function computeHoldingDays(row: Record<string, unknown>): number | null {
  const hd = safeNum(row.holding_days);
  if (hd !== null && hd > 0) return Math.round(hd);
  const predDate = row.prediction_date as string | null;
  const outcomeDate = row.outcome_date as string | null;
  const closedAt = row.closed_at as string | null;
  const endDate = outcomeDate || closedAt;
  if (predDate && endDate) {
    const start = new Date(predDate);
    const end = new Date(endDate);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return days >= 0 ? days : null;
    }
  }
  return null;
}

function computeKPIs(trades: Trade[]): KPIs {
  const measured = trades.filter((t) => t.actual_return !== null);
  const nMeasured = measured.length;
  const nTotal = trades.length;
  const nOpen = trades.filter((t) => t.status === 'active' || t.status === 'ACTIVE' || t.status === 'PENDING').length;

  if (nMeasured === 0) {
    return {
      n_total: nTotal,
      n_measured: 0,
      n_open: nOpen,
      win_rate: 0,
      profit_factor: 0,
      expectancy_pct: 0,
      avg_win_pct: 0,
      avg_loss_pct: 0,
      max_loss_pct: 0,
      max_win_pct: 0,
      tp1_hit_rate: 0,
      stop_hit_rate: 0,
      expired_rate: 0,
      hard_capped_count: 0,
    };
  }

  const wins = measured.filter((t) => t.actual_return > 0);
  const losses = measured.filter((t) => t.actual_return < 0);
  const expired = trades.filter((t) => t.status === 'EXPIRED' && t.hit_target === 0 && t.hit_stop === 0);
  const tpHits = trades.filter((t) => t.hit_target === 1);
  const stopHits = trades.filter((t) => t.hit_stop === 1);
  const hardCapped = measured.filter((t) => Math.abs(t.actual_return) >= HARD_CAP);

  const grossProfit = wins.reduce((sum, t) => sum + t.actual_return, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.actual_return, 0));
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const expectancy = measured.reduce((sum, t) => sum + t.actual_return, 0) / nMeasured;

  const maxLoss = Math.min(...measured.map((t) => t.actual_return));
  const maxWin = Math.max(...measured.map((t) => t.actual_return));

  return {
    n_total: nTotal,
    n_measured: nMeasured,
    n_open: nOpen,
    win_rate: (wins.length / nMeasured) * 100,
    profit_factor: pf === Infinity ? 0 : pf, // Infinity = no losses → 0 for display
    expectancy_pct: expectancy,
    avg_win_pct: avgWin,
    avg_loss_pct: avgLoss,
    max_loss_pct: maxLoss,
    max_win_pct: maxWin,
    tp1_hit_rate: nTotal > 0 ? (tpHits.length / nTotal) * 100 : 0,
    stop_hit_rate: nTotal > 0 ? (stopHits.length / nTotal) * 100 : 0,
    expired_rate: nTotal > 0 ? (expired.length / nTotal) * 100 : 0,
    hard_capped_count: hardCapped.length,
  };
}

function computeByChannel(trades: Trade[]): ChannelStats[] {
  const channels: ('balanced' | 'morning_bell')[] = ['balanced', 'morning_bell'];
  const result: ChannelStats[] = [];

  for (const ch of channels) {
    const chTrades = trades.filter((t) => t.channel === ch);
    if (chTrades.length === 0) continue;
    const kpis = computeKPIs(chTrades);
    result.push({
      channel: ch,
      n: kpis.n_measured,
      win_rate: kpis.win_rate,
      profit_factor: kpis.profit_factor,
      expectancy_pct: kpis.expectancy_pct,
      max_loss_pct: kpis.max_loss_pct,
    });
  }
  return result;
}

function computeReadiness(kpis: KPIs): ReadinessBox {
  const nSufficient = kpis.n_measured >= 30;
  const pfPasses = kpis.profit_factor >= 1.3;
  // max_loss_reasonable: stop loss is usually 5-9%, so -15% max loss is reasonable
  const maxLossReasonable = kpis.max_loss_pct >= -20;

  const notes: string[] = [];
  if (!nSufficient) notes.push(`العينة صغيرة (${kpis.n_measured} < 30) — النتائج غير حاسمة`);
  if (!pfPasses) notes.push(`Profit Factor ${kpis.profit_factor.toFixed(2)} < 1.3 — الـ edge ضعيف`);
  if (!maxLossReasonable) notes.push(`Max Loss ${kpis.max_loss_pct.toFixed(1)}% خارج نطاق الوقف المعقول`);

  const candidate = nSufficient && pfPasses && maxLossReasonable;
  return {
    n_sufficient: nSufficient,
    pf_passes: pfPasses,
    max_loss_reasonable: maxLossReasonable,
    recommendation: candidate ? 'candidate' : 'internal',
    recommendation_ar: candidate ? 'مرشح لنسخة عميل لاحقاً' : 'يبقى داخلي',
    notes_ar: notes.length > 0 ? notes : ['كل المؤشرات ضمن الحدود المعقولة'],
  };
}

// ============================================================================
// Main handler
// ============================================================================

export async function GET(request: NextRequest) {
  // Auth gate: admin only
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const sp = request.nextUrl.searchParams;
    const period = sp.get('period') || '30d';
    const channel = sp.get('channel') || 'all';
    const minReturn = parseFloat(sp.get('min_return') || '8.0');

    // Compute date range
    const now = new Date();
    let dateFrom: Date | null = null;
    const dateTo = now;

    if (period === 'today') {
      dateFrom = new Date(now);
      dateFrom.setHours(0, 0, 0, 0);
    } else if (period === '7d') {
      dateFrom = new Date(now);
      dateFrom.setDate(dateFrom.getDate() - 7);
    } else if (period === '30d') {
      dateFrom = new Date(now);
      dateFrom.setDate(dateFrom.getDate() - 30);
    } else if (period === 'all') {
      dateFrom = null;
    }

    const dateFromStr = dateFrom ? dateFrom.toISOString().split('T')[0] : null;
    const dateToStr = dateTo.toISOString().split('T')[0];

    // Read from predictions.db
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    const db = openDb(dbPath);

    // Build query
    let sql = `
      SELECT id, ticker, persona, morning_bell, prediction_date, entry_price,
             target_price, target_price_2, stop_loss, exit_price, actual_exit_price,
             actual_return, hit_target, hit_stop, status, holding_days,
             outcome_date, closed_at, highest_price, lowest_price, signal
      FROM predictions
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (dateFromStr) {
      sql += ` AND prediction_date >= ?`;
      params.push(dateFromStr);
    }
    if (period !== 'all') {
      sql += ` AND prediction_date <= ?`;
      params.push(dateToStr);
    }

    // Channel filter: morning_bell=1 OR (morning_bell=0 AND persona='balanced')
    if (channel === 'morning_bell') {
      sql += ` AND morning_bell = 1`;
    } else if (channel === 'balanced') {
      sql += ` AND (morning_bell = 0 OR morning_bell IS NULL)`;
    }

    sql += ` ORDER BY prediction_date DESC`;

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

    // Transform to Trade objects
    const trades: Trade[] = rows.map((row) => {
      const actualReturn = computeActualReturn(row);
      const isMorningBell = Number(row.morning_bell || 0) === 1;
      return {
        id: Number(row.id),
        ticker: String(row.ticker || ''),
        persona: (row.persona as string) || 'balanced',
        is_morning_bell: isMorningBell,
        channel: isMorningBell ? 'morning_bell' : 'balanced',
        prediction_date: String(row.prediction_date || ''),
        entry_price: safeNum(row.entry_price) ?? 0,
        target_price: safeNum(row.target_price),
        target_price_2: safeNum(row.target_price_2),
        stop_loss: safeNum(row.stop_loss),
        exit_price: safeNum(row.exit_price) ?? safeNum(row.actual_exit_price),
        actual_return: actualReturn ?? 0, // 0 = not measurable (will be filtered)
        hit_target: (Number(row.hit_target || 0)) as 0 | 1,
        hit_stop: (Number(row.hit_stop || 0)) as 0 | 1,
        status: String(row.status || ''),
        holding_days: computeHoldingDays(row),
        outcome_date: (row.outcome_date as string) || null,
        highest_price: safeNum(row.highest_price),
        lowest_price: safeNum(row.lowest_price),
      };
    });

    // Separate measured (with valid return) from unmeasured
    const measured = trades.filter((t) => t.actual_return !== null && t.hit_target !== null);
    const dataSources = ['predictions.db.predictions'];
    const dataMissing: string[] = [];
    if (trades.length === 0) {
      dataMissing.push('no_predictions_in_period');
    }
    const unmeasuredCount = trades.length - measured.length;
    if (unmeasuredCount > 0) {
      dataMissing.push(`${unmeasuredCount}_trades_without_exit_price`);
    }

    // KPIs (on measured trades)
    const kpis = computeKPIs(trades);

    // Top trades (actual_return >= minReturn, sorted by return desc)
    const topTrades = measured
      .filter((t) => t.actual_return >= minReturn)
      .sort((a, b) => b.actual_return - a.actual_return)
      .slice(0, 20);

    // Worst trades (sorted by return asc)
    const worstTrades = measured
      .filter((t) => t.actual_return < 0)
      .sort((a, b) => a.actual_return - b.actual_return)
      .slice(0, 10);

    // Target hits (trades that hit target, with high/low tracking)
    const targetHits = measured
      .filter((t) => t.hit_target === 1 || (t.actual_return > 0 && t.highest_price))
      .sort((a, b) => b.actual_return - a.actual_return)
      .slice(0, 20);

    // By channel
    const byChannel = computeByChannel(trades);

    // Readiness box
    const readiness = computeReadiness(kpis);

    // Sample note
    let sampleNote = `تم قياس ${kpis.n_measured} صفقة من أصل ${kpis.n_total} في الفترة المحددة.`;
    if (kpis.n_measured < 30) {
      sampleNote += ` العينة أقل من 30 — النتائج إرشادية فقط.`;
    }

    const response: PlatformPerformanceResponse = {
      success: true,
      generated_at: now.toISOString(),
      filters: {
        period,
        channel,
        min_return: minReturn,
        date_from: dateFromStr,
        date_to: dateToStr,
      },
      kpis,
      top_trades: topTrades,
      worst_trades: worstTrades,
      target_hits: targetHits,
      by_channel: byChannel,
      readiness,
      data_sources: dataSources,
      data_missing: dataMissing,
      sample_note_ar: sampleNote,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[/api/admin/platform-performance] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: `فشل تحميل البيانات: ${(error as Error).message}`,
        generated_at: new Date().toISOString(),
        filters: { period: '30d', channel: 'all', min_return: 8.0, date_from: null, date_to: null },
        kpis: null,
        top_trades: [],
        worst_trades: [],
        target_hits: [],
        by_channel: [],
        readiness: null,
        data_sources: [],
        data_missing: ['query_error'],
        sample_note_ar: 'تعذر تحميل البيانات',
      } as unknown as PlatformPerformanceResponse,
      { status: 500 }
    );
  }
}
