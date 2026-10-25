/**
 * engine-control/index.ts
 * =======================
 * Barrel exports for the Engine Control Room module.
 *
 * Re-exports the main `EngineControlRoomTab` component + the static catalog +
 * the helper functions + the shared types so consumers can import via a single
 * entry point: `import { EngineControlRoomTab, ENGINE_CATALOG } from './engine-control';`
 */
export { EngineControlRoomTab } from './EngineControlRoomTab';
export { HeaderBar } from './HeaderBar';
export { DeepViewTabs } from './DeepViewTabs';
export { EngineCard } from './EngineCard';
export { LiveLogConsole } from './LiveLogConsole';
export { DetailSheet } from './DetailSheet';
export {
  ENGINE_CATALOG,
  DAEMON_ENTRIES,
  CRON_ENTRIES,
  WORKER_ENTRIES,
  DEEP_VIEWS,
} from './catalog';
export {
  timeAgoBrief,
  statusTone,
  looksLikeError,
  severityOf,
  downloadJson,
  findCronJob,
  nextRunCountdown,
  cronTone,
  LIVE_LOG_POLL_MS,
  LIVE_LOG_MAX_LINES,
} from './helpers';
export type {
  EngineCatalogEntry,
  EngineCardProps,
  CronCardInfo,
  LiveLogConsoleProps,
  DetailSheetProps,
  DeepView,
} from './types';
