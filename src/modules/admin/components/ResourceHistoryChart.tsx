'use client';

/**
 * ResourceHistoryChart
 * ====================
 * رسم بياني لاستهلاك موارد النظام عبر الزمن (CPU / RAM / Disk)
 * + رسم بياني صغير لـ PM2 online count
 * + رسم بياني صغير لـ Network I/O (rx/tx KB/s) — اختياري
 *
 * يستدعي: GET /api/admin/system-resources/history?range=15m|1h|6h|24h|7d|30d
 *
 * - Auto-refresh كل 30 ثانية
 * - زر إعادة المحاولة عند الفشل
 * - Skeleton أثناء التحميل
 * - عرض القيم الحالية مع دائرة حالة ملوّنة (🟢<70 / 🟡 70-85 / 🔴>85)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Cpu, MemoryStick, HardDrive, Activity, RefreshCw, Wifi,
  AlertTriangle, Server, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type RangeKey = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

interface HistoryPoint {
  ts: string;
  cpu?: number | null;
  mem_pct?: number | null;
  disk_pct?: number | null;
  pm2_online?: number | null;
  pm2_total?: number | null;
  load1?: number | null;
  net_rx_kb?: number | null;
  net_tx_kb?: number | null;
}

interface HistorySummary {
  cpu_avg?: number | null;
  cpu_max?: number | null;
  cpu_current?: number | null;
  mem_avg?: number | null;
  mem_max?: number | null;
  mem_current?: number | null;
  disk_current?: number | null;
  pm2_online_current?: number | null;
}

interface HistoryResponse {
  range: string;
  points: HistoryPoint[];
  summary?: HistorySummary;
  error?: string;
}

interface ResourceHistoryChartProps {
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '15m', label: '15 دقيقة' },
  { key: '1h', label: '1 ساعة' },
  { key: '6h', label: '6 ساعات' },
  { key: '24h', label: '24 ساعة' },
  { key: '7d', label: '7 أيام' },
  { key: '30d', label: '30 يوم' },
];

const COLORS = {
  cpu: '#3b82f6',     // blue
  mem: '#10b981',     // emerald
  disk: '#f59e0b',    // amber
  pm2: '#8b5cf6',     // violet
  netRx: '#06b6d4',   // cyan
  netTx: '#ec4899',   // pink
};

const THRESHOLD_WARNING = 70;
const THRESHOLD_CRITICAL = 85;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function statusColor(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return '#6b7280';
  if (pct >= THRESHOLD_CRITICAL) return '#ef4444';
  if (pct >= THRESHOLD_WARNING) return '#f59e0b';
  return '#10b981';
}

function statusEmoji(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return '⚪';
  if (pct >= THRESHOLD_CRITICAL) return '🔴';
  if (pct >= THRESHOLD_WARNING) return '🟡';
  return '🟢';
}

function formatTs(ts: string, range: RangeKey): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    // For 7d/30d: show MM/DD HH:mm
    if (range === '7d' || range === '30d') {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${mm}/${dd} ${hh}:${mi}`;
    }
    // For shorter ranges: HH:mm
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
  } catch { // silent fallback (safe-by-design)
    return ts;
  }
}

function formatTimeAgo(ts: string): string {
  try {
    const d = new Date(ts);
    const diff = Math.max(0, Date.now() - d.getTime());
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `منذ ${sec} ثانية`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `منذ ${min} دقيقة`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `منذ ${hr} ساعة`;
    return `منذ ${Math.floor(hr / 24)} يوم`;
  } catch { // silent fallback (safe-by-design)
    return ts;
  }
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

/* ------------------------------------------------------------------ */
/*  Custom tooltip                                                    */
/* ------------------------------------------------------------------ */

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function ChartTooltip({ active, payload, label, range }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      dir="rtl"
      className="rounded-lg border border-border/60 bg-popover/95 px-3 py-2 text-xs shadow-md"
      style={{ background: 'hsl(var(--popover, 0 0% 100%))' }}
    >
      <div className="mb-1.5 font-mono text-[10px] text-muted-foreground">
        {label ? formatTs(label, range as RangeKey) : ''}
      </div>
      <div className="space-y-1">
        {(payload as TooltipPayloadItem[]).map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: p.color }}
              />
              {p.name}
            </span>
            <span className="font-mono font-semibold text-foreground">
              {typeof p.value === 'number' ? (p.value ?? 0).toFixed(1) : '—'}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NetTooltip({ active, payload, label, range }: any) {
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
        {(payload as TooltipPayloadItem[]).map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: p.color }}
              />
              {p.name}
            </span>
            <span className="font-mono font-semibold text-foreground">
              {typeof p.value === 'number' ? (p.value ?? 0).toFixed(2) : '—'} KB/s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function ResourceHistoryChart({ className }: ResourceHistoryChartProps) {
  const [range, setRange] = useState<RangeKey>('1h');
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [visible, setVisible] = useState<{ cpu: boolean; mem: boolean; disk: boolean }>({
    cpu: true, mem: true, disk: true,
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (selectedRange: RangeKey) => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/system-resources/history?range=${selectedRange}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
      }
      const json: HistoryResponse = await res.json();
      setData(json);
      setLastUpdated(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message || 'خطأ في جلب البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData(range);
  }, [range, fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => fetchData(range), 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, range, fetchData]);

  /* Derived */
  const points = data?.points || [];
  const summary = data?.summary || {};

  const chartData = points.map((p) => ({
    ts: p.ts,
    time: formatTs(p.ts, range),
    cpu: p.cpu != null ? Number(p.cpu) : null,
    mem: p.mem_pct != null ? Number(p.mem_pct) : null,
    disk: p.disk_pct != null ? Number(p.disk_pct) : null,
    pm2_online: p.pm2_online != null ? Number(p.pm2_online) : null,
    pm2_total: p.pm2_total != null ? Number(p.pm2_total) : null,
    net_rx: p.net_rx_kb != null ? Number(p.net_rx_kb) : null,
    net_tx: p.net_tx_kb != null ? Number(p.net_tx_kb) : null,
  }));

  const hasNet = chartData.some((p) => p.net_rx != null || p.net_tx != null);
  const pm2Total = chartData.reduce((m, p) => Math.max(m, p.pm2_total ?? 0), 0) || null;

  const cpuCur = summary.cpu_current ?? null;
  const memCur = summary.mem_current ?? null;
  const diskCur = summary.disk_current ?? null;

  return (
    <Card className={cn('border-border/60 shadow-sm', className)}>
      <CardHeader className="p-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Activity className="w-4 h-4 text-emerald-500" />
              السجل التاريخي لاستهلاك الموارد
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              تتبّع استهلاك CPU / RAM / Disk عبر الزمن، مع تحديث تلقائي كل 30 ثانية.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefresh(v => !v)}
              className="gap-1.5 text-xs h-8"
            >
              <RefreshCw
                className={cn('w-3.5 h-3.5', autoRefresh && 'animate-spin')}
                style={autoRefresh ? { animationDuration: '3s' } : undefined}
              />
              {autoRefresh ? 'تلقائي' : 'متوقف'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(range)}
              className="gap-1.5 text-xs h-8"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              تحديث
            </Button>
          </div>
        </div>

        {/* Range selector */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[32px] border',
                range === opt.key
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                  : 'text-muted-foreground hover:text-foreground border-border/60 hover:bg-muted/40',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2 space-y-4" dir="rtl">
        {/* Current values + Last updated */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3 font-mono">
            <span className="flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" style={{ color: COLORS.cpu }} />
              CPU {fmt(cpuCur)}% {statusEmoji(cpuCur)}
            </span>
            <span className="text-muted-foreground">|</span>
            <span className="flex items-center gap-1">
              <MemoryStick className="w-3.5 h-3.5" style={{ color: COLORS.mem }} />
              RAM {fmt(memCur)}% {statusEmoji(memCur)}
            </span>
            <span className="text-muted-foreground">|</span>
            <span className="flex items-center gap-1">
              <HardDrive className="w-3.5 h-3.5" style={{ color: COLORS.disk }} />
              DISK {fmt(diskCur)}% {statusEmoji(diskCur)}
            </span>
          </div>
          {lastUpdated && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              آخر تحديث: {formatTimeAgo(lastUpdated)}
            </span>
          )}
        </div>

        {/* Toggle buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChip
            label="CPU"
            color={COLORS.cpu}
            active={visible.cpu}
            onClick={() => setVisible(v => ({ ...v, cpu: !v.cpu }))}
          />
          <ToggleChip
            label="RAM"
            color={COLORS.mem}
            active={visible.mem}
            onClick={() => setVisible(v => ({ ...v, mem: !v.mem }))}
          />
          <ToggleChip
            label="Disk"
            color={COLORS.disk}
            active={visible.disk}
            onClick={() => setVisible(v => ({ ...v, disk: !v.disk }))}
          />
        </div>

        {/* Main AreaChart */}
        {loading && chartData.length === 0 ? (
          <Skeleton className="h-[300px] w-full rounded-lg" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => fetchData(range)} />
        ) : chartData.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-xs text-muted-foreground">
            لا توجد بيانات كافية لعرضها في هذا النطاق الزمني.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.cpu} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS.cpu} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.mem} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS.mem} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="diskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.disk} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS.disk} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
              <XAxis
                dataKey="time"
                stroke="#888"
                fontSize={10}
                tick={{ fill: '#888' }}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                stroke="#888"
                fontSize={10}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fill: '#888' }}
              />
              <Tooltip content={<ChartTooltip range={range} />} />
              <Legend
                wrapperStyle={{ fontSize: '11px' }}
                formatter={(v) => <span className="text-foreground">{v}</span>}
              />
              {/* Warning + Critical threshold lines */}
              <ReferenceLine y={THRESHOLD_WARNING} stroke="#f59e0b" strokeDasharray="4 4"
                strokeOpacity={0.45} label={{ value: 'تحذير 70%', fontSize: 9, fill: '#f59e0b', position: 'insideTopLeft' }} />
              <ReferenceLine y={THRESHOLD_CRITICAL} stroke="#ef4444" strokeDasharray="4 4"
                strokeOpacity={0.45} label={{ value: 'خطر 85%', fontSize: 9, fill: '#ef4444', position: 'insideTopLeft' }} />

              {visible.cpu && (
                <Area type="monotone" name="CPU" dataKey="cpu"
                  stroke={COLORS.cpu} strokeWidth={2}
                  fill="url(#cpuGrad)" connectNulls
                  isAnimationActive={false}
                />
              )}
              {visible.mem && (
                <Area type="monotone" name="RAM" dataKey="mem"
                  stroke={COLORS.mem} strokeWidth={2}
                  fill="url(#memGrad)" connectNulls
                  isAnimationActive={false}
                />
              )}
              {visible.disk && (
                <Area type="monotone" name="Disk" dataKey="disk"
                  stroke={COLORS.disk} strokeWidth={2}
                  fill="url(#diskGrad)" connectNulls
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* Summary line */}
        {!loading && !error && chartData.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground font-mono">
            <span>متوسط CPU: <b className="text-foreground">{fmt(summary.cpu_avg)}%</b></span>
            <span>أعلى CPU: <b className="text-foreground">{fmt(summary.cpu_max)}%</b></span>
            <span>متوسط RAM: <b className="text-foreground">{fmt(summary.mem_avg)}%</b></span>
            <span>أعلى RAM: <b className="text-foreground">{fmt(summary.mem_max)}%</b></span>
            <span>عدد النقاط: <b className="text-foreground">{chartData.length}</b></span>
          </div>
        )}

        {/* PM2 online count chart */}
        {!loading && !error && chartData.length > 0 && (
          <div className="rounded-lg border border-border/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Server className="w-3.5 h-3.5" style={{ color: COLORS.pm2 }} />
                عمليات PM2 النشطة
              </span>
              <Badge variant="outline" className="text-[10px] h-5">
                {summary.pm2_online_current ?? '—'} / {pm2Total ?? '—'}
              </Badge>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                <XAxis dataKey="time" stroke="#888" fontSize={9}
                  interval="preserveStartEnd" minTickGap={20} />
                <YAxis stroke="#888" fontSize={9}
                  domain={[0, pm2Total ? Math.max(pm2Total + 1, 1) : 'auto']}
                  allowDecimals={false} />
                <Tooltip content={<ChartTooltip range={range} />} />
                <Line type="monotone" name="PM2 Online" dataKey="pm2_online"
                  stroke={COLORS.pm2} strokeWidth={2} dot={false}
                  isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Network I/O chart (optional) */}
        {!loading && !error && hasNet && chartData.length > 0 && (
          <div className="rounded-lg border border-border/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Wifi className="w-3.5 h-3.5 text-cyan-500" />
              شبكة I/O (KB/s)
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                <XAxis dataKey="time" stroke="#888" fontSize={9}
                  interval="preserveStartEnd" minTickGap={20} />
                <YAxis stroke="#888" fontSize={9} />
                <Tooltip content={<NetTooltip range={range} />} />
                <Legend wrapperStyle={{ fontSize: '10px' }} />
                <Line type="monotone" name="RX" dataKey="net_rx"
                  stroke={COLORS.netRx} strokeWidth={2} dot={false}
                  isAnimationActive={false} connectNulls />
                <Line type="monotone" name="TX" dataKey="net_tx"
                  stroke={COLORS.netTx} strokeWidth={2} dot={false}
                  isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Subcomponents                                                     */
/* ------------------------------------------------------------------ */

function ToggleChip({
  label, color, active, onClick,
}: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
        active
          ? 'bg-foreground/5 border-border text-foreground'
          : 'bg-transparent border-border/40 text-muted-foreground/60 line-through',
      )}
      aria-pressed={active}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: active ? color : 'currentColor', opacity: active ? 1 : 0.4 }}
      />
      {label}
    </button>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-[300px] flex-col items-center justify-center gap-3 text-center">
      <AlertTriangle className="w-8 h-8 text-red-500" />
      <div className="text-xs text-muted-foreground max-w-md">
        تعذّر تحميل البيانات التاريخية.
        <br />
        <span className="font-mono text-[10px] text-red-500/80">{message}</span>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5 text-xs h-8">
        <RefreshCw className="w-3.5 h-3.5" />
        إعادة المحاولة
      </Button>
    </div>
  );
}

export default ResourceHistoryChart;
