/**
 * radar-alerts.ts — Smart Radar Alerts (رادار التنبيهات الذكية)
 * ====================================================================
 *
 * بيقرأ آخر رادار متاح + آخر snapshot محفوظ، ويطلق تنبيهات على:
 *   1. NEW EXPLOSIVE       — سهم دخل قائمة الانفجار الحجمي (radar_explosive)
 *   2. NEW OPPORTUNITY     — سهم ظهر في تجميع قوي هادي/pre-surge (radar_opportunity)
 *   3. DISTRIBUTION FLIP    — تحول سهم متابع من "تجميع" لـ "تصريف" (radar_distribution)
 *   4. FLARE > 30%         — اشتعال حجمي > 1.30× (للأسهم المتابَعة فقط) (radar_flare)
 *   5. PATH UPGRADE        — ترقية مسار سهم متابَع (radar_path_upgrade) — RADAR-QUICK-WINS P3
 *
 * L2-ALERTS-EXIT-RADAR (NEW — Multi-Stage Smart Alerts):
 *   6. SIGNAL UPGRADE      — قوة الإشارة ارتفعت من X/6 إلى Y/6 (radar_signal_upgrade) — Stage 2
 *   7. VOLUME SURGE        — حجم اليوم ≥ 2.0× المعدل (Pre-Surge) (radar_volume_surge) — Stage 3
 *   8. TARGET HIT         — وصل الهدف الأول +N% (radar_target_hit) — Stage 4
 *   9. TAKE PROFIT        — اقترب من الهدف الثاني (5% فوق الهدف الأول) (radar_take_profit) — Stage 5
 *  10. EXIT SIGNAL        — سهم متابَع دخل رادار الخروج (radar_exit_signal) — Exit Radar
 *
 * Stage progression (per tracked stock):
 *   Stage 1 → radar_opportunity (دخل قائمة المراقبة)
 *   Stage 2 → radar_signal_upgrade (قوة الإشارة زادت)
 *   Stage 3 → radar_volume_surge (Pre-Surge حجمي)
 *   Stage 4 → radar_target_hit (الهدف الأول)
 *   Stage 5 → radar_take_profit (اقترب من الهدف الثاني)
 *
 * Snapshot file: db/radar_alerts_state.json
 *   {
 *     "last_snapshot_at": "...",
 *     "explosive_tickers": ["COMI", "HRHO"],
 *     "quiet_tickers": ["EFIN", "SWDY"],
 *     "tracked_transitions": { "COMI": { "prev_accumulation": "تجميع خفيف", "since": "..." } },
 *     "tracked_paths": { "COMI": "B_quiet_accumulation_strong" },
 *     "stock_stages": {
 *       "COMI": {
 *         "ticker": "COMI",
 *         "currentStage": 3,
 *         "stageReachedAt": { "1": "...", "2": "...", "3": "..." },
 *         "previousSignalCount": 4,
 *         "previousVolumeRatio": 1.2,
 *         "targetHitStage1": false,
 *         "targetHitStage2": false
 *       }
 *     }
 *   }
 *
 * قواعد:
 *   - كل التنبيهات user_id = 'system' (radar-wide alerts, لا تخص مستخدم)
 *   - try/catch كامل — مايمكنش يقع أبداً
 *   - لو readRadarCache() رجع null → نرجع 0 بصمت
 *   - insertNotification بتعتبر dedup 24h (موجود في alert-engine.ts)
 *   - Stages لا تطلق out-of-order — لازم 1 قبل 2 قبل 3 ...
 *   - لو سهم غادر الرادار → نعيد الـ stage لـ 1 (لتتبع جديد)
 */

import { readRadarCache, readExitRadarCache } from '@/lib/radar-cache';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import {
  insertNotification,
  ensureUserNotifColumns,
} from '@/lib/schedulers/alert-engine';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const SNAPSHOT_FILE = path.join(PROJECT_ROOT, 'db', 'radar_alerts_state.json');
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');

const SYSTEM_USER_ID = 'system';

// ---------------------------------------------------------------------------
// RADAR-QUICK-WINS (Priority 3): Path upgrade detection
// ---------------------------------------------------------------------------
// The 5 radar paths ordered by confidence / opportunity strength. A higher
// index = a stronger setup. `isPathUpgrade` compares ranks to decide whether
// a transition is worth firing a `radar_path_upgrade` notification.
//
//   C_quiet_accumulation_weak        (rank 1) — early, weak signals
//   B_quiet_accumulation_strong      (rank 2) — confirmed quiet accumulation
//   E_early_break                    (rank 3) — early breakout forming
//   A_pre_surge                      (rank 4) — pre-surge, highest priority
//   D_explosive_surge                 (rank 5) — explosive confirmation
//
// Note: D_explosive_surge is treated as the "strongest" because it's the
// confirmation signal the radar is built to catch — but the upgrade message
// still calls it "انفجار حجمي" so the user knows to act with caution.
const PATH_RANK: Record<string, number> = {
  C_quiet_accumulation_weak: 1,
  B_quiet_accumulation_strong: 2,
  E_early_break: 3,
  A_pre_surge: 4,
  D_explosive_surge: 5,
};

