/**
 * engine-control/LiveLogConsole.tsx
 * =================================
 * Live Log Console — Task 33 Phase 5.
 *
 * A bottom Sheet that opens when the user clicks "تشغيل" (daemon) or
 * "تشغيل يدوي" (cron). It polls:
 * - /api/admin/engines/logs?engine=X&limit=50 every 2s → appends new lines
 * - /api/admin/engines/logs/control?engine=X every 2s → checks process state
 *
 * When the process exits (running: false), it shows ✅/❌ based on the last
 * 10 log lines (traceback/error → ❌, otherwise ✅).
 *
 * Features:
 * - Dark terminal-style bg + monospace font + LTR (logs are English/paths).
 * - Auto-scroll to bottom on new lines (with manual scroll-up override).
 * - Clear button (resets state without closing).
 * - Close button.
 * - Auto-refresh toggle (default ON).
 * - "Re-run" button to trigger the action again.
 */
'use client';

import React, { useState, useEffect } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, RefreshCw, Filter, Zap, Terminal, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  LiveLogConsoleProps,
} from './types';
import type {
  SingleEngineLogsResponse,
  LiveEngineStatusResponse,
} from '@/hooks/useEngineControlRoomData';
import {
  timeAgoBrief,
  severityOf,
  LIVE_LOG_POLL_MS,
  LIVE_LOG_MAX_LINES,
} from './helpers';

