/**
 * engine-control/EngineCard.tsx
 * ============================
 * Engine Card — the top-grid card shown for each of the 8 engines.
 *
 * Task 33: now branches on `entry.type`:
 * - daemon → renders start/stop/restart + port-based status pill
 * - cron → renders run-now + last_run + next_run + "🟢 مجدول" pill
 * - worker → renders start/stop/restart/logs + pgrep-based status pill
 *
 * Click the card → opens DetailSheet. Action buttons stopPropagation.
 */
'use client';

import React from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Play, Square, RotateCcw, AlertTriangle, Loader2, Zap, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EngineCardProps } from './types';
import { statusTone, cronTone, looksLikeError, timeAgoBrief } from './helpers';

export function EngineCard({ entry, service, controlInfo, logs, logsMtime, cronInfo, onClick, onAction, onOpenLiveConsole, actionLoading }: EngineCardProps) {
  // ----- Cron branch — totally different layout -----
  if (entry.type === 'cron') {
    const running = cronInfo?.running ?? false;
    const tone = cronTone(running);
    const errorsCount = logs.filter(looksLikeError).length;
    return (
      <Card
        className={cn('relative overflow-hidden border cursor-pointer transition-shadow hover:shadow-md', tone.bg)}
        onClick={onClick}
      >
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', tone.bg)}>
                {entry.icon}
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm truncate">{entry.name_ar}</CardTitle>
                <CardDescription className="text-xs truncate" dir="ltr">{entry.name_en}</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
              <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
              {tone.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3 space-y-2">
          {/* Stats row — schedule + last_run + next_run */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md bg-background/60 p-1.5">
              <div className="text-muted-foreground">الجدولة</div>
              <div className="font-bold truncate" title={entry.cronScheduleAr}>{entry.cronScheduleAr?.split(' ')[0] ?? '—'}</div>
            </div>
            <div className="rounded-md bg-background/60 p-1.5">
              <div className="text-muted-foreground">آخر تشغيل</div>
              <div className="font-bold" title={cronInfo?.last_run ?? ''}>{cronInfo?.last_run_human ?? 'لم يُشغّل'}</div>
            </div>
            <div className="rounded-md bg-background/60 p-1.5">
              <div className="text-muted-foreground">القادم</div>
              <div className="font-bold">{cronInfo?.next_run_label ?? '—'}</div>
            </div>
          </div>

          {/* Errors badge */}
          {errorsCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-loss">
              <AlertTriangle className="w-3 h-3" />
              {errorsCount} خطأ في آخر السجلات
            </div>
          )}

          {/* Live log tail (3 lines) */}
          <div className="rounded-md bg-slate-950/95 text-slate-200 p-2 font-mono text-xs leading-tight h-16 overflow-hidden">
            {logs.length === 0 ? (
              <div className="text-muted-foreground text-center pt-3">لا توجد سجلات</div>
            ) : (
              logs.slice(-3).map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'truncate',
                    looksLikeError(line) ? 'text-loss' : 'text-muted-foreground',
                  )}
                  dir="ltr"
                  title={line}
                >
                  {line || ' '}
                </div>
              ))
            )}
          </div>

          {/* Action buttons — cron engines only get "Run Now" + "Logs" */}
          <div className="flex gap-1 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs gap-1 hover:bg-profit dark:hover:bg-profit/10"
              disabled={actionLoading || running || !entry.controlKey}
              onClick={(e) => { e.stopPropagation(); onAction('start'); }}
            >
              {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              تشغيل يدوي
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs gap-1 hover:bg-warning dark:hover:bg-warning/10"
              onClick={(e) => { e.stopPropagation(); onOpenLiveConsole(); }}
            >
              <Terminal className="w-3 h-3" /> السجلات
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ----- Worker branch (Task 35-C — Rule 67) -----
  // Worker engines (e.g. News Agent) are long-running Python processes that
  // do NOT open a port. Status logic:
  // 1. controlInfo.running (pgrep -f news-agent) OR service.status === 'online'
  //    → "🟢 يعمل" (running)
  // 2. No process but logsMtime within last 30 min
  //    → "🟢 مجدول" (scheduled — it's a periodic worker, just not active now)
  // 3. No process and no recent log → "🔴 متوقف" (stopped)
  if (entry.type === 'worker') {
    const processRunning = controlInfo?.running === true || service?.status === 'online';
    let workerStatus: 'running' | 'scheduled' | 'stopped';
    if (processRunning) {
      workerStatus = 'running';
    } else {
      // Check log freshness — if last log entry is <30 min ago, the worker
      // recently ran (it's a periodic worker, not dead).
      const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
      const logTime = logsMtime ? new Date(logsMtime).getTime() : 0;
      workerStatus = logTime > thirtyMinAgo ? 'scheduled' : 'stopped';
    }
    const tone = statusTone(workerStatus);
    const errorsCount = logs.filter(looksLikeError).length;
    return (
      <Card
        className={cn('relative overflow-hidden border cursor-pointer transition-shadow hover:shadow-md', tone.bg)}
        onClick={onClick}
      >
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', tone.bg)}>
                {entry.icon}
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm truncate">{entry.name_ar}</CardTitle>
                <CardDescription className="text-xs truncate" dir="ltr">{entry.name_en}</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
              <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
              {tone.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3 space-y-2">
          {/* Stats row — worker shows process pattern + last update (no port, no latency) */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md bg-background/60 p-1.5">
              <div className="text-muted-foreground">العملية</div>
              <div className="font-bold truncate" title={entry.workerPattern ?? ''} dir="ltr">{entry.workerPattern ?? '—'}</div>
            </div>
            <div className="rounded-md bg-background/60 p-1.5">
              <div className="text-muted-foreground">PID</div>
              <div className="font-bold" dir="ltr">
                {controlInfo?.pids && controlInfo.pids.length > 0
                  ? controlInfo.pids.slice(0, 2).join(', ')
                  : '—'}
              </div>
            </div>
            <div className="rounded-md bg-background/60 p-1.5">
              <div className="text-muted-foreground">آخر تحديث</div>
              <div className="font-bold">{timeAgoBrief(logsMtime)}</div>
            </div>
          </div>

          {/* Errors badge */}
          {errorsCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-loss">
              <AlertTriangle className="w-3 h-3" />
              {errorsCount} خطأ في آخر السجلات
            </div>
          )}

          {/* Live log tail (3 lines) */}
          <div className="rounded-md bg-slate-950/95 text-slate-200 p-2 font-mono text-xs leading-tight h-16 overflow-hidden">
            {logs.length === 0 ? (
              <div className="text-muted-foreground text-center pt-3">لا توجد سجلات</div>
            ) : (
              logs.slice(-3).map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'truncate',
                    looksLikeError(line) ? 'text-loss' : 'text-muted-foreground',
                  )}
                  dir="ltr"
                  title={line}
                >
                  {line || ' '}
                </div>
              ))
            )}
          </div>

          {/* Action buttons — workers get start / stop / restart / logs (same as daemon) */}
          <div className="flex gap-1 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs gap-1 hover:bg-profit dark:hover:bg-profit/10"
              disabled={actionLoading || processRunning}
              onClick={(e) => { e.stopPropagation(); onAction('start'); }}
            >
              {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              تشغيل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs gap-1 hover:bg-loss dark:hover:bg-loss/10"
              disabled={actionLoading || !processRunning}
              onClick={(e) => { e.stopPropagation(); onAction('stop'); }}
            >
              <Square className="w-3 h-3" /> إيقاف
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs gap-1 hover:bg-warning dark:hover:bg-warning/10"
              disabled={actionLoading || !entry.controlKey}
              onClick={(e) => { e.stopPropagation(); onAction('restart'); }}
            >
              <RotateCcw className="w-3 h-3" /> إعادة
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs gap-1 hover:bg-muted dark:hover:bg-slate-900/30"
              onClick={(e) => { e.stopPropagation(); onOpenLiveConsole(); }}
              title="فتح الكونسول الحي"
            >
              <Terminal className="w-3 h-3" /> السجل
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ----- Daemon branch — original behavior (port-based status) -----
  const isRunning = controlInfo
    ? controlInfo.running
    : service
    ? service.status === 'online'
    : false;
  const status: 'running' | 'stopped' | 'slow' = isRunning
    ? (service?.status === 'degraded' ? 'slow' : 'running')
    : 'stopped';
  const tone = statusTone(status);
  const latency = service?.latency_ms;
  const errorsCount = logs.filter(looksLikeError).length;

  return (
    <Card
      className={cn('relative overflow-hidden border cursor-pointer transition-shadow hover:shadow-md', tone.bg)}
      onClick={onClick}
    >
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', tone.bg)}>
              {entry.icon}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm truncate">{entry.name_ar}</CardTitle>
              <CardDescription className="text-xs truncate" dir="ltr">{entry.name_en}</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
            <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
            {tone.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-3 space-y-2">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md bg-background/60 p-1.5">
            <div className="text-muted-foreground">المنفذ</div>
            <div className="font-bold" dir="ltr">{entry.port ?? 'cron'}</div>
          </div>
          <div className="rounded-md bg-background/60 p-1.5">
            <div className="text-muted-foreground">Latency</div>
            <div className="font-bold" dir="ltr">{latency ? `${latency}ms` : '—'}</div>
          </div>
          <div className="rounded-md bg-background/60 p-1.5">
            <div className="text-muted-foreground">آخر تحديث</div>
            <div className="font-bold">{timeAgoBrief(logsMtime)}</div>
          </div>
        </div>

        {/* Errors badge */}
        {errorsCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-loss">
            <AlertTriangle className="w-3 h-3" />
            {errorsCount} خطأ في آخر السجلات
          </div>
        )}

        {/* Live log tail (3 lines) */}
        <div className="rounded-md bg-slate-950/95 text-slate-200 p-2 font-mono text-xs leading-tight h-16 overflow-hidden">
          {logs.length === 0 ? (
            <div className="text-muted-foreground text-center pt-3">لا توجد سجلات</div>
          ) : (
            logs.slice(-3).map((line, i) => (
              <div
                key={i}
                className={cn(
                  'truncate',
                  looksLikeError(line) ? 'text-loss' : 'text-muted-foreground',
                )}
                dir="ltr"
                title={line}
              >
                {line || ' '}
              </div>
            ))
          )}
        </div>

        {/* Action buttons — daemon engines: start / stop / restart / logs */}
        <div className="flex gap-1 pt-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 text-xs gap-1 hover:bg-profit dark:hover:bg-profit/10"
            disabled={actionLoading || isRunning}
            onClick={(e) => { e.stopPropagation(); onAction('start'); }}
          >
            {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            تشغيل
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 text-xs gap-1 hover:bg-loss dark:hover:bg-loss/10"
            disabled={actionLoading || !isRunning}
            onClick={(e) => { e.stopPropagation(); onAction('stop'); }}
          >
            <Square className="w-3 h-3" /> إيقاف
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 text-xs gap-1 hover:bg-warning dark:hover:bg-warning/10"
            disabled={actionLoading || !entry.controlKey}
            onClick={(e) => { e.stopPropagation(); onAction('restart'); }}
          >
            <RotateCcw className="w-3 h-3" /> إعادة
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 text-xs gap-1 hover:bg-muted dark:hover:bg-slate-900/30"
            onClick={(e) => { e.stopPropagation(); onOpenLiveConsole(); }}
            title="فتح الكونسول الحي"
          >
            <Terminal className="w-3 h-3" /> السجل
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