const PATH_SHORT_AR: Record<string, string> = {
  A_pre_surge: 'Pre-Surge',
  B_quiet_accumulation_strong: 'تجميع قوي',
  C_quiet_accumulation_weak: 'تجميع ضعيف',
  D_explosive_surge: 'انفجار حجمي',
  E_early_break: 'اختراق مبكر',
};

/**
 * Returns the kind of upgrade (e.g. "weak→strong", "quiet→pre-surge") if
 * the transition `prev → current` is an upgrade, or `null` if it is a
 * downgrade or unchanged. Unknown paths are treated as rank 0 so any
 * transition into a known path is considered an upgrade.
 */
export function isPathUpgrade(prev: string, current: string): string | null {
  if (!prev || !current || prev === current) return null;
  const prevRank = PATH_RANK[prev] ?? 0;
  const curRank = PATH_RANK[current] ?? 0;
  if (curRank <= prevRank) return null;
  return `${PATH_SHORT_AR[prev] || prev} → ${PATH_SHORT_AR[current] || current}`;
}

/**
 * Short Arabic label for a radar path. Falls back to the raw string when
 * the path is unknown (defensive — keeps the notification readable).
 */
export function pathShortAr(p: string): string {
  return PATH_SHORT_AR[p] || p;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RadarItem {
  ticker?: string;
  current_price?: number;
  path?: string;
  accumulation?: string;
  volume_ratio_10d_vs_20d?: number;
  avg_turnover_20d?: number;
  reason?: string;
}

interface TrackedStock {
  ticker: string;
  entryDate?: string;
  entryPrice?: number;
  addedAt?: string;
  notes?: string;
  // L2-ALERTS-EXIT-RADAR: optional per-stock profit targets. When unset,
  // runRadarAlertsCheck falls back to DEFAULT_TARGET_1_PCT/DEFAULT_TARGET_2_PCT
  // (10% / 20%) — these mirror the maker radar's position-sizing ladder.
  target_1_pct?: number;
  target_2_pct?: number;
}

// ---------------------------------------------------------------------------
// L2-ALERTS-EXIT-RADAR: Multi-Stage Smart Alerts
// ---------------------------------------------------------------------------
// Each tracked stock progresses through 5 sequential stages. We persist the
// stage on disk so the alerts fire in chronological story order — once a
// stage fires for a given ticker, we never re-fire an earlier stage for it
// until the stock leaves the radar (which resets the stage back to 1).
//
//   Stage 1  → radar_opportunity   (دخل قائمة المراقبة — already exists)
//   Stage 2  → radar_signal_upgrade (signal_count rose X→Y where Y >= 4)
//   Stage 3  → radar_volume_surge  (volume_ratio_10d_vs_20d >= 2.0 OR path=A_pre_surge)
//   Stage 4  → radar_target_hit    (current_price >= entry_price * (1 + target_1_pct/100))
//   Stage 5  → radar_take_profit   (current_price >= target_1_price * 1.05)
//
// The default target_1_pct = 10% and target_2_pct = 20% (configurable per
// tracked stock via the optional `target_1_pct` / `target_2_pct` fields on
// TrackedStock — to be wired by future iterations of the tracking UI).
export type StageNumber = 1 | 2 | 3 | 4 | 5;

export interface StockStage {
  ticker: string;
  currentStage: StageNumber;
  stageReachedAt: Record<number, string>; // stage → ISO timestamp
  previousSignalCount: number;
  previousVolumeRatio: number;
  targetHitStage1: boolean;
  targetHitStage2: boolean;
}

interface RadarSnapshot {
  last_snapshot_at: string;
  explosive_tickers: string[];
  quiet_tickers: string[];
  tracked_transitions: Record<
    string,
    { prev_accumulation: string; since: string }
  >;
  // RADAR-QUICK-WINS (Priority 3): per-ticker previous radar path so we can
  // detect path upgrades (e.g. C_quiet_accumulation_weak → A_pre_surge).
  // Only tracked tickers are persisted here to keep the snapshot small.
  tracked_paths?: Record<string, string>;
  // L2-ALERTS-EXIT-RADAR: per-stock stage progression for the multi-stage
  // story alerts. Optional for backward-compat with older snapshots.
  stock_stages?: Record<string, StockStage>;
}

interface EmptySnapshot {
  last_snapshot_at: string;
  explosive_tickers: never[];
  quiet_tickers: never[];
  tracked_transitions: Record<string, never>;
  tracked_paths: Record<string, never>;
  stock_stages: Record<string, never>;
}

// Default target percentages used when the tracked stock has no explicit
// target_1_pct / target_2_pct set. These mirror the maker radar's position
// sizing ladder (10% for the first profit target, 20% for the full exit).
const DEFAULT_TARGET_1_PCT = 10;
const DEFAULT_TARGET_2_PCT = 20;

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function loadSnapshot(): RadarSnapshot | EmptySnapshot {
  const empty: EmptySnapshot = {
    last_snapshot_at: '',
    explosive_tickers: [],
    quiet_tickers: [],
    tracked_transitions: {},
    tracked_paths: {},
    stock_stages: {},
  };
  try {
    if (!existsSync(SNAPSHOT_FILE)) return empty;
    const raw = readFileSync(SNAPSHOT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      last_snapshot_at: parsed.last_snapshot_at || '',
      explosive_tickers: Array.isArray(parsed.explosive_tickers)
        ? parsed.explosive_tickers
        : [],
      quiet_tickers: Array.isArray(parsed.quiet_tickers)
        ? parsed.quiet_tickers
        : [],
      tracked_transitions:
        parsed.tracked_transitions && typeof parsed.tracked_transitions === 'object'
          ? parsed.tracked_transitions
          : {},
      // RADAR-QUICK-WINS (Priority 3): optional for backward-compat with
      // older snapshots that pre-date this field.
      tracked_paths:
        parsed.tracked_paths && typeof parsed.tracked_paths === 'object'
          ? parsed.tracked_paths
          : {},
      // L2-ALERTS-EXIT-RADAR: optional for backward-compat.
      stock_stages:
        parsed.stock_stages && typeof parsed.stock_stages === 'object'
          ? parsed.stock_stages
          : {},
    };
  } catch {
    return empty;
  }
}

function saveSnapshot(snapshot: RadarSnapshot): void {
  try {
    const dir = path.dirname(SNAPSHOT_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error('[radar-alerts] saveSnapshot failed:', err);
  }
}

function loadTracking(): Record<string, TrackedStock> {
  try {
    if (!existsSync(TRACKING_FILE)) return {};
    const raw = readFileSync(TRACKING_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Core: runRadarAlertsCheck
// ---------------------------------------------------------------------------

// L2-ALERTS-EXIT-RADAR: helper to lazily create a fresh StockStage (Stage 0 —
// not yet reached Stage 1). Once a stock enters the watchlist, we promote it
// to Stage 1. The helper is exported for unit tests.
export function makeInitialStockStage(ticker: string): StockStage {
  return {
    ticker,
    currentStage: 1,
    stageReachedAt: { 1: new Date().toISOString() },
    previousSignalCount: 0,
    previousVolumeRatio: 0,
    targetHitStage1: false,
    targetHitStage2: false,
  };
}

/**
 * L2-ALERTS-EXIT-RADAR: promote a StockStage to a higher stage. Records the
 * timestamp at which the new stage was reached and returns the updated
 * object. The function is pure (no side-effects) so it is trivially
 * unit-testable. The caller is responsible for persisting the result.
 *
 * Pre-condition: `targetStage > stage.currentStage`. The caller MUST verify
 * this before invoking — promoting backwards is a no-op (returns unchanged).
 */
export function promoteStage(stage: StockStage, targetStage: StageNumber): StockStage {
  if (targetStage <= stage.currentStage) return stage;
  return {
    ...stage,
    currentStage: targetStage,
    stageReachedAt: {
      ...stage.stageReachedAt,
      [targetStage]: new Date().toISOString(),
    },
  };
}

/**
 * L2-ALERTS-EXIT-RADAR: determine the current signal_count for a radar item.
 * Reads from `quiet_details.signal_count` if present (the canonical source
 * from maker_radar.py). Falls back to 0 when the item is not on the quiet
 * path (pre-surge, explosive, early_break items don't carry signal_count).
 */
function getSignalCount(item: RadarItem | undefined): number {
  if (!item) return 0;
  // The radar JSON stores quiet_details as a nested object — but our
  // RadarItem type only declares the top-level fields. We use a defensive
  // cast to read signal_count safely.
  const qd = (item as RadarItem & { quiet_details?: { signal_count?: number } }).quiet_details;
  if (qd && typeof qd.signal_count === 'number') {
    return Math.max(0, Math.floor(qd.signal_count));
  }
  return 0;
}

/**
 * L2-ALERTS-EXIT-RADAR: extract the list of tickers (uppercased) that the
 * exit radar has flagged for distribution/exit signals. Each ticker is
 * associated with at least one exit path (X1..X5) and a suggested action.
 */
interface ExitRadarEntry {
  ticker: string;
  path: string;          // X1_distribution_strong, X2_volume_divergence, etc.
  path_ar: string;       // Arabic label
  reason: string;        // Why the exit path triggered (human-readable)
  suggested_action: string; // ما ينبغي عمله (خرج جزئي/كلي)
  current_price?: number;
}

const EXIT_PATH_AR: Record<string, string> = {
  X1_distribution_strong: 'توزيع قوي',
  X2_volume_divergence: 'تباعد حجمي',
  X3_resistance_rejection: 'رفض مقاومة',
  X4_exhaustion_gap: 'فجوة إرهاق',
  X5_kill_switch_triggered: 'Kill Switch',
};

const EXIT_PATH_ACTION: Record<string, string> = {
  X1_distribution_strong: 'بيع كامل أو تقليص قوي للمركز',
  X2_volume_divergence: 'تقليص نصف المركز + وقف مضغوط',
  X3_resistance_rejection: 'وقف عند آخر قاع + مراقبة الاختراق',
  X4_exhaustion_gap: 'بيع كامل — الاندفاع استُنفد',
  X5_kill_switch_triggered: 'خروج فوري — لا تنتظر',
};

export function pathExitAr(p: string): string {
  return EXIT_PATH_AR[p] || p;
}

export function exitSuggestedAction(p: string): string {
  return EXIT_PATH_ACTION[p] || 'راجع الموقف فوراً';
}

/**
 * L2-ALERTS-EXIT-RADAR: parse the exit radar cache into a flat ticker →
 * ExitRadarEntry map. Each ticker appears once with its highest-priority
 * exit path (X5 > X1 > X4 > X3 > X2). Returns an empty map if the exit
 * radar cache is unavailable (no exit_radar_*.json file exists yet).
 */
function loadExitRadarEntries(): Map<string, ExitRadarEntry> {
  const out = new Map<string, ExitRadarEntry>();
  try {
    const cache = readExitRadarCache();
    if (!cache || !cache.data) return out;
    const data = cache.data;
    // Exit radar JSON shape (from scripts/exit_radar.py):
    //   { exit_list: [{ticker, path, current_price, reason, ...}], ... }
    const allEntries: any[] = Array.isArray(data.exit_list)
      ? data.exit_list
      : [];
    // Priority: X5 (kill switch) > X1 (distribution) > X4 (exhaustion)
    //         > X3 (resistance) > X2 (divergence)
    const priority: Record<string, number> = {
      X5_kill_switch_triggered: 5,
      X1_distribution_strong: 4,
      X4_exhaustion_gap: 3,
      X3_resistance_rejection: 2,
      X2_volume_divergence: 1,
    };
    for (const raw of allEntries) {
      const ticker = typeof raw?.ticker === 'string' ? raw.ticker.toUpperCase() : '';
      const pathStr = typeof raw?.path === 'string' ? raw.path : '';
      if (!ticker || !pathStr) continue;
      const existing = out.get(ticker);
      if (existing && (priority[existing.path] || 0) >= (priority[pathStr] || 0)) {
        continue; // existing entry is higher priority → keep it
      }
      out.set(ticker, {
        ticker,
        path: pathStr,
        path_ar: EXIT_PATH_AR[pathStr] || pathStr,
        reason: typeof raw?.reason === 'string' ? raw.reason : '',
        suggested_action: EXIT_PATH_ACTION[pathStr] || 'راجع الموقف فوراً',
        current_price: typeof raw?.current_price === 'number' ? raw.current_price : undefined,
      });
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * يفحص رادار السيولة ويطلق تنبيهات على التحولات المثيرة.
 * يعيد عدد التنبيهات الجديدة. لو الرادار مش جاهز → 0 بصمت.
 *
 * @param userId الـ user_id اللي هيتسجل في user_notifications.
 *               افتراضياً 'system' (تنبيهات عامة لكل المستخدمين عبر NotificationCenter).
 *               لو محدد، هيُستخدم بدلاً من 'system'.
 */
export async function runRadarAlertsCheck(userId?: string): Promise<number> {
  try {
    // 1. الرادار جاهز؟
    const cache = readRadarCache();
    if (!cache || !cache.data) return 0;

    const data = cache.data;
    const explosiveList: RadarItem[] = Array.isArray(data.explosive_list)
      ? data.explosive_list
      : [];
    const quietList: RadarItem[] = Array.isArray(data.quiet_list)
      ? data.quiet_list
      : [];
    const preSurgeList: RadarItem[] = Array.isArray(data.pre_surge_list)
      ? data.pre_surge_list
      : [];
    const earlyBreakList: RadarItem[] = Array.isArray(data.early_break_list)
      ? data.early_break_list
      : [];

    // 2. snapshot سابق
    const prev = loadSnapshot();

    // 3. حساب الحالة الحالية
    const currentExplosiveTickers = new Set<string>(
      explosiveList
        .map((r) => r?.ticker)
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .map((t) => t.toUpperCase()),
    );
    const currentQuietTickers = new Set<string>(
      [...quietList, ...preSurgeList]
        .map((r) => r?.ticker)
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .map((t) => t.toUpperCase()),
    );

    // كل أسهم الرادار في map واحد عشان نوصل للـ accumulation/volume_ratio بسرعة
    const allRadarItems = new Map<string, RadarItem>();
    for (const r of [...quietList, ...preSurgeList, ...explosiveList, ...earlyBreakList]) {
      const t = r?.ticker;
      if (typeof t === 'string' && t.length > 0) {
        allRadarItems.set(t.toUpperCase(), r);
      }
    }

    // 4. الأسهم المتابَعة + حالتها الحالية
    const tracking = loadTracking();
    const trackedTickers = new Set<string>(
      Object.keys(tracking).map((t) => t.toUpperCase()),
    );

    const prevExplosive = new Set<string>(
      (prev.explosive_tickers || []).map((t) => t.toUpperCase()),
    );
    const prevQuiet = new Set<string>(
      (prev.quiet_tickers || []).map((t) => t.toUpperCase()),
    );

    const targetUserId = userId || SYSTEM_USER_ID;

    // نفتح DB ونتأكد من وجود user_notifications
    const db = await getFinanceDb();
    ensureUserNotifColumns(db);

    let fired = 0;

    // (1) NEW EXPLOSIVE — سهم دخل قائمة الانفجار الحجمي
    for (const ticker of currentExplosiveTickers) {
      if (prevExplosive.has(ticker)) continue; // موجود قبل كده
      const ok = insertNotification(db, {
        user_id: targetUserId,
        type: 'radar_explosive',
        title: '💥 انفجار حجمي جديد',
        message: `${ticker} دخل قائمة الانفجار الحجمي — راجع الرادار`,
        severity: 'warning',
        ticker,
        payload: JSON.stringify({
          ticker,
          source: 'explosive_list',
          current_price: allRadarItems.get(ticker)?.current_price ?? null,
          volume_ratio_10d_vs_20d:
            allRadarItems.get(ticker)?.volume_ratio_10d_vs_20d ?? null,
        }),
      });
      if (ok) fired++;
    }

    // (2) NEW OPPORTUNITY — سهم ظهر في تجميع قوي / pre-surge
    for (const ticker of currentQuietTickers) {
      if (prevQuiet.has(ticker)) continue; // موجود قبل كده
      const ok = insertNotification(db, {
        user_id: targetUserId,
        type: 'radar_opportunity',
        title: '🎯 فرصة تجميع جديدة',
        message: `${ticker} ظهر في تجميع قوي — احتمال انفجار قريب`,
        severity: 'info',
        ticker,
        payload: JSON.stringify({
          ticker,
          source: 'quiet_or_pre_surge',
          current_price: allRadarItems.get(ticker)?.current_price ?? null,
          path: allRadarItems.get(ticker)?.path ?? null,
        }),
      });
      if (ok) fired++;
    }

    // (3) + (4) + (5) نمر على الأسهم المتابَعة فقط
    const newTrackedTransitions: RadarSnapshot['tracked_transitions'] = {};
    // RADAR-QUICK-WINS (Priority 3): per-ticker current path snapshot — only
    // for tracked tickers (kept lean to avoid bloating the JSON file).
    const newTrackedPaths: Record<string, string> = {};
    // L2-ALERTS-EXIT-RADAR: per-stock stage progression. We mutate the
    // existing entries (loaded from snapshot) and persist them back at the
    // end of the loop so the next cycle has accurate baselines.
    const newStockStages: Record<string, StockStage> = {};
    // Seed with previous stages (so existing tickers keep their progress).
    if (prev.stock_stages && typeof prev.stock_stages === 'object') {
      for (const [k, v] of Object.entries(prev.stock_stages)) {
        if (v && typeof v === 'object' && typeof v.ticker === 'string') {
          newStockStages[k.toUpperCase()] = v as StockStage;
        }
      }
    }
    // Load exit radar entries once (used for Stage-Exit detection below).
    const exitEntries = loadExitRadarEntries();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    for (const ticker of trackedTickers) {
      const item = allRadarItems.get(ticker);
      const currentAccumulation = (item?.accumulation || '').trim();
      const currentPath = (item?.path || '').trim();

      const prevEntry = prev.tracked_transitions?.[ticker];

      // حفظ الحالة الحالية في الـ snapshot الجديد
      if (currentAccumulation) {
        if (prevEntry) {
          // حافظ على `since` لو التجميع ما تغيّرش
          newTrackedTransitions[ticker] = {
            prev_accumulation: currentAccumulation,
            since: prevEntry.since || today,
          };
        } else {
          newTrackedTransitions[ticker] = {
            prev_accumulation: currentAccumulation,
            since: today,
          };
        }
      }

      // L2-ALERTS-EXIT-RADAR: ensure this ticker has a StockStage entry.
      // If the stock is new to tracking (no entry in snapshot), start at
      // Stage 1 (it just entered the watchlist → that's the radar_opportunity
      // alert above). If the stock left the radar (item is undefined) → we
      // reset back to Stage 1 so the next entry starts a fresh story.
      let stage = newStockStages[ticker];
      if (!stage) {
        stage = makeInitialStockStage(ticker);
        newStockStages[ticker] = stage;
      }
      if (!item) {
        // Stock left the radar entirely → reset to Stage 1 for a fresh story.
        // Keep the previous target-hit flags so we don't double-fire Stage 4
        // / 5 if the stock re-enters the watchlist at the same price level.
        const resetStage: StockStage = {
          ticker,
          currentStage: 1,
          stageReachedAt: { 1: new Date().toISOString() },
          previousSignalCount: 0,
          previousVolumeRatio: 0,
          targetHitStage1: stage.targetHitStage1,
          targetHitStage2: stage.targetHitStage2,
        };
        newStockStages[ticker] = resetStage;
        // Skip the rest of the per-stage checks — there's no radar data.
        continue;
      }

      // Read the tracked entry's optional per-stock profit targets.
      const trackedEntry = tracking[ticker];
      const target1Pct = Number(trackedEntry?.target_1_pct || DEFAULT_TARGET_1_PCT);
      const target2Pct = Number(trackedEntry?.target_2_pct || DEFAULT_TARGET_2_PCT);

      // (3) ACCUMULATION → DISTRIBUTION FLIP
      const prevAcc = (prevEntry?.prev_accumulation || '').trim();
      const wasAccumulation = prevAcc.includes('تجميع');
      const isDistribution = currentAccumulation.includes('تصريف');
      if (wasAccumulation && isDistribution && prevAcc && currentAccumulation) {
        const ok = insertNotification(db, {
          user_id: targetUserId,
          type: 'radar_distribution',
          title: '⚠️ تحول للتوزيع',
          message: `${ticker} تحول من التجميع إلى التوزيع — راجع الموقف`,
          severity: 'warning',
          ticker,
          payload: JSON.stringify({
            ticker,
            prev_accumulation: prevAcc,
            current_accumulation: currentAccumulation,
            current_price: item?.current_price ?? null,
          }),
        });
        if (ok) fired++;
      }

      // (4) FLARE > 30% — اشتعال حجمي (للمتابَعة فقط عشان منعملش spam)
      const volRatio = Number(item?.volume_ratio_10d_vs_20d || 0);
      if (volRatio > 1.3) {
        const ratioStr = volRatio.toFixed(2);
        const ok = insertNotification(db, {
          user_id: targetUserId,
          type: 'radar_flare',
          title: '🔥 اشتعال حجمي',
          message: `${ticker} حجم اليوم ${ratioStr}× من متوسط 20 يوم`,
          severity: 'info',
          ticker,
          payload: JSON.stringify({
            ticker,
            volume_ratio_10d_vs_20d: volRatio,
            current_price: item?.current_price ?? null,
            avg_turnover_20d: item?.avg_turnover_20d ?? null,
          }),
        });
        if (ok) fired++;
      }

      // (5) PATH UPGRADE — RADAR-QUICK-WINS (Priority 3)
      // Fires when a tracked ticker's radar path moves to a "stronger" tier
      // (e.g. C_quiet_accumulation_weak → A_pre_surge). Downgrades are NOT
      // alerted (only the opportunity-side upgrade is interesting). The path
      // rank ordering matches the radar's confidence ladder.
      const prevPath = (prev.tracked_paths?.[ticker] || '').trim();
      if (currentPath && prevPath && prevPath !== currentPath) {
        const upgrade = isPathUpgrade(prevPath, currentPath);
        if (upgrade) {
          const ok = insertNotification(db, {
            user_id: targetUserId,
            type: 'radar_path_upgrade',
            title: '🚀 ترقية مسار السهم',
            message: `${ticker} ترقى من "${pathShortAr(prevPath)}" إلى "${pathShortAr(currentPath)}" — راجع الرادار`,
            severity: 'success',
            ticker,
            payload: JSON.stringify({
              ticker,
              prev_path: prevPath,
              current_path: currentPath,
              current_price: item?.current_price ?? null,
              upgrade_kind: upgrade,
            }),
          });
          if (ok) fired++;
        }
      }

      // Persist the current path (even if no upgrade fired) so the next
      // cycle has an accurate baseline. Skip when the radar dropped the
      // ticker entirely (item not found in current snapshot).
      if (currentPath) {
        newTrackedPaths[ticker] = currentPath;
      }

      // ─── L2-ALERTS-EXIT-RADAR: Multi-Stage Smart Alerts ───────────────
      // Stage 1 already fired above (radar_opportunity). Stages 2-5 fire
      // here in strict order — once we promote to stage N, we never re-fire
      // earlier stages until the stock leaves the radar (reset above).

      // STAGE 2: Signal strength upgrade (signal_count X→Y, Y >= 4, Y > X)
      const currentSignalCount = getSignalCount(item);
      if (
        stage.currentStage < 2 &&
        currentSignalCount >= 4 &&
        currentSignalCount > stage.previousSignalCount
      ) {
        const ok = insertNotification(db, {
          user_id: targetUserId,
          type: 'radar_signal_upgrade',
          title: '📡 قوة الإشارة ارتفعت',
          message: `${ticker} — قوة الإشارة ارتفعت من ${stage.previousSignalCount}/6 إلى ${currentSignalCount}/6`,
          severity: 'info',
          ticker,
          payload: JSON.stringify({
            ticker,
            stage: 2,
            prev_signal_count: stage.previousSignalCount,
            current_signal_count: currentSignalCount,
            current_price: item.current_price ?? null,
            path: currentPath || null,
          }),
        });
        if (ok) {
          fired++;
          stage = promoteStage(stage, 2);
          newStockStages[ticker] = stage;
        }
      }
      // Always remember the latest signal count for the next cycle.
      stage.previousSignalCount = currentSignalCount;

      // STAGE 3: Volume surge / Pre-Surge (volume_ratio_10d_vs_20d >= 2.0
      // OR path upgrades to A_pre_surge). Fires only after Stage 2 (or
      // directly from Stage 1 if Stage 2 conditions never triggered — e.g.
      // a pre-surge ticker where signal_count is not on the quiet ladder).
      const volumeSurge = volRatio >= 2.0;
      const pathBecamePreSurge = currentPath === 'A_pre_surge' && (prev.tracked_paths?.[ticker] || '') !== 'A_pre_surge';
      if (stage.currentStage < 3 && (volumeSurge || pathBecamePreSurge)) {
        const ratioStr = volRatio.toFixed(2);
        const ok = insertNotification(db, {
          user_id: targetUserId,
          type: 'radar_volume_surge',
          title: '🚀 Pre-Surge حجمي',
          message: `${ticker} — حجم اليوم ${ratioStr}× المعدل! (Pre-Surge)`,
          severity: 'success',
          ticker,
          payload: JSON.stringify({
            ticker,
            stage: 3,
            volume_ratio_10d_vs_20d: volRatio,
            current_price: item.current_price ?? null,
            path: currentPath || null,
            trigger: volumeSurge ? 'volume_ratio' : 'path_upgrade',
          }),
        });
        if (ok) {
          fired++;
          stage = promoteStage(stage, 3);
          newStockStages[ticker] = stage;
        }
      }
      // Always remember the latest volume ratio for the next cycle.
      stage.previousVolumeRatio = volRatio;

      // STAGE 4: Target 1 hit (current_price >= entry_price * (1 + target_1_pct/100))
      // Requires an entry_price from the tracking file. If the user hasn't
      // set one, we skip — Stage 4 needs a baseline to compute gain.
      const entryPrice = Number(trackedEntry?.entryPrice || 0);
      const currentPrice = Number(item.current_price || 0);
      if (stage.currentStage < 4 && entryPrice > 0 && currentPrice > 0) {
        const target1Price = entryPrice * (1 + target1Pct / 100);
        if (currentPrice >= target1Price) {
          const gainPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          const ok = insertNotification(db, {
            user_id: targetUserId,
            type: 'radar_target_hit',
            title: '🎯 وصل الهدف الأول',
            message: `${ticker} — وصل الهدف الأول +${gainPct.toFixed(1)}%!`,
            severity: 'success',
            ticker,
            payload: JSON.stringify({
              ticker,
              stage: 4,
              entry_price: entryPrice,
              current_price: currentPrice,
              target_1_price: target1Price,
              target_1_pct: target1Pct,
              gain_pct: gainPct,
            }),
          });
          if (ok) {
            fired++;
            stage = promoteStage(stage, 4);
            stage.targetHitStage1 = true;
            newStockStages[ticker] = stage;
          }
        }
      }

      // STAGE 5: Take profit suggestion (current_price >= target_1 * 1.05)
      // Fires when the stock has comfortably cleared target 1 (5% above it)
      // and is approaching target 2. We recommend taking half the position.
      if (stage.currentStage < 5 && entryPrice > 0 && currentPrice > 0) {
        const target1Price = entryPrice * (1 + target1Pct / 100);
        const target2Price = entryPrice * (1 + target2Pct / 100);
        if (currentPrice >= target1Price * 1.05) {
          const gainPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          const ok = insertNotification(db, {
            user_id: targetUserId,
            type: 'radar_take_profit',
            title: '💰 اقتراح أخذ ربح',
            message: `${ticker} — يُقترح أخذ نصف الربح والانتظار للهدف الثاني (${target2Price.toFixed(2)})`,
            severity: 'success',
            ticker,
            payload: JSON.stringify({
              ticker,
              stage: 5,
              entry_price: entryPrice,
              current_price: currentPrice,
              target_1_price: target1Price,
              target_2_price: target2Price,
              target_2_pct: target2Pct,
              gain_pct: gainPct,
            }),
          });
          if (ok) {
            fired++;
            stage = promoteStage(stage, 5);
            stage.targetHitStage2 = true;
            newStockStages[ticker] = stage;
          }
        }
      }

      // ─── EXIT RADAR — radar_exit_signal ───────────────────────────────
      // If the tracked stock has entered any of the 5 exit paths (X1-X5),
      // fire a warning alert with the path + suggested action. We fire at
      // most ONE exit_signal per ticker per cycle (highest-priority path
      // already chosen in loadExitRadarEntries above). The 24h dedup in
      // insertNotification prevents spamming if the same exit path persists
      // across multiple scheduler runs in the same day.
      const exitEntry = exitEntries.get(ticker);
      if (exitEntry) {
        const ok = insertNotification(db, {
          user_id: targetUserId,
          type: 'radar_exit_signal',
          title: `🚪 إشارة خروج: ${exitEntry.path_ar}`,
          message: `${ticker} — إشارة خروج: ${exitEntry.path_ar}. ${exitEntry.suggested_action}`,
          severity: 'warning',
          ticker,
          payload: JSON.stringify({
            ticker,
            exit_path: exitEntry.path,
            exit_path_ar: exitEntry.path_ar,
            reason: exitEntry.reason,
            suggested_action: exitEntry.suggested_action,
            current_price: exitEntry.current_price ?? currentPrice ?? null,
          }),
        });
        if (ok) fired++;
      }
    }

    // 5. احفظ الـ snapshot الجديد
    const newSnapshot: RadarSnapshot = {
      last_snapshot_at: new Date().toISOString(),
      explosive_tickers: Array.from(currentExplosiveTickers),
      quiet_tickers: Array.from(currentQuietTickers),
      tracked_transitions: newTrackedTransitions,
      tracked_paths: newTrackedPaths,
      stock_stages: newStockStages,
    };
    saveSnapshot(newSnapshot);

    // 6. سجّل إشارات اليوم في radar_signal_tracking (للتحقق منها لاحقاً)
    recordRadarSignals({
      explosiveList,
      quietList,
      preSurgeList,
      earlyBreakList,
    });

    return fired;
  } catch (err) {
    console.error('[radar-alerts] runRadarAlertsCheck failed:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Convenience: runRadarAlertsForCurrentUser
// ---------------------------------------------------------------------------

/**
 * بيقرأ المستخدم الحالي من الـ session ويشغّل runRadarAlertsCheck له.
 * لو مفيش session، بيستخدم 'system' كـ fallback.
 */
export async function runRadarAlertsForCurrentUser(): Promise<number> {
  try {
    const { userId } = await getSessionUserId();
    return await runRadarAlertsCheck(userId || SYSTEM_USER_ID);
  } catch (err) {
    console.error('[radar-alerts] runRadarAlertsForCurrentUser failed:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Signal Tracker — تسجيل إشارات الرادار اليوم للتحقق منها لاحقاً
// ---------------------------------------------------------------------------

interface RecordSignalsParams {
  explosiveList: RadarItem[];
  quietList: RadarItem[];
  preSurgeList: RadarItem[];
  earlyBreakList: RadarItem[];
}

/**
 * بيفتح db/stocks.db (أو db/data_engine.db) ويسجّل كل سهم في قوائم الرادار
 * اليوم في جدول radar_signal_tracking. الـ dedup بيحصل في recordSignal.
 *
 * بنستخدم shared lib مباشرة (بدل HTTP fetch) لأن:
 *   - أسرع (لا يمر عبر network stack)
 *   - ما بيحتاجش port number
 *   - atomic مع radar-alerts في نفس الـ process
 */
async function recordRadarSignals(params: RecordSignalsParams): Promise<void> {
  try {
    // dynamic import عشان نتجنب circular deps لو في تحميل مسبق
    const { recordSignalsBatch } = await import('@/lib/radar-signal-tracker');
    const signals = [
      // Explosive
      ...params.explosiveList
        .filter((r) => r?.ticker && r?.current_price && r.current_price > 0)
        .map((r) => ({
          ticker: r.ticker!.toUpperCase(),
          signal_type: 'explosive_surge' as const,
          entry_price: r.current_price!,
          path: r.path,
          reason: r.reason,
        })),
      // Quiet — strong vs weak based on path
      ...params.quietList
        .filter((r) => r?.ticker && r?.current_price && r.current_price > 0)
        .map((r) => ({
          ticker: r.ticker!.toUpperCase(),
          signal_type: (r.path === 'B_quiet_accumulation_strong'
            ? 'quiet_accumulation_strong'
            : 'quiet_accumulation_weak') as const,
          entry_price: r.current_price!,
          path: r.path,
          reason: r.reason,
        })),
      // Pre-Surge
      ...params.preSurgeList
        .filter((r) => r?.ticker && r?.current_price && r.current_price > 0)
        .map((r) => ({
          ticker: r.ticker!.toUpperCase(),
          signal_type: 'pre_surge' as const,
          entry_price: r.current_price!,
          path: r.path,
          reason: r.reason,
        })),
      // Early Break
      ...params.earlyBreakList
        .filter((r) => r?.ticker && r?.current_price && r.current_price > 0)
        .map((r) => ({
          ticker: r.ticker!.toUpperCase(),
          signal_type: 'early_break' as const,
          entry_price: r.current_price!,
          path: r.path,
          reason: r.reason,
        })),
    ];

    if (signals.length === 0) return;

    const result = recordSignalsBatch(signals);
    if (result.inserted > 0) {
      console.log(
        `[radar-alerts] recorded ${result.inserted}/${result.total} radar signals (${result.deduped} dedup, ${result.failed} failed)`,
      );
    }
  } catch (err) {
    console.error('[radar-alerts] recordRadarSignals failed:', err);
  }
}
