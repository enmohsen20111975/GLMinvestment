'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Cpu, HardDrive, MemoryStick, Server, RefreshCw, Activity,
  CheckCircle2, XCircle, AlertTriangle, Clock, Zap, Database,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface CpuInfo {
  percent: number | null;
  cores: number;
  model: string;
  load_avg_1m: number;
  load_avg_5m: number;
  load_avg_15m: number;
}

interface MemoryInfo {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  used_percent: number;
  total_formatted: string;
  used_formatted: string;
  free_formatted: string;
}

interface DiskInfo {
  fs: string;
  mount: string;
  size_bytes: number;
  used_bytes: number;
  available_bytes: number;
  used_percent: number;
  size_formatted: string;
  used_formatted: string;
  available_formatted: string;
}

interface UptimeInfo {
  system_seconds: number;
  system_formatted: string;
  process_seconds: number;
  process_formatted: string;
}

interface NodeProcessInfo {
  rss_bytes: number;
  rss_mb: number;
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
}

interface TopProcess {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
}

interface SystemResources {
  success: boolean;
  timestamp: string;
  cpu: CpuInfo;
  memory: MemoryInfo;
  disk: DiskInfo[];
  uptime: UptimeInfo;
  node_process: NodeProcessInfo;
  top_processes: TopProcess[];
  error?: string;
}

interface ServiceCheck {
  id: string;
  name_ar: string;
  type: 'http' | 'tcp' | 'process' | 'file';
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  latency_ms?: number;
  message: string;
}

