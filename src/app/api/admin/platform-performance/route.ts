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
  actual_return: number; // محسوب (موجب = ربح، سالب = خسارة)
  hit_target: 0 | 1;
  hit_stop: 0 | 1;
  status: string;
  lifecycle_status: string;
  holding_days: number | null;
  outcome_date: string | null;
  highest_price: number | null;
  lowest_price: number | null;
  channel: 'balanced' | 'morning_bell';
  market: 'EGX' | 'CRYPTO' | 'OTHER' | string;
  capped: boolean; // true لو العائد وصل للـ HARD cap (±50%)
  valid: boolean; // true لو الصفقة صالحة للقياس (دخلت KPI)
  exclusion_reason: string | null; // سبب الاستبعاد لو valid=false
}

interface KPIs {
  n_raw: number; // كل الصفوف قبل الفلتر
  n_valid: number; // صفقات صالحة للقياس (بعد فلتر الجودة)
  n_excluded: number; // صفقات مستبعدة
  n_open: number;
  win_rate: number;
  profit_factor: number;
  expectancy_pct: number;
  avg_win_pct: number; // موجب
  avg_loss_pct: number; // سالب (إشارة سالبة دائماً)
  max_loss_pct: number; // سالب
  max_win_pct: number; // موجب
  tp1_hit_rate: number;
  stop_hit_rate: number;
  expired_rate: number;
  hard_capped_count: number;
  exclusion_breakdown: Record<string, number>; // سبب → عدد
}

interface ChannelStats {
  channel: string;
  n: number;
  win_rate: number;
  profit_factor: number;
  expectancy_pct: number;
  max_loss_pct: number;
}

interface MarketStats {
  market: string;
  n_raw: number;
  n_valid: number;
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
    market: string;
    min_return: number;
    date_from: string | null;
    date_to: string | null;
  };
  kpis: KPIs;
  top_trades: Trade[];
  worst_trades: Trade[];
  target_hits: Trade[];
  by_channel: ChannelStats[];
  by_market: MarketStats[];
  excluded_examples: Trade[]; // أمثلة على صفقات مستبعدة (للشفافية)
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
const MAX_RETURN_RATIO = 5.0; // لو |exit/entry| > 5x → مشكوك فيها (قفزة 500%+)

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * حساب العائد الفعلي للصفقة (بدون HARD cap — يُطبق لاحقاً).
 * الأولوية:
 * 1. actual_return لو موجود ومحدود
 * 2. exit_price → (exit - entry) / entry × 100 (مع فحص منطقية)
 * 3. hit_target=1 → (target - entry) / entry × 100
 * 4. hit_stop=1 → (stop - entry) / entry × 100
 * 5. expired no hit → null (لا نختلق)
 *
 * يرجع { return, capped, suspicious } — return = العائد المحدود،
 * capped = true لو |return| > HARD_CAP، suspicious = true لو قفزة غير منطقية.
 */
function computeActualReturnRaw(
  row: Record<string, unknown>
): { ret: number | null; capped: boolean; suspicious: boolean } {
  const entry = safeNum(row.entry_price);
  if (!entry || entry <= 0) return { ret: null, capped: false, suspicious: false };

  let rawRet: number | null = null;
  let exitUsed: number | null = null;

  // 1. actual_return field (مع فحص منطقية)
  const ar = safeNum(row.actual_return);
  if (ar !== null && Number.isFinite(ar)) {
    rawRet = ar;
    exitUsed = entry * (1 + ar / 100); // تخمين exit
  }

  // 2. exit_price → (exit - entry) / entry × 100
  if (rawRet === null) {
    const exit = safeNum(row.exit_price) ?? safeNum(row.actual_exit_price);
    if (exit !== null && exit > 0) {
      rawRet = ((exit - entry) / entry) * 100;
      exitUsed = exit;
    }
  }

  // 3. hit_target=1 → target
  if (rawRet === null) {
    const hitTarget = Number(row.hit_target || 0);
    const target = safeNum(row.target_price);
    if (hitTarget === 1 && target !== null && target > 0) {
      rawRet = ((target - entry) / entry) * 100;
      exitUsed = target;
    }
  }

  // 4. hit_stop=1 → stop
  if (rawRet === null) {
    const hitStop = Number(row.hit_stop || 0);
    const stop = safeNum(row.stop_loss);
    if (hitStop === 1 && stop !== null && stop > 0) {
      rawRet = ((stop - entry) / entry) * 100;
      exitUsed = stop;
    }
  }

  // 5. expired no hit → null
  if (rawRet === null) return { ret: null, capped: false, suspicious: false };

  // فحص منطقية: لو |exit/entry| > 5x → مشكوك فيه (قفزة غير منطقية)
  const ratio = exitUsed ? Math.abs(exitUsed / entry) : 1;
  const suspicious = ratio > MAX_RETURN_RATIO;

  // تطبيق HARD cap
  const capped = Math.abs(rawRet) > HARD_CAP;
  const ret = Math.max(-HARD_CAP, Math.min(HARD_CAP, rawRet));

  return { ret, capped, suspicious };
}

