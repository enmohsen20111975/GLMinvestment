/**
 * GET /api/radar/accuracy?market=EGX&days=90
 * ===========================================
 * Historical accuracy of radar signals by type, market, and monthly trend.
 *
 * Data sources (tried in order):
 *   1. db/predictions.db  (production / runtime — created by Prisma on first write)
 *      → table `radar_signal_tracking` (created in P0; may not exist yet)
 *      → table `predictions`  (V40.2 outcomes)
 *   2. db/predictions.db.original  (sandbox snapshot — read-only fallback)
 *
 * Response shape:
 *   {
 *     success: true,
 *     total_signals: 245,
 *     verified: 207,
 *     pending: 38,
 *     win_rate_pct: 62.5,
 *     by_signal_type: [
 *       {
 *         signal_type: "pre_surge",
 *         label: "🚀 Pre-Surge",
 *         total: 45, verified: 38, wins: 26, win_rate_pct: 68.4,
 *         avg_outcome_7d: 4.1, avg_outcome_14d: 6.2, avg_outcome_30d: 10.3,
 *         avg_time_to_target_days: 12.5,
 *       },
 *       ...
 *     ],
 *     by_market: [
 *       { market: "EGX", total: 180, verified: 150, wins: 98, win_rate_pct: 65.0 },
 *       ...
 *     ],
 *     monthly_trend: [
 *       { month: "2026-07", win_rate_pct: 60.0, total: 30 },
 *       { month: "2026-08", win_rate_pct: 65.0, total: 45 },
 *     ],
 *     served_at: ISO timestamp,
 *     source: "predictions_db" | "predictions_db_original" | "none",
 *   }
 *
 * Notes:
 *   - Node = read-only (Rule 32). We never CREATE/INSERT in this endpoint.
 *   - When `radar_signal_tracking` doesn't exist yet, we fall back to the
 *     `predictions` table and classify rows into radar paths using a
 *     heuristic on `signal_type`, `notes`, and `explosive_label` columns.
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15; // should be <100ms typically

const PROJECT_ROOT = process.cwd();

// ─── Radar path definitions (mirror MultiMarketRadarTab + MakerRadarTab) ──
interface PathDef {
  signal_type: string;
  label: string;
  matchers: string[]; // substrings to match in signal_type / notes / explosive_label
}

const RADAR_PATHS: PathDef[] = [
  {
    signal_type: 'pre_surge',
    label: '🚀 Pre-Surge',
    matchers: ['pre_surge', 'pre-surge', 'presurge'],
  },
  {
    signal_type: 'quiet_accumulation_strong',
    label: '🎯 تجميع قوي',
    matchers: ['quiet_strong', 'quiet_accumulation_strong', 'b_quiet'],
  },
  {
    signal_type: 'explosive_surge',
    label: '💥 انفجار حجمي',
    matchers: ['explosive', 'd_explosive', 'explosive_surge'],
  },
  {
    signal_type: 'early_break',
    label: '⚡ اختراق مبكر',
    matchers: ['early_break', 'e_early', 'early-break', 'breakout'],
  },
  {
    signal_type: 'quiet_accumulation_weak',
    label: '🔍 تجميع ضعيف',
    matchers: ['quiet_weak', 'quiet_accumulation_weak', 'c_quiet'],
  },
];

const FALLBACK_PATH = { signal_type: 'general', label: '📋 عام', matchers: [] };

// ─── DB discovery ──────────────────────────────────────────────────────
interface DbHandle {
  db: Database.Database;
  source: string;
  hasRadarTrackingTable: boolean;
  hasPredictionsTable: boolean;
}

function openPredictionsDb(): DbHandle | null {
  const candidates = [
    { path: path.join(PROJECT_ROOT, 'db', 'predictions.db'), source: 'predictions_db' },
    { path: path.join(PROJECT_ROOT, 'db', 'predictions.db.original'), source: 'predictions_db_original' },
  ];

  for (const c of candidates) {
    if (!existsSync(c.path)) continue;
    try {
      const db = new Database(c.path, { readonly: true, fileMustExist: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      const names = new Set(tables.map(t => t.name));
      const hasRadarTrackingTable = names.has('radar_signal_tracking');
      const hasPredictionsTable = names.has('predictions');
      if (!hasRadarTrackingTable && !hasPredictionsTable) {
        db.close();
        continue;
      }
      return { db, source: c.source, hasRadarTrackingTable, hasPredictionsTable };
    } catch { // silent fallback (safe-by-design)
      continue;
    }
  }
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────
function classifyRadarPath(row: {
  signal_type?: string;
  notes?: string;
  explosive_label?: string;
}): string {
  const haystack = [
    row.signal_type ?? '',
    row.notes ?? '',
    row.explosive_label ?? '',
  ].join(' ').toLowerCase();

  for (const p of RADAR_PATHS) {
    if (p.matchers.some(m => haystack.includes(m))) {
      return p.signal_type;
    }
  }
  return FALLBACK_PATH.signal_type;
}

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeWinRate(wins: number, verified: number): number {
  if (verified === 0) return 0;
  return Math.round((wins / verified) * 1000) / 10; // 1 decimal place
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

function monthKey(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  // Accept YYYY-MM-DD or YYYY-MM-DD HH:MM:SS or ISO
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// ─── Main handler ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketFilter = (url.searchParams.get('market') || '').trim().toUpperCase() || null;
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 90, 7), 365);

  // PAYWALL Phase 2 — Gate 3 (P0-4, Radar Accuracy):
  //   Per PAYWALL-STRATEGY-FINAL.md §5.2 row 4 + §1 "تفاصيل دقة الرادار
  //   per-stock" — the full per-signal-type + per-market + monthly-trend
  //   breakdown is a Premium feature. Free users see ONLY the headline
  //   summary (total_signals + win_rate_pct).
  //   - Anonymous (no session) → full data (taste hook per §4 — accuracy
  //     dashboard being visible is the marketing teaser).
  //   - Authenticated + paid OR within 14-day trial → full data.
  //   - Authenticated + free + trial expired → summary only
  //     (by_signal_type / by_market / monthly_trend arrays are replaced
  //     with `{ locked: true }`).
  //   Per Rule 50 — accuracy stats are an insight, not safety.
  const { userId } = await getSessionUserId();
  let accuracyLocked = false;
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) accuracyLocked = true;
  }

  const handle = openPredictionsDb();
  if (!handle) {
    // No DB available — return empty stats so the UI can render gracefully
    return NextResponse.json(applyAccuracyGate({
      success: true,
      source: 'none',
      total_signals: 0,
      verified: 0,
      pending: 0,
      wins: 0,
      losses: 0,
      win_rate_pct: 0,
      by_signal_type: RADAR_PATHS.map(p => ({
        signal_type: p.signal_type,
        label: p.label,
        total: 0, verified: 0, wins: 0, losses: 0, win_rate_pct: 0,
        avg_outcome_7d: null, avg_outcome_14d: null, avg_outcome_30d: null,
        avg_time_to_target_days: null,
      })),
      by_market: [],
      monthly_trend: [],
      days,
      served_at: new Date().toISOString(),
      note: 'No predictions DB available — install db/predictions.db or run the prediction generator.',
    }, accuracyLocked));
  }

  try {
    const { db, source, hasRadarTrackingTable, hasPredictionsTable } = handle;

    // ─── Try radar_signal_tracking first ────────────────────────────
    if (hasRadarTrackingTable) {
      return NextResponse.json(applyAccuracyGate(
        buildFromRadarTrackingTable(db, source, marketFilter, days),
        accuracyLocked,
      ));
    }

    // ─── Fall back to predictions table ──────────────────────────────
    if (hasPredictionsTable) {
      return NextResponse.json(applyAccuracyGate(
        buildFromPredictionsTable(db, source, marketFilter, days),
        accuracyLocked,
      ));
    }

    return NextResponse.json({
      success: false,
      error: 'No usable table found in predictions DB',
      source,
    }, { status: 500 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[radar/accuracy] error:', msg);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  } finally {
    try { handle.db.close(); } catch { /* ignore - safe-by-design */ }
  }
}