interface SystemHealth {
  success: boolean;
  timestamp: string;
  summary: {
    total: number;
    online: number;
    offline: number;
    degraded: number;
    health_score: number;
  };
  services: ServiceCheck[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function useInterval(callback: () => void, delayMs: number, active: boolean) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs, active]);
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function SystemMonitorPanel() {
  const [resources, setResources] = useState<SystemResources | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [resRes, resHealth] = await Promise.all([
        fetch('/api/admin/system-resources', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/admin/system-health', { credentials: 'same-origin', cache: 'no-store' }),
      ]);
      const resJson: SystemResources = await resRes.json();
      const healthJson: SystemHealth = await resHealth.json();
      if (resJson.success) setResources(resJson);
      if (healthJson.success) setHealth(healthJson);
    } catch (e) {
      // silent — don't spam toast on auto-refresh failure
      if (loading) {
        toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
      }
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useInterval(fetchAll, 5000, autoRefresh);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-500" />
                مراقبة موارد النظام
              </CardTitle>
              <CardDescription className="mt-1">
                CPU / Memory / Disk مباشر + حالة الخدمات. يتحدّث كل 5 ثوانٍ تلقائياً.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh(v => !v)}
                className="gap-2"
              >
                <RefreshCw className={cn('w-4 h-4', autoRefresh && 'animate-spin-slow')} style={autoRefresh ? { animationDuration: '3s' } : undefined} />
                {autoRefresh ? 'تحديث تلقائي (5s)' : 'متوقف'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchAll}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                الآن
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Top stats: CPU / Memory / Health */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CpuCard data={resources} loading={loading} />
        <MemoryCard data={resources} loading={loading} />
        <HealthCard health={health} loading={loading} />
      </div>

      {/* Services status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4 text-sky-500" />
            حالة الخدمات
            {health && (
              <Badge variant="outline" className="ml-2">
                {health.summary.online}/{health.summary.total} متاح
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !health ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {health?.services.map(svc => <ServiceRow key={svc.id} svc={svc} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disk usage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-amber-500" />
            استخدام القرص
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !resources ? (
            <Skeleton className="h-16 w-full" />
          ) : resources?.disk?.length ? (
            <div className="space-y-3">
              {resources.disk.map(d => (
                <div key={`${d.fs}-${d.mount}`} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs" dir="ltr">{d.mount}</span>
                    <span className="text-muted-foreground text-xs">
                      {d.used_formatted} / {d.size_formatted} ({d.used_percent}%)
                    </span>
                  </div>
                  <Progress
                    value={d.used_percent}
                    className={cn('h-2', d.used_percent > 90 ? '[&>div]:bg-red-500' : d.used_percent > 75 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500')}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">لا توجد بيانات قرص متاحة.</p>
          )}
        </CardContent>
      </Card>

      {/* Top processes + uptime */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-500" />
              أعلى العمليات استهلاكاً
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading && !resources ? (
              <Skeleton className="h-32 w-full" />
            ) : resources?.top_processes?.length ? (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-right border-b">
                      <th className="p-2 font-medium">PID</th>
                      <th className="p-2 font-medium">الاسم</th>
                      <th className="p-2 font-medium">CPU%</th>
                      <th className="p-2 font-medium">RAM (MB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resources.top_processes.map(p => (
                      <tr key={p.pid} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-mono text-xs">{p.pid}</td>
                        <td className="p-2 font-mono text-xs truncate max-w-[140px]" dir="ltr">{p.name}</td>
                        <td className="p-2">{p.cpu_percent.toFixed(1)}%</td>
                        <td className="p-2">{p.memory_mb}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد بيانات.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-500" />
              معلومات النظام
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && !resources ? (
              <Skeleton className="h-32 w-full" />
            ) : resources ? (
              <>
                <InfoRow label="مدة تشغيل النظام" value={resources.uptime.system_formatted} />
                <InfoRow label="مدة تشغيل العملية (Next.js)" value={resources.uptime.process_formatted} />
                <InfoRow label="موديل CPU" value={resources.cpu.model} />
                <InfoRow label="عدد الأنوية" value={resources.cpu.cores.toString()} />
                <InfoRow label="متوسط الحمل (1m)" value={resources.cpu.load_avg_1m.toString()} />
                <InfoRow label="متوسط الحمل (5m)" value={resources.cpu.load_avg_5m.toString()} />
                <InfoRow label="RAM عملية Next.js" value={`${resources.node_process.rss_mb} MB RSS`} />
                <InfoRow label="Heap المستخدم" value={`${resources.node_process.heap_used_mb} / ${resources.node_process.heap_total_mb} MB`} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد بيانات.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function CpuCard({ data, loading }: { data: SystemResources | null; loading: boolean }) {
  if (loading && !data) return <Skeleton className="h-32 w-full rounded-xl" />;
  const pct = data?.cpu?.percent ?? null;
  const tone = pct === null ? 'neutral' : pct < 50 ? 'success' : pct < 80 ? 'warning' : 'danger';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Cpu className="w-4 h-4 text-emerald-500" />
            استخدام CPU
          </span>
          <Badge variant="outline" className="text-xs">{data?.cpu?.cores ?? '—'} أنوية</Badge>
        </div>
        <div className={cn(
          'text-3xl font-bold mb-2',
          tone === 'success' ? 'text-emerald-600' :
          tone === 'warning' ? 'text-amber-600' :
          tone === 'danger' ? 'text-red-600' : 'text-muted-foreground',
        )}>
          {pct === null ? '—' : `${pct.toFixed(1)}%`}
        </div>
        <Progress
          value={pct ?? 0}
          className={cn(
            'h-2',
            tone === 'success' ? '[&>div]:bg-emerald-500' :
            tone === 'warning' ? '[&>div]:bg-amber-500' :
            tone === 'danger' ? '[&>div]:bg-red-500' : '[&>div]:bg-muted',
          )}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>load 1m: {data?.cpu?.load_avg_1m?.toFixed(2) ?? '—'}</span>
          <span>load 5m: {data?.cpu?.load_avg_5m?.toFixed(2) ?? '—'}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function MemoryCard({ data, loading }: { data: SystemResources | null; loading: boolean }) {
  if (loading && !data) return <Skeleton className="h-32 w-full rounded-xl" />;
  const pct = data?.memory?.used_percent ?? 0;
  const tone = pct < 60 ? 'success' : pct < 85 ? 'warning' : 'danger';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <MemoryStick className="w-4 h-4 text-sky-500" />
            استخدام الذاكرة
          </span>
          <Badge variant="outline" className="text-xs">{data?.memory?.total_formatted ?? '—'}</Badge>
        </div>
        <div className={cn(
          'text-3xl font-bold mb-2',
          tone === 'success' ? 'text-emerald-600' :
          tone === 'warning' ? 'text-amber-600' : 'text-red-600',
        )}>
          {pct}%
        </div>
        <Progress
          value={pct}
          className={cn(
            'h-2',
            tone === 'success' ? '[&>div]:bg-emerald-500' :
            tone === 'warning' ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500',
          )}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>مستخدم: {data?.memory?.used_formatted ?? '—'}</span>
          <span>حر: {data?.memory?.free_formatted ?? '—'}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthCard({ health, loading }: { health: SystemHealth | null; loading: boolean }) {
  if (loading && !health) return <Skeleton className="h-32 w-full rounded-xl" />;
  const score = health?.summary?.health_score ?? 0;
  const tone = score >= 80 ? 'success' : score >= 50 ? 'warning' : 'danger';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-violet-500" />
            صحة الخدمات
          </span>
          <Badge variant="outline" className="text-xs">
            {health?.summary?.online ?? 0}/{health?.summary?.total ?? 0} متاح
          </Badge>
        </div>
        <div className={cn(
          'text-3xl font-bold mb-2',
          tone === 'success' ? 'text-emerald-600' :
          tone === 'warning' ? 'text-amber-600' : 'text-red-600',
        )}>
          {score}%
        </div>
        <Progress
          value={score}
          className={cn(
            'h-2',
            tone === 'success' ? '[&>div]:bg-emerald-500' :
            tone === 'warning' ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500',
          )}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span className="text-emerald-600">متاح: {health?.summary?.online ?? 0}</span>
          <span className="text-red-600">غير متاح: {health?.summary?.offline ?? 0}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceRow({ svc }: { svc: ServiceCheck }) {
  const isOnline = svc.status === 'online';
  const isDegraded = svc.status === 'degraded';
  const Icon = svc.type === 'file' ? Database : Server;
  return (
    <div className={cn(
      'flex items-center gap-2 p-2 rounded-lg border',
      isOnline ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20' :
      isDegraded ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20' :
      'border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/20',
    )}>
      <div className={cn(
        'w-2 h-2 rounded-full flex-shrink-0',
        isOnline ? 'bg-emerald-500' :
        isDegraded ? 'bg-amber-500' : 'bg-red-500',
      )} />
      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{svc.name_ar}</div>
        <div className="text-[10px] text-muted-foreground truncate">{svc.message}</div>
      </div>
      {typeof svc.latency_ms === 'number' && (
        <Badge variant="secondary" className="text-[10px] h-5">{svc.latency_ms}ms</Badge>
      )}
      {isOnline ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      ) : isDegraded ? (
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs" dir="ltr">{value}</span>
    </div>
  );
}
