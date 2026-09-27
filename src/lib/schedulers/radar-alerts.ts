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
 * Snapshot file: db/radar_alerts_state.json
 *   {
 *     "last_snapshot_at": "...",
 *     "explosive_tickers": ["COMI", "HRHO"],
 *     "quiet_tickers": ["EFIN", "SWDY"],
 *     "tracked_transitions": { "COMI": { "prev_accumulation": "تجميع خفيف", "since": "..." } },
 *     "tracked_paths": { "COMI": "B_quiet_accumulation_strong" }
 *   }
 *
 * قواعد:
 *   - كل التنبيهات user_id = 'system' (radar-wide alerts, لا تخص مستخدم)
 *   - try/catch كامل — مايمكنش يقع أبداً
 *   - لو readRadarCache() رجع null → نرجع 0 بصمت
 *   - insertNotification بتعتبر dedup 24h (موجود في alert-engine.ts)
 */

import { readRadarCache } from '@/lib/radar-cache';
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
}

interface EmptySnapshot {
  last_snapshot_at: string;
  explosive_tickers: never[];
  quiet_tickers: never[];
  tracked_transitions: Record<string, never>;
  tracked_paths: Record<string, never>;
}

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
    }

    // 5. احفظ الـ snapshot الجديد
    const newSnapshot: RadarSnapshot = {
      last_snapshot_at: new Date().toISOString(),
      explosive_tickers: Array.from(currentExplosiveTickers),
      quiet_tickers: Array.from(currentQuietTickers),
      tracked_transitions: newTrackedTransitions,
      tracked_paths: newTrackedPaths,
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
