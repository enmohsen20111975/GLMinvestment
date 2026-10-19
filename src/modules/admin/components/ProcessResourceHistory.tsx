'use client';

/**
 * ProcessResourceHistory
 * =======================
 * Dialog يعرض السجل التاريخي لمورد Process معين (CPU + Memory).
 *
 * يستدعي: GET /api/admin/system-resources/process-history?name=${processName}&range=${range}
 *
 * - مخطط CPU LineChart (مع علامات إعادة التشغيل عند كل restart)
 * - مخطط Memory LineChart (MB)
 * - اختيار النطاق الزمني (1h / 6h / 24h)
 * - Skeleton + Error state
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceDot,
} from 'recharts';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Cpu, MemoryStick, RefreshCw, AlertTriangle, RotateCcw, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type RangeKey = '1h' | '6h' | '24h';

interface ProcessPoint {
  ts: string;
  cpu?: number | null;
  memory_mb?: number | null;
  restarts?: number | null;
  status?: string | null;
}

interface ProcessHistoryResponse {
  name: string;
  range: string;
  points: ProcessPoint[];
  count?: number;
  error?: string;
}

interface ProcessResourceHistoryProps {
  processName: string;
  open: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '1h', label: '1 ساعة' },
  { key: '6h', label: '6 ساعات' },
  { key: '24h', label: '24 ساعة' },
];

const COLORS = {
  cpu: '#3b82f6',
  mem: '#10b981',
  restart: '#ef4444',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatTs(ts: string, range: RangeKey): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    if (range === '24h') {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${mm}/${dd} ${hh}:${mi}`;
    }
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
  } catch {
    return ts;
  }
}

function CpuTooltip({ active, payload, label, range }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      dir="rtl"
      className="rounded-lg border border-border/60 bg-popover/95 px-3 py-2 text-xs shadow-md"
    >
      <div className="mb-1.5 font-mono text-[10px] text-muted-foreground">
        {label ? formatTs(label, range as RangeKey) : ''}
      </div>
      <div className="space-y-1">
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px]">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono font-semibold text-foreground">
              {typeof p.value === 'number' ? (p.value ?? 0).toFixed(2) : '—'}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemTooltip({ active, payload, label, range }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      dir="rtl"
      className="rounded-lg border border-border/60 bg-popover/95 px-3 py-2 text-xs shadow-md"
    >
      <div className="mb-1.5 font-mono text-[10px] text-muted-foreground">
        {label ? formatTs(label, range as RangeKey) : ''}
      </div>
      <div className="space-y-1">
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px]">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono font-semibold text-foreground">
              {typeof p.value === 'number' ? (p.value ?? 0).toFixed(1) : '—'} MB
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function ProcessResourceHistory({
  processName,
  open,
  onClose,
}: ProcessResourceHistoryProps) {
  const [range, setRange] = useState<RangeKey>('1h');
  const [data, setData] = useState<ProcessHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (name: string, selectedRange: RangeKey) => {
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/system-resources/process-history?name=${encodeURIComponent(name)}&range=${selectedRange}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
      }
      const json: ProcessHistoryResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'خطأ في جلب بيانات العملية');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch when opening or changing range/processName
  useEffect(() => {
    if (open && processName) {
      fetchData(processName, range);
    } else if (!open) {
      // reset on close
      setData(null);
      setError(null);
    }
  }, [open, processName, range, fetchData]);

  const points = data?.points || [];

  const chartData = useMemo(() => points.map((p) => {
    const cpu = p.cpu != null ? Number(p.cpu) : null;
    const mem = p.memory_mb != null ? Number(p.memory_mb) : null;
    const restarts = p.restarts != null ? Number(p.restarts) : 0;
    return {
      ts: p.ts,
      time: formatTs(p.ts, range),
      cpu,
      mem,
      restarts,
      status: p.status,
    };
  }), [points, range]);

  // Find restart events (where restarts value increases vs previous sample, or value > 0 and ts)
  // Strategy: mark a point where restarts > previous restarts (i.e., a restart happened since previous sample)
  const restartEvents = useMemo(() => {
    const events: Array<{ time: string; cpu: number | null; mem: number | null }> = [];
    let prev = -1;
    for (const p of chartData) {
      if (p.restarts != null) {
        if (prev >= 0 && p.restarts > prev) {
          events.push({ time: p.time, cpu: p.cpu, mem: p.mem });
        }
        prev = p.restarts;
      }
    }
    return events;
  }, [chartData]);

  const maxCpu = chartData.reduce((m, p) => Math.max(m, p.cpu ?? 0), 0);
  const maxMem = chartData.reduce((m, p) => Math.max(m, p.mem ?? 0), 0);
  const avgCpu = chartData.length > 0
    ? chartData.reduce((s, p) => s + (p.cpu ?? 0), 0) / chartData.length
    : 0;
  const avgMem = chartData.length > 0
    ? chartData.reduce((s, p) => s + (p.mem ?? 0), 0) / chartData.length
    : 0;
  const totalRestarts = chartData.length > 0
    ? Math.max(...chartData.map(p => p.restarts ?? 0), 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4 text-cyan-500" />
            السجل التاريخي للعملية:{' '}
            <span className="font-mono text-cyan-600 dark:text-cyan-400">
              {processName}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            تتبّع استهلاك CPU والذاكرة وإعادة التشغيل عبر النطاق الزمني المختار.
          </DialogDescription>
        </DialogHeader>

        {/* Range selector + refresh */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setRange(opt.key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[32px] border',
                  range === opt.key
                    ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/40'
                    : 'text-muted-foreground hover:text-foreground border-border/60 hover:bg-muted/40',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(processName, range)}
            disabled={loading || !processName}
            className="gap-1.5 text-xs h-8"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>

        {/* Summary stats */}
        {!loading && !error && chartData.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatBox label="نقاط البيانات" value={String(chartData.length)} color="text-foreground" />
            <StatBox label="أعلى CPU" value={`${(maxCpu ?? 0).toFixed(1)}%`} color="text-primary dark:text-primary" />
            <StatBox label="أعلى ذاكرة" value={`${(maxMem ?? 0).toFixed(0)} MB`} color="text-profit dark:text-profit" />
            <StatBox label="إجمالي Restarts" value={`${totalRestarts}`} color="text-loss dark:text-loss" />
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-[200px] w-full rounded-lg" />
            <Skeleton className="h-[200px] w-full rounded-lg" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-loss/30 bg-loss/5 p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-loss mx-auto mb-2" />
            <div className="text-xs text-muted-foreground mb-3">{error}</div>
            <Button
              size="sm" variant="outline"
              onClick={() => fetchData(processName, range)}
              className="gap-1.5 text-xs h-8"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </div>
        ) : chartData.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-muted/20 p-8 text-center text-xs text-muted-foreground">
            لا توجد بيانات تاريخية متاحة لهذه العملية في النطاق المختار.
            <div className="mt-1 text-[10px]">
              (يتم تسجيل بيانات الـ Process كل 15 ثانية في جدول pm2_process_snapshot)
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* CPU chart */}
            <div className="rounded-lg border border-border/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Cpu className="w-3.5 h-3.5" style={{ color: COLORS.cpu }} />
                  استهلاك CPU عبر الزمن
                </span>
                <Badge variant="outline" className="text-[10px] h-5 font-mono">
                  متوسط: {(avgCpu ?? 0).toFixed(1)}%
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="procCpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.cpu} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={COLORS.cpu} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                  <XAxis dataKey="time" stroke="#888" fontSize={10}
                    interval="preserveStartEnd" minTickGap={20} />
                  <YAxis stroke="#888" fontSize={10}
                    tickFormatter={(v) => `${v}%`}
                    domain={[0, 'auto']} />
                  <Tooltip content={<CpuTooltip range={range} />} />
                  <Area type="monotone" name="CPU" dataKey="cpu"
                    stroke={COLORS.cpu} strokeWidth={2}
                    fill="url(#procCpuGrad)" connectNulls
                    isAnimationActive={false} />
                  {/* Restart event markers */}
                  {restartEvents.map((ev, i) => (
                    <ReferenceDot
                      key={`r-${i}`}
                      x={ev.time}
                      y={(ev.cpu ?? 0)}
                      r={5}
                      fill={COLORS.restart}
                      stroke="#fff"
                      strokeWidth={1.5}
                      isFront
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
              {restartEvents.length > 0 && (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-loss">
                  <RotateCcw className="w-3 h-3" />
                  {restartEvents.length} حدث إعادة تشغيل خلال هذه الفترة
                </div>
              )}
            </div>

            {/* Memory chart */}
            <div className="rounded-lg border border-border/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <MemoryStick className="w-3.5 h-3.5" style={{ color: COLORS.mem }} />
                  استهلاك الذاكرة (RAM) عبر الزمن
                </span>
                <Badge variant="outline" className="text-[10px] h-5 font-mono">
                  متوسط: {(avgMem ?? 0).toFixed(0)} MB
                </Badge>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="procMemGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.mem} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={COLORS.mem} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                  <XAxis dataKey="time" stroke="#888" fontSize={10}
                    interval="preserveStartEnd" minTickGap={20} />
                  <YAxis stroke="#888" fontSize={10}
                    tickFormatter={(v) => `${v} MB`}
                    domain={[0, 'auto']} />
                  <Tooltip content={<MemTooltip range={range} />} />
                  <Area type="monotone" name="Memory" dataKey="mem"
                    stroke={COLORS.mem} strokeWidth={2}
                    fill="url(#procMemGrad)" connectNulls
                    isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground border-t border-border/40 pt-2 mt-2">
          💡 يتم تسجيل بيانات الـ Process كل 15 ثانية. النطاقات الأطول قد لا تحتوي على بيانات كافية.
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Subcomponents                                                     */
/* ------------------------------------------------------------------ */

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-bold font-mono mt-0.5', color)}>{value}</div>
    </div>
  );
}

export default ProcessResourceHistory;
