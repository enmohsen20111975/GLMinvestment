'use client';

/**
 * GenericLiveLogConsole — كونسول سجلات حيّ قابل لإعادة الاستخدام
 * =====================================================================
 *
 * نسخة عامة من engine-control/LiveLogConsole، تدعم أي مصدر سجلات:
 * - يـ polling الـ logsUrl كل ثانيتين
 * - يـ polling الـ statusUrl كل ثانيتين (اختياري)
 * - يعرض الأسطر بتنسيق terminal (داكن، monospace، LTR)
 * - auto-scroll مع manual override
 * - status pill (running/exited success/exited failure)
 * - أزرار: تحديث تلقائي / مسح / إعادة تشغيل / نسخ / تحميل
 * - دعم structured JSON-lines (phase, level, pct, archive, db)
 *
 * الاستخدام:
 *   <GenericLiveLogConsole
 *     title="كونسول رفع قواعد البيانات"
 *     logsUrl="/api/admin/db-backup/logs?job=abc123"
 *     statusUrl="/api/admin/db-backup/status?job=abc123"
 *     onClose={() => setConsoleOpen(false)}
 *     onRerun={handleRerun}
 *     parseStructuredLine={(raw) => JSON.parse(raw)}  // اختياري
 *   />
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2, RefreshCw, Eraser, Zap, Terminal, CheckCircle2, XCircle,
  Clock, Copy, Download, Pause, Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const POLL_MS = 2000;
const MAX_LINES = 500;

export interface LogLine {
  raw: string;
  ts?: string;
  phase?: string;
  level?: 'info' | 'warning' | 'error' | 'success';
  message?: string;
  pct?: number;
  archive?: string;
  db?: string;
}

export interface LiveStatus {
  running: boolean;
  phase?: string;
  pct?: number;
  started_at?: string;
  finished_at?: string;
  archives_created?: string[];
  archives_pushed?: string[];
  errors?: string[];
  warnings?: string[];
  pids?: number[];
  exit_code?: number | null;
}

export interface GenericLiveLogConsoleProps {
  title: string;
  description?: string;
  logsUrl: string;
  statusUrl?: string;
  onClose: () => void;
  onRerun?: () => void;
  onAbort?: () => void;
  /** Optional parser to convert raw log lines → structured */
  parseStructuredLine?: (raw: string) => LogLine | null;
  /** Initial action-in-progress state (before first poll) */
  actionInProgress?: boolean;
  /** Side of the Sheet ('bottom' default, 'right' for sidebar style) */
  side?: 'bottom' | 'right';
  /** Height when side='bottom' */
  height?: string;
}

