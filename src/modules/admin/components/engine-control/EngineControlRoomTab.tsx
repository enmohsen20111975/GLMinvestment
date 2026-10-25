/**
 * engine-control/EngineControlRoomTab.tsx (container, < 500 LOC)
 * =============================================================
 * The main container for the Engine Control Room — keeps only:
 * - UI state (selectedEngine, liveConsoleEngine, deepView, console filters,
 *   batchLoading).
 * - Data hook delegation (useEngineControlRoomData).
 * - Action handlers (handleAction, handleStartAll, handleStopAll,
 *   handleFullCheck, handleExport).
 * - Lookup helpers (serviceFor, controlFor, logsFor, detailLogsFor, cronInfoFor).
 * - Layout / composition of all child sub-components.
 *
 * Sub-components live alongside this file:
 * - HeaderBar.tsx (the main Card with title + Quick Actions Bar)
 * - DeepViewTabs.tsx (per-engine sub-tabs + 6 DeepView bodies)
 * - EngineCard.tsx (top-grid card per engine)
 * - LiveLogConsole.tsx (bottom-Sheet live log console)
 * - DetailSheet.tsx (left-Sheet engine detail)
 * - deep-views/{Data,News,Predictions,Sharia,Cron,Console}EngineDeepView.tsx
 *
 * Static catalog + helpers live in:
 * - catalog.tsx (ENGINE_CATALOG, DAEMON/CRON/WORKER_ENTRIES, DEEP_VIEWS)
 * - helpers.ts (timeAgoBrief, statusTone, findCronJob, nextRunCountdown, etc.)
 * - types.ts (EngineCardProps, LiveLogConsoleProps, DetailSheetProps, ...)
 *
 * z-ai-web-dev-sdk NOT used. Rule 30 (emerald/amber/red/slate palette only).
 * Rule 4: logical module addition — not a new user-facing route.
 */
'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Clock, Server } from 'lucide-react';
import { toast } from 'sonner';
import {
  useEngineControlRoomData,
  type EngineKey,
  type EngineAction,
  type SystemService,
  type EngineListEntry,
  type EngineLogResult,
} from '@/hooks/useEngineControlRoomData';

import { ENGINE_CATALOG, DAEMON_ENTRIES, CRON_ENTRIES, WORKER_ENTRIES } from './catalog';
import type { CronCardInfo, DeepView } from './types';
import {
  timeAgoBrief,
  downloadJson,
  findCronJob,
  nextRunCountdown,
} from './helpers';
import { HeaderBar } from './HeaderBar';
import { DeepViewTabs } from './DeepViewTabs';
import { EngineCard } from './EngineCard';
import { LiveLogConsole } from './LiveLogConsole';
import { DetailSheet } from './DetailSheet';

