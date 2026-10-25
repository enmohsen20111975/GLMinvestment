/**
 * engine-control/types.ts
 * =======================
 * Shared types for the Engine Control Room (Task 31-B).
 *
 * - EngineCatalogEntry: the static catalog row for each of the 8 engine cards.
 * - EngineCardProps / CronCardInfo: props for the EngineCard grid component.
 * - LiveLogConsoleProps: props for the bottom-Sheet live log console.
 * - DetailSheetProps: props for the engine detail Sheet (left slide-over).
 * - DeepView: union of the 6 per-engine deep-view sub-tab ids.
 *
 * z-ai-web-dev-sdk NOT used. Rule 30 (emerald/amber/red/slate palette only).
 */
import type React from 'react';
import type {
  EngineKey,
  EngineAction,
  SystemService,
  EngineListEntry,
  EngineLogResult,
  EngineLogsResponse,
  LiveEngineStatusResponse,
} from '@/hooks/useEngineControlRoomData';

export interface EngineCatalogEntry {
  key: EngineKey;
  name_ar: string;
  name_en: string;
  port: number | null;
  icon: React.ReactNode;
  /** daemon = 24/7 port-bound service; cron = scheduled one-shot job that
   * exits after running; worker = long-running background Python process that
   * does NOT open a port (e.g. News Agent) — status via pgrep + recent-log. */
  type: 'daemon' | 'cron' | 'worker';
  /** Maps this card to the engine-control / logs keys when applicable. */
  controlKey?: 'data_engine' | 'news' | 'predictions' | 'learning' | 'sharia';
  /** Maps this card to a system-health service id. */
  serviceId?: string;
  /** For cron engines: the crontab command pattern (used to match cron-health jobs). */
  cronCommandPattern?: string;
  /** For cron engines: the human-readable cron schedule (e.g. "0 3 * * 0-4"). */
  cronSchedule?: string;
  /** For cron engines: the Arabic label for the schedule. */
  cronScheduleAr?: string;
  /** For worker engines: the pgrep pattern used to detect the process (e.g. "news-agent"). */
  workerPattern?: string;
  /** For worker engines: the log file path (used to compute last_seen freshness). */
  workerLogPath?: string;
}

export interface CronCardInfo {
  last_run: string | null;
  last_run_human: string | null;
  next_run_label: string;
  running: boolean;
}

export interface EngineCardProps {
  entry: EngineCatalogEntry;
  service?: SystemService;
  controlInfo?: EngineListEntry;
  logs: string[];
  logsMtime: string | null;
  cronInfo?: CronCardInfo;
  onClick: () => void;
  onAction: (action: 'start' | 'stop' | 'restart') => void;
  /** Open the Live Log Console for this engine. */
  onOpenLiveConsole: () => void;
  actionLoading: boolean;
}

export interface LiveLogConsoleProps {
  /** Engine key ('data_engine' | 'news' | 'predictions' | 'learning' | 'sharia') — passed to the API. */
  engineControlKey: 'data_engine' | 'news' | 'predictions' | 'learning' | 'sharia';
  /** Display info from the catalog (icon + Arabic name + type). */
  entry: EngineCatalogEntry;
  /** Whether the parent just triggered an action (shows "جاري التنفيذ..." spinner). */
  actionInProgress: boolean;
  onClose: () => void;
  /** Optional: re-trigger the start action from inside the console. */
  onRerun?: () => void;
}

export interface DetailSheetProps {
  entry: EngineCatalogEntry | null;
  service?: SystemService;
  controlInfo?: EngineListEntry;
  logs: EngineLogResult[];
  onClose: () => void;
  onAction: (action: 'start' | 'stop' | 'restart') => void;
  actionLoading: boolean;
}

export type DeepView = 'data-engine' | 'news' | 'predictions' | 'sharia' | 'cron' | 'console';

/** Re-export data types so consumers of this module don't need to also import from @/hooks. */
export type {
  EngineKey,
  EngineAction,
  SystemService,
  EngineListEntry,
  EngineLogResult,
  EngineLogsResponse,
  LiveEngineStatusResponse,
};