export function GenericLiveLogConsole({
  title,
  description,
  logsUrl,
  statusUrl,
  onClose,
  onRerun,
  onAbort,
  parseStructuredLine,
  actionInProgress = false,
  side = 'bottom',
  height = '75vh',
}: GenericLiveLogConsoleProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [fileExists, setFileExists] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [processExited, setProcessExited] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const liveStatusRef = useRef<LiveStatus | null>(null);
  useEffect(() => { liveStatusRef.current = liveStatus; }, [liveStatus]);

  // ─── Poller (logs + status) ──────────────────────────────────────────────
  useEffect(() => {
    if (!autoRefresh) return;
    let cancelled = false;

    const pollOnce = async () => {
      try {
        const fetches: Promise<Response>[] = [
          fetch(logsUrl, { credentials: 'same-origin', cache: 'no-store' }),
        ];
        if (statusUrl) {
          fetches.push(fetch(statusUrl, { credentials: 'same-origin', cache: 'no-store' }));
        }
        const responses = await Promise.all(fetches);
        const logsRes = responses[0];
        const statusRes = responses[1];

        if (cancelled) return;

        const logsJson = await logsRes.json();
        if (logsJson.success) {
          setLines(prev => {
            const rawLines: string[] = logsJson.lines || [];
            const structured: LogLine[] = rawLines.slice(-MAX_LINES).map((raw: string) => {
              if (parseStructuredLine) {
                return parseStructuredLine(raw) || { raw };
              }
              return { raw };
            });
            if (prev.length === 0) return structured;
            const lastRaw = prev[prev.length - 1]?.raw;
            const idx = structured.findIndex(l => l.raw === lastRaw);
            if (idx >= 0 && idx < structured.length - 1) {
              return [...prev, ...structured.slice(idx + 1)].slice(-MAX_LINES);
            }
            return structured;
          });
          setLastFetchedAt(logsJson.fetched_at);
          setFileExists(logsJson.file_exists ?? true);
          setFetchError(null);
        } else {
          setFetchError(logsJson.error || 'فشل تحميل السجلات');
        }

        if (statusRes && statusUrl) {
          const statusJson: LiveStatus = await statusRes.json();
          if (cancelled) return;
          if (statusJson) {
            const wasRunning = liveStatusRef.current?.running === true;
            const isRunningNow = !!statusJson.running;
            setLiveStatus(statusJson);
            if (wasRunning && !isRunningNow) {
              setProcessExited(true);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'network error');
        }
      }
    };

    pollOnce();
    const interval = setInterval(pollOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [autoRefresh, logsUrl, statusUrl, parseStructuredLine]);

  // ─── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoScroll || userScrolledRef.current) return;
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

  const handleCopy = useCallback(() => {
    const text = lines.map(l => l.raw).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`تم نسخ ${lines.length} سطر`);
    }).catch(() => {
      toast.error('فشل النسخ');
    });
  }, [lines]);

  const handleDownload = useCallback(() => {
    const text = lines.map(l => l.raw).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [lines]);

  // ─── Detect success/failure from last 10 lines ────────────────────────────
  const lastTenLines = lines.slice(-10);
  const hasErrorTail = lastTenLines.some(l =>
    /\b(traceback|exception|critical|error:|fatal|failed)\b/i.test(l.raw)
  );
  const exitedSuccessfully = processExited &&
    !hasErrorTail &&
    (liveStatus?.exit_code === 0 || liveStatus?.exit_code === null || liveStatus?.exit_code === undefined);

  const isRunning = liveStatus?.running ?? actionInProgress;

  // ─── Phase progress (computed from structured lines) ─────────────────────
  const phaseOrder = ['init', 'compress', 'split', 'commit', 'fetch', 'rebase', 'merge', 'push', 'done'];
  const currentPhase = liveStatus?.phase ||
    lines.filter(l => l.phase).slice(-1)[0]?.phase ||
    'init';
  const phaseIdx = Math.max(0, phaseOrder.indexOf(currentPhase));
  const overallPct = liveStatus?.pct ??
    (phaseIdx > 0 ? Math.round((phaseIdx / (phaseOrder.length - 1)) * 100) : 0);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={side} className={cn(
        'p-0 flex flex-col gap-0',
        side === 'bottom' && '',
      )} style={side === 'bottom' ? { height } : undefined}>
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b bg-slate-900 text-slate-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                <Terminal className="w-4 h-4 text-profit" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-sm text-slate-100 flex items-center gap-2">
                  {title}
                </SheetTitle>
                {description && (
                  <SheetDescription className="text-xs text-muted-foreground" dir="ltr">
                    {description}
                  </SheetDescription>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                      اكتمل بنجاح
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 ml-1" />
                      فشل التنفيذ
                    </>
                  )
                ) : (
                  <>
                    <Clock className="w-3 h-3 ml-1" />
                    بانتظار البدء
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

          {/* Progress bar */}
          {isRunning && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                <span>التقدّم: {overallPct}%</span>
                <span className="text-muted-foreground">{currentPhase}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-l from-profit to-info transition-all duration-500 ease-out"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
              {phaseOrder.length > 0 && (
                <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                  {phaseOrder.map((p, i) => (
                    <span
                      key={p}
                      className={cn(
                        'transition-colors',
                        i < phaseIdx ? 'text-profit' :
                        i === phaseIdx ? 'text-warning font-bold' :
                        'text-slate-600'
                      )}
                    >
                      {i > 0 && ' → '}
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md border',
                autoRefresh
                  ? 'border-profit text-profit bg-profit/10'
                  : 'border-slate-500 text-muted-foreground bg-slate-800/50',
              )}
            >
              {autoRefresh ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {autoRefresh ? 'إيقاف التحديث' : 'استئناف'}
            </button>
            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-500 text-muted-foreground bg-slate-800/50 hover:bg-slate-700/50"
            >
              <Eraser className="w-3 h-3" />
              مسح
            </button>
            <button
              onClick={handleCopy}
              disabled={lines.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-500 text-muted-foreground bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-30"
            >
              <Copy className="w-3 h-3" />
              نسخ
            </button>
            <button
              onClick={handleDownload}
              disabled={lines.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-500 text-muted-foreground bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-30"
            >
              <Download className="w-3 h-3" />
              تحميل
            </button>
            {onAbort && isRunning && (
              <button
                onClick={onAbort}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-loss text-loss bg-loss/10 hover:bg-loss/20"
              >
                <XCircle className="w-3 h-3" />
                إيقاف
              </button>
            )}
            {onRerun && !isRunning && (
              <button
                onClick={onRerun}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-warning text-warning bg-warning/10 hover:bg-warning/10"
              >
                <Zap className="w-3 h-3" />
                إعادة التشغيل
              </button>
            )}
            <div className="flex-1" />
            <span className="text-muted-foreground">
              {lines.length} سطر · آخر fetch: {lastFetchedAt ? new Date(lastFetchedAt).toLocaleTimeString('ar-EG') : '—'}
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
                'لا يوجد ملف سجل بعد — اضغط "إعادة التشغيل" لبدء عملية جديدة'
              )}
            </div>
          ) : (
            lines.map((line, i) => {
              const sev = line.level || severityOf(line.raw);
              const color = sev === 'error' ? 'text-loss'
                : sev === 'warning' ? 'text-warning'
                : sev === 'success' ? 'text-profit'
                : 'text-slate-200';
              return (
                <div key={i} className={cn('whitespace-pre-wrap break-all', color)}>
                  <span className="text-muted-foreground select-none">
                    {String(i + 1).padStart(4, ' ')}│{' '}
                  </span>
                  {line.ts && (
                    <span className="text-slate-500">[{line.ts}] </span>
                  )}
                  {line.phase && (
                    <span className="text-info">[{line.phase}] </span>
                  )}
                  {line.message || line.raw}
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
                ? '✅ اكتملت العملية بنجاح'
                : '❌ فشلت العملية — راجع آخر 10 أسطر بالأعلى.'}
            </div>
          )}

          {/* Errors and warnings summary (full — not truncated) */}
          {liveStatus && (liveStatus.errors?.length || liveStatus.warnings?.length) && (
            <div className="mt-3 space-y-2">
              {liveStatus.errors && liveStatus.errors.length > 0 && (
                <div className="border border-loss/30 bg-loss/5 rounded p-2">
                  <div className="text-loss font-bold text-xs mb-1">
                    ❌ أخطاء ({liveStatus.errors.length})
                  </div>
                  <ul className="text-loss/80 text-xs space-y-1 list-disc list-inside">
                    {liveStatus.errors.map((e, i) => (
                      <li key={i} className="break-all">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {liveStatus.warnings && liveStatus.warnings.length > 0 && (
                <div className="border border-warning/30 bg-warning/5 rounded p-2">
                  <div className="text-warning font-bold text-xs mb-1">
                    ⚠ تحذيرات ({liveStatus.warnings.length})
                  </div>
                  <ul className="text-warning/80 text-xs space-y-1 list-disc list-inside">
                    {liveStatus.warnings.map((w, i) => (
                      <li key={i} className="break-all">{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Archives checklist */}
          {liveStatus && (liveStatus.archives_created?.length || liveStatus.archives_pushed?.length) && (
            <div className="mt-3 border border-slate-700 bg-slate-900/50 rounded p-2">
              <div className="text-slate-300 font-bold text-xs mb-1">📦 الأرشيفات</div>
              <ul className="text-xs space-y-1">
                {(liveStatus.archives_created || []).map((arch, i) => {
                  const pushed = liveStatus.archives_pushed?.includes(arch);
                  return (
                    <li key={i} className="flex items-center gap-2">
                      <span className={pushed ? 'text-profit' : 'text-warning'}>
                        {pushed ? '✅' : '⏳'}
                      </span>
                      <span className="text-slate-200 font-mono">{arch}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {pushed ? '(تم الرفع)' : '(في الانتظار)'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function severityOf(line: string): 'error' | 'warning' | 'success' | 'info' {
  const lower = line.toLowerCase();
  if (/\b(traceback|exception|critical|error:|fatal|failed)\b/i.test(lower)) return 'error';
  if (/\b(warn|warning|deprecat)\b/i.test(lower)) return 'warning';
  if (/\b(success|completed|done|pushed|finished)\b/i.test(lower)) return 'success';
  return 'info';
}