export function EngineControlRoomTab() {
  // ----- UI state (kept in component — not data-fetching) -----
  const [selectedEngine, setSelectedEngine] = useState<EngineKey | null>(null);
  const [liveConsoleEngine, setLiveConsoleEngine] = useState<EngineKey | null>(null);
  const [deepView, setDeepView] = useState<DeepView>('data-engine');
  const [consoleEngineFilter, setConsoleEngineFilter] = useState('all');
  const [consoleSearch, setConsoleSearch] = useState('');
  const [batchLoading, setBatchLoading] = useState<'start' | 'stop' | 'check' | null>(null);

  // ----- Data layer (F-Strangler-EngineControlRoom): hook owns all fetch/polling -----
  const {
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
    controlEngine,
    startAll: startAllMut,
    stopAll: stopAllMut,
    fullCheck: fullCheckMut,
  } = useEngineControlRoomData({
    onActionStart: (engineKey) => setLiveConsoleEngine(engineKey),
  });

  // ----- Engine control action -----
  const handleAction = useCallback(async (engineKey: EngineKey, action: EngineAction) => {
    const entry = ENGINE_CATALOG.find(e => e.key === engineKey);
    if (!entry?.controlKey) {
      toast.error('هذا المحرك لا يدعم التحكم المباشر من اللوحة');
      return;
    }
    await controlEngine(entry.controlKey, action, engineKey);
  }, [controlEngine]);

  // ----- Batch actions -----
  const handleStartAll = useCallback(async () => {
    setBatchLoading('start');
    try { await startAllMut(); } finally { setBatchLoading(null); }
  }, [startAllMut]);

  const handleStopAll = useCallback(async () => {
    setBatchLoading('stop');
    try { await stopAllMut(); } finally { setBatchLoading(null); }
  }, [stopAllMut]);

  const handleFullCheck = useCallback(async () => {
    setBatchLoading('check');
    try { await fullCheckMut(); } finally { setBatchLoading(null); }
  }, [fullCheckMut]);

  const handleExport = useCallback(() => {
    const payload = {
      exported_at: new Date().toISOString(),
      system_health: systemHealth,
      control_list: controlList,
      logs,
      cron_health: cronHealth,
      news_health: newsHealth,
      sharia,
    };
    downloadJson(`engine-control-room-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, payload);
    toast.success('تم تصدير التقرير');
  }, [systemHealth, controlList, logs, cronHealth, newsHealth, sharia]);

  // ----- Lookup helpers -----
  const serviceFor = useCallback((key: EngineKey): SystemService | undefined => {
    const entry = ENGINE_CATALOG.find(e => e.key === key);
    if (!entry?.serviceId) return undefined;
    return systemHealth?.services?.find(s => s.id === entry.serviceId);
  }, [systemHealth]);

  const controlFor = useCallback((key: EngineKey): EngineListEntry | undefined => {
    const entry = ENGINE_CATALOG.find(e => e.key === key);
    if (!entry?.controlKey) return undefined;
    return controlList?.engines?.find(e => e.key === entry.controlKey);
  }, [controlList]);

  const logsFor = useCallback((key: EngineKey): { lines: string[]; mtime: string | null } => {
    const entry = ENGINE_CATALOG.find(e => e.key === key);
    if (!entry?.controlKey) return { lines: [], mtime: null };
    const eng = logs?.engines?.[entry.controlKey];
    if (!eng) return { lines: [], mtime: null };
    const allLines: string[] = [];
    let latestMtime: string | null = null;
    for (const f of eng.files) {
      if (!f.exists) continue;
      allLines.push(...f.lines);
      if (f.mtime && (!latestMtime || new Date(f.mtime) > new Date(latestMtime))) {
        latestMtime = f.mtime;
      }
    }
    return { lines: allLines.slice(-5), mtime: latestMtime };
  }, [logs]);

  const detailLogsFor = useCallback((key: EngineKey): EngineLogResult[] => {
    const entry = ENGINE_CATALOG.find(e => e.key === key);
    if (!entry?.controlKey) return [];
    return logs?.engines?.[entry.controlKey]?.files || [];
  }, [logs]);

  const cronInfoFor = useCallback((key: EngineKey): CronCardInfo | undefined => {
    const entry = ENGINE_CATALOG.find(e => e.key === key);
    if (!entry || entry.type !== 'cron' || !entry.cronCommandPattern) return undefined;
    const job = findCronJob(cronHealth, entry.cronCommandPattern);
    const ctrl = controlList?.engines?.find(e => e.key === entry.controlKey);
    const running = ctrl?.running ?? false;
    const nextRun = entry.cronSchedule ? nextRunCountdown(entry.cronSchedule.split(/\s+\+\s+/)[0]) : '—';
    return {
      last_run: job?.last_run ?? null,
      last_run_human: job?.last_run_human ?? null,
      next_run_label: nextRun,
      running,
    };
  }, [cronHealth, controlList]);

  // ----- Health summary -----
  const summary = useMemo(() => {
    if (!systemHealth?.services) return null;
    const online = systemHealth.services.filter(s => s.status === 'online').length;
    const total = systemHealth.services.length;
    return { online, total, score: systemHealth.summary?.health_score ?? 0 };
  }, [systemHealth]);

  const selectedEntry = selectedEngine
    ? ENGINE_CATALOG.find(e => e.key === selectedEngine) || null
    : null;

  return (
    <div className="space-y-5" dir="rtl">
      <HeaderBar
        summary={summary}
        logs={logs}
        batchLoading={batchLoading}
        loadingStatus={loadingStatus}
        loadingLogs={loadingLogs}
        onStartAll={handleStartAll}
        onStopAll={handleStopAll}
        onFullCheck={handleFullCheck}
        onExport={handleExport}
        onManualRefresh={() => { void refetchStatus(); void refetchLogs(); }}
      />

      {/* §1A. Live Engine Grid — 24/7 Daemons */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Server className="w-4 h-4 text-profit" />
            الخدمات الدائمة (24/7 Daemons)
            <Badge variant="outline" className="text-xs ml-1">{DAEMON_ENTRIES.length}</Badge>
          </h3>
          <span className="text-xs text-muted-foreground">
            تحديث كل 30 ثانية · آخر: {logs?.timestamp ? timeAgoBrief(logs.timestamp) : '—'}
          </span>
        </div>

        {loadingStatus && !systemHealth ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: DAEMON_ENTRIES.length }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {DAEMON_ENTRIES.map((entry) => {
              const { lines, mtime } = logsFor(entry.key);
              return (
                <EngineCard
                  key={entry.key}
                  entry={entry}
                  service={serviceFor(entry.key)}
                  controlInfo={controlFor(entry.key)}
                  logs={lines}
                  logsMtime={mtime}
                  onClick={() => setSelectedEngine(entry.key)}
                  onAction={(action) => handleAction(entry.key, action)}
                  onOpenLiveConsole={() => setLiveConsoleEngine(entry.key)}
                  actionLoading={!!actionLoading && actionEngine === entry.key}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* §1A2. Live Engine Grid — Background Workers (Task 35-C) */}
      {WORKER_ENTRIES.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 text-profit" />
              عمليات الخلفية (Background Workers)
              <Badge variant="outline" className="text-xs ml-1">{WORKER_ENTRIES.length}</Badge>
            </h3>
            <span className="text-xs text-muted-foreground">
              فحص عبر pgrep · آخر فحص: {controlList?.timestamp ? timeAgoBrief(controlList.timestamp) : '—'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {WORKER_ENTRIES.map((entry) => {
              const { lines, mtime } = logsFor(entry.key);
              return (
                <EngineCard
                  key={entry.key}
                  entry={entry}
                  service={serviceFor(entry.key)}
                  controlInfo={controlFor(entry.key)}
                  logs={lines}
                  logsMtime={mtime}
                  onClick={() => setSelectedEngine(entry.key)}
                  onAction={(action) => handleAction(entry.key, action)}
                  onOpenLiveConsole={() => setLiveConsoleEngine(entry.key)}
                  actionLoading={!!actionLoading && actionEngine === entry.key}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* §1B. Live Engine Grid — Scheduled Cron Jobs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Clock className="w-4 h-4 text-warning" />
            المحركات المجدولة (Cron Jobs)
            <Badge variant="outline" className="text-xs ml-1">{CRON_ENTRIES.length}</Badge>
          </h3>
          <span className="text-xs text-muted-foreground">
            تُشغّل تلقائياً حسب الجدولة · آخر فحص كرون: {cronHealth?.timestamp ? timeAgoBrief(cronHealth.timestamp) : '—'}
          </span>
        </div>

        {loadingStatus && !systemHealth ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CRON_ENTRIES.map((entry) => {
              const { lines, mtime } = logsFor(entry.key);
              return (
                <EngineCard
                  key={entry.key}
                  entry={entry}
                  service={serviceFor(entry.key)}
                  controlInfo={controlFor(entry.key)}
                  cronInfo={cronInfoFor(entry.key)}
                  logs={lines}
                  logsMtime={mtime}
                  onClick={() => setSelectedEngine(entry.key)}
                  onAction={(action) => handleAction(entry.key, action)}
                  onOpenLiveConsole={() => setLiveConsoleEngine(entry.key)}
                  actionLoading={!!actionLoading && actionEngine === entry.key}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* §2. Per-Engine Deep View (sub-tabs) */}
      <DeepViewTabs
        deepView={deepView}
        setDeepView={setDeepView}
        loadingLogs={loadingLogs}
        logs={logs}
        newsHealth={newsHealth}
        sharia={sharia}
        cronHealth={cronHealth}
        consoleEngineFilter={consoleEngineFilter}
        setConsoleEngineFilter={setConsoleEngineFilter}
        consoleSearch={consoleSearch}
        setConsoleSearch={setConsoleSearch}
      />

      {/* Detail Sheet (engine card click) */}
      <DetailSheet
        entry={selectedEntry}
        service={selectedEntry ? serviceFor(selectedEntry.key) : undefined}
        controlInfo={selectedEntry ? controlFor(selectedEntry.key) : undefined}
        logs={selectedEntry ? detailLogsFor(selectedEntry.key) : []}
        onClose={() => setSelectedEngine(null)}
        onAction={(action) => selectedEntry && handleAction(selectedEntry.key, action)}
        actionLoading={!!actionLoading}
      />

      {/* Task 33 Phase 5: Live Log Console (bottom Sheet) */}
      {liveConsoleEngine && (() => {
        const entry = ENGINE_CATALOG.find(e => e.key === liveConsoleEngine);
        if (!entry?.controlKey) return null;
        return (
          <LiveLogConsole
            engineControlKey={entry.controlKey}
            entry={entry}
            actionInProgress={!!actionLoading && actionEngine === liveConsoleEngine}
            onClose={() => setLiveConsoleEngine(null)}
            onRerun={() => handleAction(liveConsoleEngine, 'start')}
          />
        );
      })()}
    </div>
  );
}