/**
 * التحقق من صلاحية الصفقة للقياس (trade_valid).
 * يعيد سبب الاستبعاد لو غير صالحة، أو null لو صالحة.
 */
function validateTrade(
  row: Record<string, unknown>,
  seenKeys: Set<string>
): { valid: boolean; reason: string | null } {
  const ticker = String(row.ticker || '').trim().toUpperCase();
  const entry = safeNum(row.entry_price);

  // 1. entry_price > 0
  if (!entry || entry <= 0) {
    return { valid: false, reason: 'entry_price_zero' };
  }

  // 2. ticker نظيف (لا مسافات، ≤ 12 char)
  if (!ticker || ticker.includes(' ') || ticker.length > 12) {
    return { valid: false, reason: 'ticker_invalid' };
  }

  // 3. استبعاد التكرار على (ticker + prediction_date + channel + entry_price)
  const persona = String(row.persona || 'balanced');
  const morningBell = Number(row.morning_bell || 0);
  const channel = morningBell === 1 ? 'morning_bell' : 'balanced';
  const predictionDate = String(row.prediction_date || '');
  const dedupKey = `${ticker}|${predictionDate}|${channel}|${entry.toFixed(4)}`;
  if (seenKeys.has(dedupKey)) {
    return { valid: false, reason: 'duplicate' };
  }
  seenKeys.add(dedupKey);

  // 4. market معروف
  const market = String(row.market || '').toUpperCase();
  if (!market) {
    return { valid: false, reason: 'market_unknown' };
  }

  return { valid: true, reason: null };
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

function computeKPIs(allTrades: Trade[]): KPIs {
  const nRaw = allTrades.length;
  const validTrades = allTrades.filter((t) => t.valid);
  const measured = validTrades.filter((t) => t.actual_return !== null && t.actual_return !== 0);
  const nValid = measured.length;
  const excluded = allTrades.filter((t) => !t.valid);
  // LIFECYCLE-MIGRATION: open/active now detected via `lifecycle_status`
  // IN ('proven', 'testing') (Bravo's new column) instead of the legacy
  // `status` string values 'active'/'ACTIVE'/'PENDING'.
  const nOpen = allTrades.filter((t) => t.lifecycle_status === 'proven' || t.lifecycle_status === 'testing').length;

  // استبعاد breakdown
  const exclusionBreakdown: Record<string, number> = {};
  for (const t of excluded) {
    const r = t.exclusion_reason || 'unknown';
    exclusionBreakdown[r] = (exclusionBreakdown[r] || 0) + 1;
  }

  if (nValid === 0) {
    return {
      n_raw: nRaw,
      n_valid: 0,
      n_excluded: excluded.length,
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
      exclusion_breakdown: exclusionBreakdown,
    };
  }

  // wins = actual_return > 0, losses = actual_return < 0 (سالب)
  const wins = measured.filter((t) => t.actual_return > 0);
  const losses = measured.filter((t) => t.actual_return < 0);
  // LIFECYCLE-MIGRATION: `expired` now derived from `lifecycle_status =
  // 'closed'` (no hit_target / hit_stop). The legacy `status ===
  // 'EXPIRED'` string check is replaced.
  const expired = allTrades.filter((t) => t.lifecycle_status === 'closed' && t.hit_target === 0 && t.hit_stop === 0);
  const tpHits = validTrades.filter((t) => t.hit_target === 1);
  const stopHits = validTrades.filter((t) => t.hit_stop === 1);
  const hardCapped = measured.filter((t) => t.capped);

  const grossProfit = wins.reduce((sum, t) => sum + t.actual_return, 0);
  // grossLoss = مبلغ الخسائر (قيمة موجبة = المبلغ المخسر)
  const grossLossAmount = losses.reduce((sum, t) => sum + Math.abs(t.actual_return), 0);
  const pf = grossLossAmount > 0 ? grossProfit / grossLossAmount : grossProfit > 0 ? Infinity : 0;

  // avg_win = موجب، avg_loss = سالب (بإشارة سالبة دائماً)
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? -(grossLossAmount / losses.length) : 0; // سالب
  const expectancy = measured.reduce((sum, t) => sum + t.actual_return, 0) / nValid;

  // max_loss = أكثر قيمة سلبية (أقل رقم)
  const maxLoss = losses.length > 0 ? Math.min(...losses.map((t) => t.actual_return)) : 0;
  const maxWin = wins.length > 0 ? Math.max(...wins.map((t) => t.actual_return)) : 0;

  return {
    n_raw: nRaw,
    n_valid: nValid,
    n_excluded: excluded.length,
    n_open: nOpen,
    win_rate: (wins.length / nValid) * 100,
    profit_factor: pf === Infinity ? 0 : pf,
    expectancy_pct: expectancy,
    avg_win_pct: avgWin,
    avg_loss_pct: avgLoss, // سالب
    max_loss_pct: maxLoss, // سالب
    max_win_pct: maxWin,
    tp1_hit_rate: validTrades.length > 0 ? (tpHits.length / validTrades.length) * 100 : 0,
    stop_hit_rate: validTrades.length > 0 ? (stopHits.length / validTrades.length) * 100 : 0,
    expired_rate: nRaw > 0 ? (expired.length / nRaw) * 100 : 0,
    hard_capped_count: hardCapped.length,
    exclusion_breakdown: exclusionBreakdown,
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
      n: kpis.n_valid,
      win_rate: kpis.win_rate,
      profit_factor: kpis.profit_factor,
      expectancy_pct: kpis.expectancy_pct,
      max_loss_pct: kpis.max_loss_pct,
    });
  }
  return result;
}

