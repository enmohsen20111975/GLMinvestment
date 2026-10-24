'use client';

/**
 * hooks/useEngineControlRoomData.ts
 * ============================================================================
 * F-Strangler-EngineControlRoom: Strangler Pattern extraction from
 * EngineControlRoomTab.tsx (2,481 LOC).
 * ----------------------------------------------------------------------------
 * قبل كده: EngineControlRoomTab.tsx كان فيه 5 manual useCallback fetchers
 * (fetchStatus / fetchLogs / fetchCron / fetchNews / fetchSharia) + 9 useState
 * لـ data-related state (systemHealth / controlList / logs / cronHealth /
 * newsHealth / sharia / loadingStatus / loadingLogs / actionLoading /
 * actionEngine) كلهم inline في الـ component. كمان فيه 3 POST mutations
 * (handleAction / handleStartAll / handleStopAll) + handleFullCheck + polling
 * useEffect بـ setInterval كل 30s (status) و 15s (logs).
 *
 * دلوقتي: كل الـ data logic هنا. الـ component بقا render-only:
 *   const {
 *     systemHealth, controlList, logs, cronHealth, newsHealth, sharia,
 *     loadingStatus, loadingLogs,
 *     actionLoading, actionEngine,
 *     refetchStatus, refetchLogs, refetchCron, refetchNews, refetchSharia,
 *     controlEngine, startAll, stopAll, fullCheck,
 *   } = useEngineControlRoomData({ onActionStart });
 *
 * الـ hook بيستخدم TanStack Query (useQuery) لـ 5 من الـ fetches:
 *   1. GET /api/admin/system-health                            ← port-check summary
 *   2. GET /api/admin/engines/control                          ← pgrep status list
 *   3. GET /api/admin/engines/logs?limit=50                     ← live log tail
 *   4. GET /api/admin/cron-health                               ← 25 cron jobs
 *   5. GET /api/admin/news-health                               ← news source health
 *   6. GET /api/sharia?limit=1                                  ← sharia stats
 *
 * الـ mutations (controlEngine / startAll / stopAll / fullCheck) بتفضل manual
 * `fetch()` POST زي الأصل — لأنها side-effect actions مش read queries (TanStack
 * Query مبيـ cache-ش الـ mutations تلقائياً unless we wrap them in useMutation,
 * وده overkill للـ 3 simple POSTs هنا).
 *
 * Polling behavior preserved:
 *   - systemHealthQ + controlListQ: refetch every 30s (STATUS_REFRESH_MS)
 *   - logsQ: refetch every 15s (LOGS_REFRESH_MS)
 *   - cronHealthQ + newsHealthQ + shariaQ: no auto-polling (manual refresh
 *     via "فحص شامل" button)
 *
 * Side effects محفوظة زي ما هي:
 *   - controlEngine على نجاح/فشل 'start': بـ يـ trigger `onActionStart(engineKey)`
 *     callback (الـ component بـ يـفتح بيها Live Log Console).
 *   - controlEngine بعد 1s: بـ يعمل refetch لـ status + logs.
 *   - startAll/stopAll بعد 1.5s: بـ يعمل refetch لـ status + logs.
 *   - fullCheck: بـ يعمل refetch لـ كل الـ queries الـ 5 + toast على النجاح.
 *
 * TanStack Query v5 notes:
 *   - `refetchInterval`: polling interval (milliseconds). يعمل refetch تلقائي
 *     حتى لو الـ cache لسه fresh.
 *   - `staleTime: 0` (default): الـ cache بـ يبقى stale فوراً، فأي mount جديد
 *     بـ يعمل refetch. ده matches original behavior (كل ما الـ component يـmount
 *     بـ يعمل fetch جديد لـ كل الـ endpoints).
 * ============================================================================
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiGet, type ApiResponse } from '@/lib/api-client';

// ============================================================
// Types — API response shapes (mirror the API JSON exactly)
// ============================================================

export interface SystemService {
  id: string;
  name_ar: string;
  type: 'http' | 'tcp' | 'process' | 'file';
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  latency_ms?: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface SystemHealthResponse {
  success: boolean;
  timestamp?: string;
  summary?: {
    total: number;
    online: number;
    offline: number;
    degraded: number;
    health_score: number;
  };
  services?: SystemService[];
  error?: string;
}

export interface EngineLogResult {
  path: string;
  exists: boolean;
  mtime: string | null;
  size: number;
  lines: string[];
  error?: string;
}

export interface EngineLogsResponse {
  success: boolean;
  timestamp: string;
  engine?: string;
  engines: Record<string, { label: string; files: EngineLogResult[] }>;
  errors_only?: Array<{ engine: string; path: string; line: string; mtime: string | null }>;
  error?: string;
}

export interface SingleEngineLogsResponse {
  success: boolean;
  engine: string;
  label?: string;
  lines: string[];
  total_lines: number;
  fetched_at: string;
  file_exists: boolean;
  latest_mtime?: string | null;
  files?: Array<{
    path: string;
    exists: boolean;
    mtime: string | null;
    size: number;
    line_count: number;
    error?: string;
  }>;
  error?: string;
}

export interface LiveEngineStatusResponse {
  success: boolean;
  engine: string;
  label?: string;
  type: 'daemon' | 'cron';
  pattern: string;
  running: boolean;
  pids: number[];
  state: 'running' | 'scheduled' | 'stopped';
  timestamp: string;
  error?: string;
}

export interface EngineControlResponse {
  success: boolean;
  action?: string;
  engine?: string;
  label?: string;
  message?: string;
  pids?: number[];
  pids_before?: number[];
  pids_after?: number[];
  log_file?: string;
  stdout?: string;
  stderr?: string;
  timestamp?: string;
  error?: string;
}

export interface EngineListEntry {
  key: string;
  label: string;
  kill_pattern: string;
  log_file: string;
  running: boolean;
  pids: number[];
}

export interface EngineControlListResponse {
  success: boolean;
  timestamp?: string;
  engines?: EngineListEntry[];
  error?: string;
}

export interface CronJob {
  id: number;
  schedule: string;
  schedule_human: string;
  days_ar: string;
  command: string;
  full_command: string;
  log_file: string | null;
  last_run: string | null;
  last_run_human: string | null;
  exists_log: boolean;
  description: string;
  category: string;
}

export interface CronHealthResponse {
  success: boolean;
  error?: string;
  timestamp?: string;
  source?: string;
  summary?: {
    total_jobs: number;
    jobs_ran: number;
    jobs_never_run: number;
    jobs_run_today: number;
    jobs_stale_7d: number;
  };
  jobs?: CronJob[];
}

export interface NewsSourceHealth {
  source: string;
  source_type: 'rss' | 'telegram' | 'web' | 'broken';
  article_count: number;
  last_fetch: string | null;
  last_fetch_human: string | null;
  is_broken: boolean;
  broken_reason?: string;
  success_rate: number;
  success_rate_label: 'healthy' | 'degraded' | 'broken';
}

export interface NewsHealthResponse {
  success: boolean;
  error?: string;
  detail?: string;
  timestamp?: string;
  total_sources?: number;
  total_articles?: number;
  broken_sources_count?: number;
  sources?: NewsSourceHealth[];
  known_broken_sources?: Array<{ source: string; reason: string }>;
}

export interface ShariaApiResponse {
  success: boolean;
  error?: string;
  stats?: {
    total?: number;
    consensus_count?: number;
    with_sp_rate?: number;
    latest_source_update?: string | null;
  };
  sources?: Array<{
    source_key: string;
    name_ar: string;
    methodology?: string | null;
    is_active?: number | boolean;
  }>;
  alias_map?: {
    totals: Array<{
      match_method: string;
      confidence: string;
      needs_review: number;
      n: number;
    }>;
    review_queue: Array<{
      source_symbol: string;
      resolved_ticker: string;
      match_method: string | null;
      confidence: string | null;
      needs_review: number | boolean;
      source_name_ar: string | null;
      matched_in: string | null;
      resolved_at: string | null;
    }>;
  };
  primary_method?: string;
  consensus_min?: number;
  generated_at?: string;
}

// ============================================================
// EngineKey — union of the 8 engine card keys (kept in sync with
// ENGINE_CATALOG in EngineControlRoomTab.tsx). Exported so the component
// can import it without re-declaring.
// ============================================================

export type EngineKey =
  | 'data_engine'
  | 'python_backend'
  | 'websocket'
  | 'telegram'
  | 'news_agent'
  | 'predictions'
  | 'learning'
  | 'sharia';

// ============================================================
// Action types
// ============================================================

export type EngineAction = 'start' | 'stop' | 'restart';

// ============================================================
// Constants (mirroring the original component)
// ============================================================

const STATUS_REFRESH_MS = 30_000;
const LOGS_REFRESH_MS = 15_000;

// ============================================================
// Hook options + return type
// ============================================================

export interface UseEngineControlRoomDataOptions {
  /**
   * Called when a 'start' action completes (success OR failure) so the
   * component can open the Live Log Console for that engine. Mirrors the
   * original `setLiveConsoleEngine(engineKey)` side effect.
   */
  onActionStart?: (engineKey: EngineKey) => void;
}