export function LiveLogConsole({ engineControlKey, entry, actionInProgress, onClose, onRerun }: LiveLogConsoleProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [fileExists, setFileExists] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveEngineStatusResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [processExited, setProcessExited] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const userScrolledRef = React.useRef(false);
  // Ref mirror of liveStatus so the polling closure can read the latest value
  // without re-creating the interval on every status change.
  const liveStatusRef = React.useRef<LiveEngineStatusResponse | null>(null);
  useEffect(() => { liveStatusRef.current = liveStatus; }, [liveStatus]);

  // ----- Pollers (logs + status) every 2s while autoRefresh is on -----
  useEffect(() => {
    if (!autoRefresh) return;
    let cancelled = false;

    const pollOnce = async () => {
      try {
        const [logsRes, statusRes] = await Promise.all([
          fetch(`/api/admin/engines/logs?engine=${encodeURIComponent(engineControlKey)}&limit=50`, {
            credentials: 'same-origin', cache: 'no-store',
          }),
          fetch(`/api/admin/engines/logs/control?engine=${encodeURIComponent(engineControlKey)}`, {
            credentials: 'same-origin', cache: 'no-store',
          }),
        ]);
        const logsJson: SingleEngineLogsResponse = await logsRes.json();
        const statusJson: LiveEngineStatusResponse = await statusRes.json();

        if (cancelled) return;

        if (logsJson.success) {
          setLines(prev => {
            // The API returns the tail of `limit` lines. While a process is
            // running, new lines appear at the end → we append only the lines
            // after the last one we already have (best-effort dedupe).
            const newLines = logsJson.lines.slice(-LIVE_LOG_MAX_LINES);
            if (prev.length === 0) return newLines;
            const lastLine = prev[prev.length - 1];
            const idx = newLines.indexOf(lastLine);
            if (idx >= 0 && idx < newLines.length - 1) {
              return [...prev, ...newLines.slice(idx + 1)].slice(-LIVE_LOG_MAX_LINES);
            }
            // Fallback: if last line not found (log rotated?), just replace.
            return newLines;
          });
          setLastFetchedAt(logsJson.fetched_at);
          setFileExists(logsJson.file_exists);
          setFetchError(null);
        } else {
          setFetchError(logsJson.error || 'فشل تحميل السجلات');
        }

        if (statusJson.success) {
          const wasRunning = liveStatusRef.current?.running === true;
          const isRunningNow = statusJson.running;
          setLiveStatus(statusJson);
          // Detect process exit: was running before, now not running.
          // Only flip if we actually saw it running at least once — otherwise
          // we'd mark "exited" on the very first poll before the action even
          // started.
          if (wasRunning && !isRunningNow) {
            setProcessExited(true);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'network error');
        }
      }
    };

    pollOnce();
    const interval = setInterval(pollOnce, LIVE_LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [autoRefresh, engineControlKey]);

  // ----- Auto-scroll on new lines (unless the user scrolled up manually) -----
  useEffect(() => {
    if (!autoScroll) return;
    if (userScrolledRef.current) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    userScrolledRef.current = !atBottom;
    setAutoScroll(atBottom);
  };

  const handleClear = () => {
    setLines([]);
    setProcessExited(false);
    userScrolledRef.current = false;
    setAutoScroll(true);
  };

  // Determine success/failure based on last 10 lines after process exits.
  const lastTenLines = lines.slice(-10);
  const hasErrorTail = lastTenLines.some(l => /\b(traceback|exception|critical|error:|fatal)\b/i.test(l));
  const exitedSuccessfully = processExited && !hasErrorTail;

  const isCron = entry.type === 'cron';
  const isRunning = liveStatus?.running ?? actionInProgress;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[80vh] sm:h-[70vh] p-0 flex flex-col gap-0">
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b bg-slate-900 text-slate-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                {entry.icon}
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-sm text-slate-100 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-profit" />
                  كونسول حي — {entry.name_ar}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground" dir="ltr">
                  {entry.name_en} · engine={engineControlKey}
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Status pill */}
              <Badge
                variant="outline"
                className={cn(
                  'text-xs shrink-0',
                  isRunning
                    ? 'border-warning text-warning bg-warning/10'
                    : processExited
                    ? exitedSuccessfully
                      ? 'border-profit text-profit bg-profit/10'
                      : 'border-loss text-loss bg-loss/10'
                    : 'border-slate-500 text-muted-foreground bg-slate-800/50',
                )}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-3 h-3 ml-1 animate-spin" />
                    جاري التنفيذ...
                  </>
                ) : processExited ? (
                  exitedSuccessfully ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 ml-1" />
                      اكتمل التشغيل
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 ml-1" />
                      فشل التشغيل
                    </>
                  )
                ) : (
                  <>
                    <Clock className="w-3 h-3 ml-1" />
                    بانتظار السجل
                  </>
                )}
              </Badge>
              {liveStatus?.pids && liveStatus.pids.length > 0 && (
                <Badge variant="outline" className="text-xs shrink-0 border-slate-500 text-muted-foreground bg-slate-800/50">
                  PID: {liveStatus.pids.slice(0, 3).join(', ')}
                </Badge>
              )}
            </div>
          </div>
          {/* Toolbar */}
          <div className="flex items-center gap-2 mt-2 text-xs">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md border',
                autoRefresh
                  ? 'border-profit text-profit bg-profit/10'
                  : 'border-slate-500 text-muted-foreground bg-slate-800/50',
              )}
            >
              <RefreshCw className={cn('w-3 h-3', autoRefresh && 'animate-spin')} />
              {autoRefresh ? 'تحديث تلقائي (2s)' : 'متوقف'}
            </button>
            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-500 text-muted-foreground bg-slate-800/50 hover:bg-slate-700/50"
            >
              <Filter className="w-3 h-3" />
              مسح
            </button>
            {onRerun && (
              <button
                onClick={onRerun}
                disabled={isRunning}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-warning text-warning bg-warning/10 hover:bg-warning/10 disabled:opacity-50"
              >
                <Zap className="w-3 h-3" />
                {isCron ? 'إعادة التشغيل اليدوي' : 'إعادة المحاولة'}
              </button>
            )}
            <div className="flex-1" />
            <span className="text-muted-foreground">
              {lines.length} سطر · آخر fetch: {lastFetchedAt ? timeAgoBrief(lastFetchedAt) : '—'}
            </span>
          </div>
        </SheetHeader>

        {/* Terminal body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed p-3"
          dir="ltr"
        >
          {lines.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              {fetchError ? (
                <span className="text-loss">⚠ {fetchError}</span>
              ) : fileExists ? (
                'الملف موجود لكنه فارغ — بانتظار أول سطر...'
              ) : actionInProgress ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  جاري إرسال أمر التشغيل...
                </span>
              ) : (
                'لا يوجد ملف سجل بعد — اضغط "إعادة التشغيل" لبدء محرك جديد'
              )}
            </div>
          ) : (
            lines.map((line, i) => {
              const sev = severityOf(line);
              const color = sev === 'error' ? 'text-loss'
                : sev === 'warning' ? 'text-warning'
                : 'text-muted-foreground';
              return (
                <div key={i} className={cn('whitespace-pre-wrap break-all', color)}>
                  <span className="text-muted-foreground select-none">{String(i + 1).padStart(4, ' ')}│ </span>
                  {line || ' '}
                </div>
              );
            })
          )}
          {processExited && lines.length > 0 && (
            <div className={cn(
              'mt-2 p-2 rounded border text-xs',
              exitedSuccessfully
                ? 'border-profit bg-profit/10 text-profit'
                : 'border-loss bg-loss/10 text-loss',
            )}>
              {exitedSuccessfully
                ? '✅ اكتمل التشغيل — انتهت العملية بنجاح'
                : '❌ فشل التشغيل — انتهت العملية بخطأ. راجع آخر 10 أسطر بالأعلى.'}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
