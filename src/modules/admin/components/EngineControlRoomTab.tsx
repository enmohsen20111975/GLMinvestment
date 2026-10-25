'use client';

/**
 * EngineControlRoomTab.tsx — SHIM (F-Phase3-Split-Batch7)
 * ========================================================
 * The actual implementation has been split into the `engine-control/` folder:
 *
 *   engine-control/
 *     ├── types.ts                    — EngineCatalogEntry, EngineCardProps,
 *     │                                  LiveLogConsoleProps, DetailSheetProps, ...
 *     ├── helpers.ts                  — timeAgoBrief, statusTone, findCronJob,
 *     │                                  nextRunCountdown, cronTone, downloadJson, ...
 *     ├── catalog.tsx                 — ENGINE_CATALOG (8 entries) +
 *     │                                  DAEMON/CRON/WORKER_ENTRIES + DEEP_VIEWS
 *     ├── EngineCard.tsx              — top-grid card per engine (cron / worker / daemon branches)
 *     ├── LiveLogConsole.tsx          — bottom-Sheet live log console (Task 33 Phase 5)
 *     ├── DetailSheet.tsx             — left-Sheet engine detail (action buttons + log files)
 *     ├── EngineControlRoomTab.tsx    — container (< 500 LOC, owns UI state + data hook)
 *     ├── deep-views/
 *     │     ├── DataEngineDeepView.tsx
 *     │     ├── NewsEngineDeepView.tsx
 *     │     ├── PredictionsEngineDeepView.tsx
 *     │     ├── ShariaEngineDeepView.tsx
 *     │     ├── CronDeepView.tsx
 *     │     └── ConsoleDeepView.tsx
 *     └── index.ts                   — barrel re-exports
 *
 * This shim re-exports `EngineControlRoomTab` for backward compatibility —
 * any code importing from `@/modules/admin/components/EngineControlRoomTab`
 * continues to work without changes.
 *
 * Rule 75: commit + push after success. Rule 30: emerald + amber + red + slate.
 * z-ai-web-dev-sdk NOT used.
 */
export { EngineControlRoomTab } from './engine-control';
export type {
  EngineCatalogEntry,
  EngineCardProps,
  CronCardInfo,
  LiveLogConsoleProps,
  DetailSheetProps,
  DeepView,
} from './engine-control/types';