function computeByMarket(trades: Trade[]): MarketStats[] {
  // جمع كل الأسواق الموجودة
  const markets = [...new Set(trades.map((t) => t.market).filter(Boolean))];
  const result: MarketStats[] = [];

  for (const mk of markets) {
    const mkTrades = trades.filter((t) => t.market === mk);
    if (mkTrades.length === 0) continue;
    const kpis = computeKPIs(mkTrades);
    result.push({
      market: mk,
      n_raw: kpis.n_raw,
      n_valid: kpis.n_valid,
      win_rate: kpis.win_rate,
      profit_factor: kpis.profit_factor,
      expectancy_pct: kpis.expectancy_pct,
      max_loss_pct: kpis.max_loss_pct,
    });
  }
  return result.sort((a, b) => b.n_valid - a.n_valid);
}

function computeReadiness(kpis: KPIs): ReadinessBox {
  const nSufficient = kpis.n_valid >= 30;
  const pfPasses = kpis.profit_factor >= 1.3;
  // max_loss_reasonable: stop loss is usually 5-9%, so -15% max loss is reasonable
  const maxLossReasonable = kpis.max_loss_pct >= -20;

  const notes: string[] = [];
  if (!nSufficient) notes.push(`العينة صغيرة (${kpis.n_valid} < 30) — النتائج غير حاسمة`);
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
    const market = sp.get('market') || 'all';
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
    // LIFECYCLE-MIGRATION: `lifecycle_status` is now SELECTed alongside
    // `status` so KPIs can segment by proven/testing/closed without
    // relying on the legacy `status` string (which keeps its 5 official
    // values for outcome display).
    let sql = `
      SELECT id, ticker, persona, morning_bell, prediction_date, entry_price,
             target_price, target_price_2, stop_loss, exit_price, actual_exit_price,
             actual_return, hit_target, hit_stop, status, lifecycle_status, holding_days,
             outcome_date, closed_at, highest_price, lowest_price, signal, market
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

    // Market filter (applied at SQL level for efficiency)
    if (market !== 'all') {
      sql += ` AND UPPER(market) = ?`;
      params.push(market.toUpperCase());
    }

    sql += ` ORDER BY prediction_date DESC`;

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

    // Transform to Trade objects + apply validation + dedup
    const seenKeys = new Set<string>();
    const trades: Trade[] = rows.map((row) => {
      const { ret: actualReturn, capped, suspicious } = computeActualReturnRaw(row);
      const isMorningBell = Number(row.morning_bell || 0) === 1;
      const validation = validateTrade(row, seenKeys);

      // لو suspicious (قفزة غير منطقية) → استبعد
      let valid = validation.valid;
      let exclusionReason = validation.reason;
      if (valid && suspicious) {
        valid = false;
        exclusionReason = 'exit_price_unrealistic';
      }
      // لو actual_return = null (لا outcome) → لا تدخل KPI لكن اعرضها
      if (valid && actualReturn === null) {
        // صفقة مفتوقة أو بدون outcome — تبقى في القائمة لكن لا تدخل measured
        // (valid = true لكن actual_return = null → تُستبعد من measured تلقائياً)
      }

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
        actual_return: actualReturn ?? 0, // 0 = not measurable
        hit_target: (Number(row.hit_target || 0)) as 0 | 1,
        hit_stop: (Number(row.hit_stop || 0)) as 0 | 1,
        status: String(row.status || ''),
        lifecycle_status: String(row.lifecycle_status || ''),
        holding_days: computeHoldingDays(row),
        outcome_date: (row.outcome_date as string) || null,
        highest_price: safeNum(row.highest_price),
        lowest_price: safeNum(row.lowest_price),
        market: String(row.market || 'UNKNOWN').toUpperCase(),
        capped,
        valid,
        exclusion_reason: exclusionReason,
      };
    });

    const dataSources = ['predictions.db.predictions'];
    const dataMissing: string[] = [];
    if (trades.length === 0) {
      dataMissing.push('no_predictions_in_period');
    }

    // KPIs (computed on valid + measured trades only)
    const kpis = computeKPIs(trades);

    // Valid measured trades (for top/worst tables)
    const validMeasured = trades.filter((t) => t.valid && t.actual_return !== null && t.actual_return !== 0);

    // Top trades (actual_return >= minReturn, valid, sorted by return desc)
    const topTrades = validMeasured
      .filter((t) => t.actual_return >= minReturn)
      .sort((a, b) => b.actual_return - a.actual_return)
      .slice(0, 20);

    // Worst trades (actual_return < 0, valid, sorted by return asc)
    const worstTrades = validMeasured
      .filter((t) => t.actual_return < 0)
      .sort((a, b) => a.actual_return - b.actual_return)
      .slice(0, 10);

    // Target hits (trades that hit target)
    const targetHits = validMeasured
      .filter((t) => t.hit_target === 1)
      .sort((a, b) => b.actual_return - a.actual_return)
      .slice(0, 20);

    // Excluded examples (for transparency)
    const excludedExamples = trades
      .filter((t) => !t.valid)
      .slice(0, 10);

    // By channel + by market (on valid trades only)
    const byChannel = computeByChannel(trades);
    const byMarket = computeByMarket(trades);

    // Readiness box
    const readiness = computeReadiness(kpis);

    // Sample note
    let sampleNote = `بيانات بعد فلتر الجودة: n=${kpis.n_valid} من أصل ${kpis.n_raw}`;
    if (kpis.n_excluded > 0) {
      const reasons = Object.entries(kpis.exclusion_breakdown)
        .map(([k, v]) => `${v} ${k}`)
        .join('، ');
      sampleNote += ` (مستبعد: ${kpis.n_excluded} — ${reasons})`;
    }
    if (kpis.n_valid < 30) {
      sampleNote += `. العينة أقل من 30 — النتائج إرشادية فقط.`;
    }

    const response: PlatformPerformanceResponse = {
      success: true,
      generated_at: now.toISOString(),
      filters: {
        period,
        channel,
        market,
        min_return: minReturn,
        date_from: dateFromStr,
        date_to: dateToStr,
      },
      kpis,
      top_trades: topTrades,
      worst_trades: worstTrades,
      target_hits: targetHits,
      by_channel: byChannel,
      by_market: byMarket,
      excluded_examples: excludedExamples,
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
        filters: { period: '30d', channel: 'all', market: 'all', min_return: 8.0, date_from: null, date_to: null },
        kpis: null,
        top_trades: [],
        worst_trades: [],
        target_hits: [],
        by_channel: [],
        by_market: [],
        excluded_examples: [],
        readiness: null,
        data_sources: [],
        data_missing: ['query_error'],
        sample_note_ar: 'تعذر تحميل البيانات',
      } as unknown as PlatformPerformanceResponse,
      { status: 500 }
    );
  }
}
