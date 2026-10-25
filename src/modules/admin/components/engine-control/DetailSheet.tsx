/**
 * engine-control/DetailSheet.tsx
 * ==============================
 * Detail Sheet — opens when an engine card is clicked.
 *
 * Shows the full per-engine details: service message + JSON details, action
 * buttons (start/stop/restart), and all available log files with their last
 * update times and tail content.
 *
 * Task 35-C: workers use process + log-freshness logic (not port-based).
 * Daemons + crons: existing logic (port-reachability via service.status).
 */
'use client';

import React from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Square, RotateCcw, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DetailSheetProps } from './types';
import { statusTone, looksLikeError, timeAgoBrief } from './helpers';

export function DetailSheet({ entry, service, controlInfo, logs, onClose, onAction, actionLoading }: DetailSheetProps) {
  if (!entry) return null;
  // Task 35-C: workers use process + log-freshness logic (not port-based).
  // Daemons + crons: existing logic (port-reachability via service.status).
  let status: 'running' | 'stopped' | 'slow' | 'scheduled';
  if (entry.type === 'worker') {
    const processRunning = controlInfo?.running === true || service?.status === 'online';
    if (processRunning) {
      status = 'running';
    } else {
      // Check log freshness across all log files for this engine.
      const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
      const hasRecentLog = logs.some(f => f.mtime && new Date(f.mtime).getTime() > thirtyMinAgo);
      status = hasRecentLog ? 'scheduled' : 'stopped';
    }
  } else {
    const isRunning = controlInfo ? controlInfo.running : service ? service.status === 'online' : false;
    status = isRunning
      ? (service?.status === 'degraded' ? 'slow' : 'running')
      : 'stopped';
  }
  const tone = statusTone(status);
  // Detail buttons use "running" as the lock-state (don't allow start if already running).
  const isRunning = status === 'running';

  return (
    <Sheet open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', tone.bg)}>
              {entry.icon}
            </div>
            <div>
              <SheetTitle className="text-lg">{entry.name_ar}</SheetTitle>
              <SheetDescription dir="ltr" className="text-xs">{entry.name_en} · port {entry.port ?? 'cron'}</SheetDescription>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className={tone.badge}>
              <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
              {tone.label}
            </Badge>
            {service?.latency_ms !== undefined && (
              <Badge variant="outline" className="text-xs" dir="ltr">
                {service.latency_ms}ms
              </Badge>
            )}
            {controlInfo?.pids && controlInfo.pids.length > 0 && (
              <Badge variant="outline" className="text-xs">PID: {controlInfo.pids.slice(0, 3).join(', ')}</Badge>
            )}
          </div>
        </SheetHeader>

        <div className="px-4 space-y-4">
          {/* Service details */}
          {service && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="text-xs font-bold text-muted-foreground">حالة الخدمة</div>
              <div className="text-sm">{service.message}</div>
              {service.details && Object.keys(service.details).length > 0 && (
                <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto" dir="ltr">
                  {JSON.stringify(service.details, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Action buttons */}
          {entry.controlKey && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1 border-profit text-profit hover:bg-profit"
                disabled={actionLoading || isRunning}
                onClick={() => onAction('start')}
              >
                <Play className="w-3 h-3" /> تشغيل
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 border-loss text-loss hover:bg-loss"
                disabled={actionLoading || !isRunning}
                onClick={() => onAction('stop')}
              >
                <Square className="w-3 h-3" /> إيقاف
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 border-warning text-warning hover:bg-warning"
                disabled={actionLoading}
                onClick={() => onAction('restart')}
              >
                <RotateCcw className="w-3 h-3" /> إعادة تشغيل
              </Button>
            </div>
          )}

          {/* Logs */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-muted-foreground flex items-center gap-2">
              <FileText className="w-3 h-3" /> السجلات الكاملة
            </div>
            {logs.length === 0 || logs.every(f => !f.exists) ? (
              <div className="text-xs text-muted-foreground italic p-3 border border-dashed rounded-md">
                لا توجد ملفات سجلات موجودة لهذا المحرك.
              </div>
            ) : (
              logs.map((f, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <code className="text-muted-foreground" dir="ltr">{f.path}</code>
                    <span className="text-muted-foreground">
                      {f.exists ? (f.mtime ? timeAgoBrief(f.mtime) : 'موجود') : 'غير موجود'}
                    </span>
                  </div>
                  {f.exists && f.lines.length > 0 && (
                    <div className="rounded-md bg-slate-950 text-slate-200 p-2 font-mono text-xs leading-relaxed max-h-48 overflow-y-auto" dir="ltr">
                      {f.lines.map((line, j) => (
                        <div
                          key={j}
                          className={cn(
                            looksLikeError(line) ? 'text-loss' : 'text-muted-foreground',
                            'whitespace-pre-wrap break-all',
                          )}
                        >
                          {line || ' '}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