export interface UseEngineControlRoomDataResult {
  // ----- Top grid data (5 sources) -----
  systemHealth: SystemHealthResponse | null;
  controlList: EngineControlListResponse | null;
  logs: EngineLogsResponse | null;
  cronHealth: CronHealthResponse | null;
  newsHealth: NewsHealthResponse | null;
  sharia: ShariaApiResponse | null;

  // ----- Loading flags (initial-load only — refetches don't flip) -----
  loadingStatus: boolean;
  loadingLogs: boolean;

  // ----- Action state -----
  actionLoading: EngineAction | null;
  actionEngine: EngineKey | null;

  // ----- Manual refetchers (for "تحديث" + "فحص شامل" buttons) -----
  refetchStatus: () => Promise<void>;
  refetchLogs: () => Promise<void>;
  refetchCron: () => Promise<void>;
  refetchNews: () => Promise<void>;
  refetchSharia: () => Promise<void>;

  // ----- Mutations (POST) -----
  controlEngine: (
    controlKey: string,
    action: EngineAction,
    engineKey: EngineKey
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  startAll: () => Promise<{ success: boolean; summary?: { success: number; total: number } }>;
  stopAll: () => Promise<{ success: boolean; summary?: { success: number; total: number } }>;
  fullCheck: () => Promise<void>;
}

// ============================================================
// Hook implementation
// ============================================================

export function useEngineControlRoomData(
  opts: UseEngineControlRoomDataOptions = {}
): UseEngineControlRoomDataResult {
  const { onActionStart } = opts;

  // -------------------------------------------------------------------------
  // 1) systemHealth — GET /api/admin/system-health (polls every 30s)
  // -------------------------------------------------------------------------

  const systemHealthQ = useQuery<ApiResponse<SystemHealthResponse>>({
    queryKey: ['engine-control-room', 'system-health'],
    queryFn: () => apiGet<SystemHealthResponse>('/api/admin/system-health'),
    refetchInterval: STATUS_REFRESH_MS,
  } satisfies UseQueryOptions<ApiResponse<SystemHealthResponse>>);

  const systemHealth = useMemo<SystemHealthResponse | null>(() => {
    const json = systemHealthQ.data as unknown as SystemHealthResponse | undefined;
    if (!json?.success) return null;
    return json;
  }, [systemHealthQ.data]);

  // -------------------------------------------------------------------------
  // 2) controlList — GET /api/admin/engines/control (polls every 30s)
  // -------------------------------------------------------------------------

  const controlListQ = useQuery<ApiResponse<EngineControlListResponse>>({
    queryKey: ['engine-control-room', 'engines-control'],
    queryFn: () => apiGet<EngineControlListResponse>('/api/admin/engines/control'),
    refetchInterval: STATUS_REFRESH_MS,
  } satisfies UseQueryOptions<ApiResponse<EngineControlListResponse>>);

  const controlList = useMemo<EngineControlListResponse | null>(() => {
    const json = controlListQ.data as unknown as EngineControlListResponse | undefined;
    if (!json?.success) return null;
    return json;
  }, [controlListQ.data]);

  const loadingStatus = systemHealthQ.isLoading || controlListQ.isLoading;

  // -------------------------------------------------------------------------
  // 3) logs — GET /api/admin/engines/logs?limit=50 (polls every 15s)
  // -------------------------------------------------------------------------

  const logsQ = useQuery<ApiResponse<EngineLogsResponse>>({
    queryKey: ['engine-control-room', 'engines-logs'],
    queryFn: () => apiGet<EngineLogsResponse>('/api/admin/engines/logs?limit=50'),
    refetchInterval: LOGS_REFRESH_MS,
  } satisfies UseQueryOptions<ApiResponse<EngineLogsResponse>>);

  const logs = useMemo<EngineLogsResponse | null>(() => {
    const json = logsQ.data as unknown as EngineLogsResponse | undefined;
    if (!json?.success) return null;
    return json;
  }, [logsQ.data]);

  const loadingLogs = logsQ.isLoading;

  // -------------------------------------------------------------------------
  // 4) cronHealth — GET /api/admin/cron-health (no polling)
  // -------------------------------------------------------------------------

  const cronHealthQ = useQuery<ApiResponse<CronHealthResponse>>({
    queryKey: ['engine-control-room', 'cron-health'],
    queryFn: () => apiGet<CronHealthResponse>('/api/admin/cron-health'),
  } satisfies UseQueryOptions<ApiResponse<CronHealthResponse>>);

  const cronHealth = useMemo<CronHealthResponse | null>(() => {
    const json = cronHealthQ.data as unknown as CronHealthResponse | undefined;
    if (!json?.success) return null;
    return json;
  }, [cronHealthQ.data]);

  // -------------------------------------------------------------------------
  // 5) newsHealth — GET /api/admin/news-health (no polling)
  // -------------------------------------------------------------------------

  const newsHealthQ = useQuery<ApiResponse<NewsHealthResponse>>({
    queryKey: ['engine-control-room', 'news-health'],
    queryFn: () => apiGet<NewsHealthResponse>('/api/admin/news-health'),
  } satisfies UseQueryOptions<ApiResponse<NewsHealthResponse>>);

  const newsHealth = useMemo<NewsHealthResponse | null>(() => {
    const json = newsHealthQ.data as unknown as NewsHealthResponse | undefined;
    if (!json?.success) return null;
    return json;
  }, [newsHealthQ.data]);

  // -------------------------------------------------------------------------
  // 6) sharia — GET /api/sharia?limit=1 (no polling)
  // -------------------------------------------------------------------------

  const shariaQ = useQuery<ApiResponse<ShariaApiResponse>>({
    queryKey: ['engine-control-room', 'sharia'],
    queryFn: () => apiGet<ShariaApiResponse>('/api/sharia?limit=1'),
  } satisfies UseQueryOptions<ApiResponse<ShariaApiResponse>>);

  const sharia = useMemo<ShariaApiResponse | null>(() => {
    const json = shariaQ.data as unknown as ShariaApiResponse | undefined;
    if (!json?.success) return null;
    return json;
  }, [shariaQ.data]);

  // -------------------------------------------------------------------------
  // Refetchers
  // -------------------------------------------------------------------------

  const refetchStatus = useCallback(async () => {
    await Promise.all([systemHealthQ.refetch(), controlListQ.refetch()]);
  }, [systemHealthQ, controlListQ]);

  const refetchLogs = useCallback(async () => {
    await logsQ.refetch();
  }, [logsQ]);

  const refetchCron = useCallback(async () => {
    await cronHealthQ.refetch();
  }, [cronHealthQ]);

  const refetchNews = useCallback(async () => {
    await newsHealthQ.refetch();
  }, [newsHealthQ]);

  const refetchSharia = useCallback(async () => {
    await shariaQ.refetch();
  }, [shariaQ]);

  // -------------------------------------------------------------------------
  // Action state — kept in the hook because it's tightly coupled to the
  // mutations below (set on entry, cleared on exit, drives per-card spinner).
  // -------------------------------------------------------------------------

  const [actionLoading, setActionLoading] = useState<EngineAction | null>(null);
  const [actionEngine, setActionEngine] = useState<EngineKey | null>(null);

  // -------------------------------------------------------------------------
  // Mutation: controlEngine — POST /api/admin/engines/control
  // Mirrors original handleAction (minus the ENGINE_CATALOG lookup, which
  // stays in the component).
  // -------------------------------------------------------------------------

  const controlEngine = useCallback(
    async (
      controlKey: string,
      action: EngineAction,
      engineKey: EngineKey
    ): Promise<{ success: boolean; message?: string; error?: string }> => {
      setActionLoading(action);
      setActionEngine(engineKey);
      try {
        const res = await fetch('/api/admin/engines/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ engine: controlKey, action }),
        });
        const json: EngineControlResponse = await res.json();
        if (json.success) {
          toast.success(json.message || `${action} OK`);
          // Task 33 Phase 5: open Live Log Console on 'start' (daemon) or
          // 'start' (cron manual trigger) so the user sees live progress.
          // Also fires on success — the original behavior.
          if (action === 'start' && onActionStart) {
            onActionStart(engineKey);
          }
          // Refresh status + logs after action (1s delay to let the
          // process start/stop register on the backend).
          setTimeout(() => {
            void refetchStatus();
            void refetchLogs();
          }, 1000);
          return { success: true, message: json.message };
        } else {
          toast.error(json.error || json.message || `فشل: ${action}`);
          // Even on failure, open the Live Log Console so the user can see
          // what went wrong (e.g. venv_missing shows up in the response body).
          if (action === 'start' && onActionStart) {
            onActionStart(engineKey);
          }
          return { success: false, error: json.error || json.message };
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
        return { success: false, error: err instanceof Error ? err.message : 'network error' };
      } finally {
        setActionLoading(null);
        setActionEngine(null);
      }
    },
    [onActionStart, refetchStatus, refetchLogs]
  );

  // -------------------------------------------------------------------------
  // Mutation: startAll — POST /api/admin/engines/start-all
  // -------------------------------------------------------------------------

  const startAll = useCallback(async (): Promise<{
    success: boolean;
    summary?: { success: number; total: number };
  }> => {
    try {
      const res = await fetch('/api/admin/engines/start-all', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const json = await res.json();
      const summary = json.summary as { success: number; total: number } | undefined;
      if (json.success) {
        toast.success(`تم تشغيل ${summary?.success}/${summary?.total} محرك`);
      } else {
        toast.error(`نجح ${summary?.success}/${summary?.total} — راجع السجلات`);
      }
      setTimeout(() => {
        void refetchStatus();
        void refetchLogs();
      }, 1500);
      return { success: !!json.success, summary };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
      return { success: false };
    }
  }, [refetchStatus, refetchLogs]);

  // -------------------------------------------------------------------------
  // Mutation: stopAll — POST /api/admin/engines/stop-all
  // -------------------------------------------------------------------------

  const stopAll = useCallback(async (): Promise<{
    success: boolean;
    summary?: { success: number; total: number };
  }> => {
    try {
      const res = await fetch('/api/admin/engines/stop-all', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const json = await res.json();
      const summary = json.summary as { success: number; total: number } | undefined;
      if (json.success) {
        toast.success(`تم إيقاف ${summary?.success}/${summary?.total} محرك`);
      } else {
        toast.error(`نجح ${summary?.success}/${summary?.total} — راجع السجلات`);
      }
      setTimeout(() => {
        void refetchStatus();
        void refetchLogs();
      }, 1500);
      return { success: !!json.success, summary };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
      return { success: false };
    }
  }, [refetchStatus, refetchLogs]);

  // -------------------------------------------------------------------------
  // Mutation: fullCheck — Promise.all of all 5 fetchers + toast
  // -------------------------------------------------------------------------

  const fullCheck = useCallback(async (): Promise<void> => {
    try {
      await Promise.all([
        refetchStatus(),
        refetchLogs(),
        refetchCron(),
        refetchNews(),
        refetchSharia(),
      ]);
      toast.success('اكتمل الفحص الشامل');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الفحص');
    }
  }, [refetchStatus, refetchLogs, refetchCron, refetchNews, refetchSharia]);

  // -------------------------------------------------------------------------

  return {
    systemHealth,
    controlList,
    logs,
    cronHealth,
    newsHealth,
    sharia,
    loadingStatus,
    loadingLogs,
    actionLoading,
    actionEngine,
    refetchStatus,
    refetchLogs,
    refetchCron,
    refetchNews,
    refetchSharia,
    controlEngine,
    startAll,
    stopAll,
    fullCheck,
  };
}
