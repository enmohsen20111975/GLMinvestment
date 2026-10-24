/**
 * engine-control/DeepViewTabs.tsx
 * ===============================
 * Per-Engine Deep View sub-tabs (Task 33 Phase 4).
 *
 * Renders the sub-tab trigger row + the active DeepView body. Wraps the 6 deep
 * view components (DataEngine, NewsEngine, PredictionsEngine, ShariaEngine,
 * Cron, Console) in a single card so the container stays < 500 LOC.
 */
'use client';

import React from 'react';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEEP_VIEWS } from './catalog';
import type { DeepView } from './types';
import type {
  EngineLogsResponse,
  NewsHealthResponse,
  CronHealthResponse,
  ShariaApiResponse,
} from '@/hooks/useEngineControlRoomData';
import { DataEngineDeepView } from './deep-views/DataEngineDeepView';
import { NewsEngineDeepView } from './deep-views/NewsEngineDeepView';
import { PredictionsEngineDeepView } from './deep-views/PredictionsEngineDeepView';
import { ShariaEngineDeepView } from './deep-views/ShariaEngineDeepView';
import { CronDeepView } from './deep-views/CronDeepView';
import { ConsoleDeepView } from './deep-views/ConsoleDeepView';

export interface DeepViewTabsProps {
  deepView: DeepView;
  setDeepView: (v: DeepView) => void;
  loadingLogs: boolean;
  logs: EngineLogsResponse | null;
  newsHealth: NewsHealthResponse | null;
  sharia: ShariaApiResponse | null;
  cronHealth: CronHealthResponse | null;
  consoleEngineFilter: string;
  setConsoleEngineFilter: (s: string) => void;
  consoleSearch: string;
  setConsoleSearch: (s: string) => void;
}

export function DeepViewTabs({
  deepView,
  setDeepView,
  loadingLogs,
  logs,
  newsHealth,
  sharia,
  cronHealth,
  consoleEngineFilter,
  setConsoleEngineFilter,
  consoleSearch,
  setConsoleSearch,
}: DeepViewTabsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-warning" />
          التفاصيل لكل محرك
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Sub-tab triggers */}
        <div className="flex flex-wrap items-center gap-1 mb-3 p-1 bg-muted/40 rounded-lg">
          {DEEP_VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setDeepView(v.id)}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-colors',
                deepView === v.id
                  ? 'bg-background shadow-sm text-profit font-bold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>

        {/* Sub-tab content */}
        {loadingLogs && !logs ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            {deepView === 'data-engine' && <DataEngineDeepView logs={logs} />}
            {deepView === 'news' && <NewsEngineDeepView news={newsHealth} />}
            {deepView === 'predictions' && <PredictionsEngineDeepView logs={logs} />}
            {deepView === 'sharia' && <ShariaEngineDeepView sharia={sharia} />}
            {deepView === 'cron' && <CronDeepView cron={cronHealth} />}
            {deepView === 'console' && (
              <ConsoleDeepView
                logs={logs}
                engineFilter={consoleEngineFilter}
                setEngineFilter={setConsoleEngineFilter}
                search={consoleSearch}
                setSearch={setConsoleSearch}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