// ─── Paywall gate: hide per-signal-type / per-market / monthly detail ─
// When `locked` is true, the caller is an authenticated free user whose
// 14-day trial has expired. Per PAYWALL-STRATEGY-FINAL.md §5.2 row 4 they
// see ONLY the headline summary (total_signals + verified + win_rate_pct).
// The detailed breakdown arrays are replaced with `{ locked: true }` so the
// UI can render a '🔒 اشترك لرؤية التفاصيل' lock card.
function applyAccuracyGate<T extends Record<string, unknown>>(
  payload: T,
  locked: boolean,
): T {
  if (!locked) return payload;
  return {
    ...payload,
    by_signal_type: { locked: true, upgradeUrl: '/pricing' },
    by_market: { locked: true, upgradeUrl: '/pricing' },
    monthly_trend: { locked: true, upgradeUrl: '/pricing' },
    details_locked: true,
  };
}

// ─── Builder: from predictions table (V40.2 outcomes) ──────────────────
function buildFromPredictionsTable(
  db: Database.Database,
  source: string,
  marketFilter: string | null,
  days: number,
) {
  // Pull all rows (filtered by market + date window if provided) — uses
  // positional ? placeholders (the idiomatic better-sqlite3 style).
  const where: string[] = [];
  const params: unknown[] = [];
  if (marketFilter) {
    where.push('market = ?');
    params.push(marketFilter);
  }
  // Date window — use prediction_date if present
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  where.push("(prediction_date IS NULL OR prediction_date >= ?)");
  params.push(cutoff.toISOString().slice(0, 10));

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT
      ticker, signal_type, prediction_date, market,
      entry_price, target_price, stop_loss,
      outcome_date, exit_price, actual_return,
      hit_target, hit_stop, holding_days,
      notes, explosive_label
    FROM predictions
    ${whereClause}
  `).all(...params) as Array<{
    ticker: string;
    signal_type?: string;
    prediction_date?: string;
    market?: string;
    entry_price?: number;
    target_price?: number;
    stop_loss?: number;
    outcome_date?: string;
    exit_price?: number;
    actual_return?: number;
    hit_target?: number;
    hit_stop?: number;
    holding_days?: number;
    notes?: string;
    explosive_label?: string;
  }>;

  // ─── Aggregate by signal_type (radar path) ────────────────────────
  const byType: Record<string, {
    total: number; verified: number; wins: number; losses: number;
    outcomes_7d: number[]; outcomes_14d: number[]; outcomes_30d: number[];
    time_to_target_days: number[];
  }> = {};

  // Initialize all known radar paths to 0
  for (const p of RADAR_PATHS) {
    byType[p.signal_type] = {
      total: 0, verified: 0, wins: 0, losses: 0,
      outcomes_7d: [], outcomes_14d: [], outcomes_30d: [],
      time_to_target_days: [],
    };
  }
  byType[FALLBACK_PATH.signal_type] = {
    total: 0, verified: 0, wins: 0, losses: 0,
    outcomes_7d: [], outcomes_14d: [], outcomes_30d: [],
    time_to_target_days: [],
  };

  // ─── Aggregate by market ─────────────────────────────────────────
  const byMarketMap: Record<string, { total: number; verified: number; wins: number }> = {};

  // ─── Aggregate by month ──────────────────────────────────────────
  const byMonth: Record<string, { total: number; verified: number; wins: number }> = {};

  let totalSignals = 0;
  let verified = 0;
  let pending = 0;
  let wins = 0;
  let losses = 0;

  for (const row of rows) {
    totalSignals += 1;
    const pathKey = classifyRadarPath(row);
    const bucket = byType[pathKey] ?? byType[FALLBACK_PATH.signal_type];
    bucket.total += 1;

    const market = (row.market || 'UNKNOWN').toUpperCase();
    if (!byMarketMap[market]) byMarketMap[market] = { total: 0, verified: 0, wins: 0 };
    byMarketMap[market].total += 1;

    const month = monthKey(row.prediction_date);
    if (month) {
      if (!byMonth[month]) byMonth[month] = { total: 0, verified: 0, wins: 0 };
      byMonth[month].total += 1;
    }

    const isVerified = !!row.outcome_date || safeNum(row.hit_target) === 1 || safeNum(row.hit_stop) === 1;
    if (!isVerified) {
      pending += 1;
      continue;
    }

    verified += 1;
    bucket.verified += 1;
    byMarketMap[market].verified += 1;
    if (month) byMonth[month].verified += 1;

    // Win = hit_target == 1 OR actual_return > 0 OR (exit_price > entry_price when both present)
    const actualReturn = safeNum(row.actual_return);
    const hitTarget = safeNum(row.hit_target) === 1;
    const entryPrice = safeNum(row.entry_price);
    const exitPrice = safeNum(row.exit_price);
    const priceGain = entryPrice != null && exitPrice != null
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : null;

    let isWin = false;
    if (hitTarget) isWin = true;
    else if (actualReturn != null) isWin = actualReturn > 0;
    else if (priceGain != null) isWin = priceGain > 0;

    if (isWin) {
      wins += 1;
      bucket.wins += 1;
      byMarketMap[market].wins += 1;
      if (month) byMonth[month].wins += 1;
    } else {
      losses += 1;
      bucket.losses += 1;
    }

    // Outcome returns (use actual_return if present, else priceGain)
    const ret = actualReturn ?? priceGain;
    if (ret != null) {
      bucket.outcomes_7d.push(ret);  // We don't have separate 7/14/30 in this table
      bucket.outcomes_14d.push(ret);
      bucket.outcomes_30d.push(ret);
    }

    // Time-to-target
    const holdingDays = safeNum(row.holding_days);
    if (holdingDays != null && holdingDays > 0 && isWin) {
      bucket.time_to_target_days.push(holdingDays);
    }
  }

  const winRatePct = computeWinRate(wins, verified);

  // Build by_signal_type array (radar paths first, fallback last)
  const bySignalType = [
    ...RADAR_PATHS.map(p => {
      const b = byType[p.signal_type];
      return {
        signal_type: p.signal_type,
        label: p.label,
        total: b.total,
        verified: b.verified,
        wins: b.wins,
        losses: b.losses,
        win_rate_pct: computeWinRate(b.wins, b.verified),
        avg_outcome_7d: avg(b.outcomes_7d),
        avg_outcome_14d: avg(b.outcomes_14d),
        avg_outcome_30d: avg(b.outcomes_30d),
        avg_time_to_target_days: avg(b.time_to_target_days),
      };
    }),
    // Include "general" only if non-empty
    ...(byType[FALLBACK_PATH.signal_type].total > 0 ? [{
      signal_type: FALLBACK_PATH.signal_type,
      label: FALLBACK_PATH.label,
      total: byType[FALLBACK_PATH.signal_type].total,
      verified: byType[FALLBACK_PATH.signal_type].verified,
      wins: byType[FALLBACK_PATH.signal_type].wins,
      losses: byType[FALLBACK_PATH.signal_type].losses,
      win_rate_pct: computeWinRate(
        byType[FALLBACK_PATH.signal_type].wins,
        byType[FALLBACK_PATH.signal_type].verified,
      ),
      avg_outcome_7d: avg(byType[FALLBACK_PATH.signal_type].outcomes_7d),
      avg_outcome_14d: avg(byType[FALLBACK_PATH.signal_type].outcomes_14d),
      avg_outcome_30d: avg(byType[FALLBACK_PATH.signal_type].outcomes_30d),
      avg_time_to_target_days: avg(byType[FALLBACK_PATH.signal_type].time_to_target_days),
    }] : []),
  ];

  const byMarket = Object.entries(byMarketMap)
    .map(([market, v]) => ({
      market,
      total: v.total,
      verified: v.verified,
      wins: v.wins,
      win_rate_pct: computeWinRate(v.wins, v.verified),
    }))
    .sort((a, b) => b.total - a.total);

  const monthlyTrend = Object.entries(byMonth)
    .map(([month, v]) => ({
      month,
      total: v.total,
      verified: v.verified,
      wins: v.wins,
      win_rate_pct: computeWinRate(v.wins, v.verified),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    success: true,
    source,
    market: marketFilter,
    days,
    total_signals: totalSignals,
    verified,
    pending,
    wins,
    losses,
    win_rate_pct: winRatePct,
    by_signal_type: bySignalType,
    by_market: byMarket,
    monthly_trend: monthlyTrend,
    served_at: new Date().toISOString(),
  };
}

// ─── Builder: from radar_signal_tracking table (if P0 created it) ────
interface RadarTrackingRow {
  id?: number;
  ticker: string;
  market?: string;
  signal_type?: string;
  signal_date?: string;
  entry_price?: number;
  target_price?: number;
  outcome_date?: string;
  exit_price?: number;
  actual_return?: number;
  hit_target?: number;
  holding_days?: number;
  notes?: string;
  created_at?: string;
}

function buildFromRadarTrackingTable(
  db: Database.Database,
  source: string,
  marketFilter: string | null,
  days: number,
) {
  // First, inspect the table schema to know which columns exist
  const cols = db.prepare("PRAGMA table_info(radar_signal_tracking)").all() as Array<{
    name: string;
  }>;
  const colNames = new Set(cols.map(c => c.name));

  const selectCols = [
    'ticker',
    'market',
    'signal_type',
    'signal_date',
    'entry_price',
    'target_price',
    'outcome_date',
    'exit_price',
    'actual_return',
    'hit_target',
    'holding_days',
    'notes',
  ].filter(c => colNames.has(c));

  const where: string[] = [];
  const params: unknown[] = [];
  if (marketFilter && colNames.has('market')) {
    where.push('market = ?');
    params.push(marketFilter);
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const dateCol = colNames.has('signal_date') ? 'signal_date'
    : colNames.has('created_at') ? 'created_at'
    : null;
  if (dateCol) {
    where.push(`(${dateCol} IS NULL OR ${dateCol} >= ?)`);
    params.push(cutoff.toISOString().slice(0, 10));
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const selectSql = `SELECT ${selectCols.join(', ')} FROM radar_signal_tracking ${whereClause}`;
  const rows = db.prepare(selectSql).all(...params) as RadarTrackingRow[];

  // Same aggregation logic as predictions table
  const byType: Record<string, {
    total: number; verified: number; wins: number; losses: number;
    outcomes_7d: number[]; outcomes_14d: number[]; outcomes_30d: number[];
    time_to_target_days: number[];
  }> = {};

  for (const p of RADAR_PATHS) {
    byType[p.signal_type] = {
      total: 0, verified: 0, wins: 0, losses: 0,
      outcomes_7d: [], outcomes_14d: [], outcomes_30d: [],
      time_to_target_days: [],
    };
  }
  byType[FALLBACK_PATH.signal_type] = {
    total: 0, verified: 0, wins: 0, losses: 0,
    outcomes_7d: [], outcomes_14d: [], outcomes_30d: [],
    time_to_target_days: [],
  };

  const byMarketMap: Record<string, { total: number; verified: number; wins: number }> = {};
  const byMonth: Record<string, { total: number; verified: number; wins: number }> = {};

  let totalSignals = 0, verified = 0, pending = 0, wins = 0, losses = 0;

  for (const row of rows) {
    totalSignals += 1;
    const pathKey = classifyRadarPath({
      signal_type: row.signal_type,
      notes: row.notes,
    });
    const bucket = byType[pathKey] ?? byType[FALLBACK_PATH.signal_type];
    bucket.total += 1;

    const market = (row.market || 'UNKNOWN').toUpperCase();
    if (!byMarketMap[market]) byMarketMap[market] = { total: 0, verified: 0, wins: 0 };
    byMarketMap[market].total += 1;

    const month = monthKey(row.signal_date ?? row.created_at);
    if (month) {
      if (!byMonth[month]) byMonth[month] = { total: 0, verified: 0, wins: 0 };
      byMonth[month].total += 1;
    }

    const isVerified = !!row.outcome_date || safeNum(row.hit_target) === 1;
    if (!isVerified) {
      pending += 1;
      continue;
    }

    verified += 1;
    bucket.verified += 1;
    byMarketMap[market].verified += 1;
    if (month) byMonth[month].verified += 1;

    const actualReturn = safeNum(row.actual_return);
    const hitTarget = safeNum(row.hit_target) === 1;
    const entryPrice = safeNum(row.entry_price);
    const exitPrice = safeNum(row.exit_price);
    const priceGain = entryPrice != null && exitPrice != null
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : null;

    let isWin = false;
    if (hitTarget) isWin = true;
    else if (actualReturn != null) isWin = actualReturn > 0;
    else if (priceGain != null) isWin = priceGain > 0;

    if (isWin) {
      wins += 1;
      bucket.wins += 1;
      byMarketMap[market].wins += 1;
      if (month) byMonth[month].wins += 1;
    } else {
      losses += 1;
      bucket.losses += 1;
    }

    const ret = actualReturn ?? priceGain;
    if (ret != null) {
      bucket.outcomes_7d.push(ret);
      bucket.outcomes_14d.push(ret);
      bucket.outcomes_30d.push(ret);
    }

    const holdingDays = safeNum(row.holding_days);
    if (holdingDays != null && holdingDays > 0 && isWin) {
      bucket.time_to_target_days.push(holdingDays);
    }
  }

  const winRatePct = computeWinRate(wins, verified);

  const bySignalType = [
    ...RADAR_PATHS.map(p => {
      const b = byType[p.signal_type];
      return {
        signal_type: p.signal_type,
        label: p.label,
        total: b.total,
        verified: b.verified,
        wins: b.wins,
        losses: b.losses,
        win_rate_pct: computeWinRate(b.wins, b.verified),
        avg_outcome_7d: avg(b.outcomes_7d),
        avg_outcome_14d: avg(b.outcomes_14d),
        avg_outcome_30d: avg(b.outcomes_30d),
        avg_time_to_target_days: avg(b.time_to_target_days),
      };
    }),
    ...(byType[FALLBACK_PATH.signal_type].total > 0 ? [{
      signal_type: FALLBACK_PATH.signal_type,
      label: FALLBACK_PATH.label,
      total: byType[FALLBACK_PATH.signal_type].total,
      verified: byType[FALLBACK_PATH.signal_type].verified,
      wins: byType[FALLBACK_PATH.signal_type].wins,
      losses: byType[FALLBACK_PATH.signal_type].losses,
      win_rate_pct: computeWinRate(
        byType[FALLBACK_PATH.signal_type].wins,
        byType[FALLBACK_PATH.signal_type].verified,
      ),
      avg_outcome_7d: avg(byType[FALLBACK_PATH.signal_type].outcomes_7d),
      avg_outcome_14d: avg(byType[FALLBACK_PATH.signal_type].outcomes_14d),
      avg_outcome_30d: avg(byType[FALLBACK_PATH.signal_type].outcomes_30d),
      avg_time_to_target_days: avg(byType[FALLBACK_PATH.signal_type].time_to_target_days),
    }] : []),
  ];

  const byMarket = Object.entries(byMarketMap)
    .map(([market, v]) => ({
      market,
      total: v.total,
      verified: v.verified,
      wins: v.wins,
      win_rate_pct: computeWinRate(v.wins, v.verified),
    }))
    .sort((a, b) => b.total - a.total);

  const monthlyTrend = Object.entries(byMonth)
    .map(([month, v]) => ({
      month,
      total: v.total,
      verified: v.verified,
      wins: v.wins,
      win_rate_pct: computeWinRate(v.wins, v.verified),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    success: true,
    source,
    market: marketFilter,
    days,
    total_signals: totalSignals,
    verified,
    pending,
    wins,
    losses,
    win_rate_pct: winRatePct,
    by_signal_type: bySignalType,
    by_market: byMarket,
    monthly_trend: monthlyTrend,
    served_at: new Date().toISOString(),
  };
}
