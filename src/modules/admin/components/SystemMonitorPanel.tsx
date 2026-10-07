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
  Trash2, Play, Square, RotateCcw, ShieldAlert, Sparkles, FileText, Folder,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ResourceHistoryChart } from './ResourceHistoryChart';
import { ResourceAlerts } from './ResourceAlerts';
import { ProcessResourceHistory } from './ProcessResourceHistory';

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

interface Pm2Process {
  id: number;
  name: string;
  status: string;
  pid: number;
  uptime_ms: number;
  restarts: number;
  cpu_percent: number;
  memory_bytes: number;
  memory_formatted: string;
  log_out: string;
  log_err: string;
}

interface LargeFile {
  path: string;
  relative_path: string;
  size_bytes: number;
  size_formatted: string;
  modified: string;
}

interface StorageCategory {
  name_ar: string;
  path: string;
  size_bytes: number;
  size_formatted: string;
  count: number;
}

interface SystemResources {
  success: boolean;
  timestamp: string;
  threat_level: 'safe' | 'warning' | 'critical';
  cpu: CpuInfo;
  memory: MemoryInfo;
  disk: DiskInfo[];
  root_disk: DiskInfo | null;
  pm2_services?: Pm2Process[];
  storage_breakdown?: StorageCategory[];
  largest_files?: LargeFile[];
  top_processes: Array<{ pid: number; name: string; cpu_percent: number; memory_mb: number }>;
  uptime: { system_seconds: number; system_formatted: string; process_seconds: number; process_formatted: string };
  node_process: { rss_mb: number; heap_used_mb: number; heap_total_mb: number; external_mb: number };
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

function useInterval(callback: () => void, delayMs: number, active: boolean) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs, active]);
}

function formatUptimeDuration(ms: number): string {
  if (!ms || ms <= 0) return 'متوقف';
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function SystemMonitorPanel() {
  const [resources, setResources] = useState<SystemResources | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [dialogProcess, setDialogProcess] = useState<string | null>(null);

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
    } catch (e: any) {
      if (loading) {
        toast.error(e?.message || 'خطأ في الاتصال بالنظام');
      }
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useInterval(fetchAll, 6000, autoRefresh);

  /* Execution Handler for Admin System Actions */
  const handleAction = async (action: string, payload: Record<string, any> = {}) => {
    setActiveAction(action + (payload.target ? `-${payload.target}` : ''));
    try {
      const res = await fetch('/api/admin/system-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم تنفيذ الإجراء بنجاح');
        await fetchAll();
      } else {
        toast.error(data.error || 'فشل تنفيذ الإجراء');
      }
    } catch (e: any) {
      toast.error(e?.message || 'خطأ في تنفيذ الإجراء');
    } finally {
      setActiveAction(null);
    }
  };

  const rootDisk = resources?.root_disk || (resources?.disk && resources.disk[0]);
  const isHighDisk = (rootDisk?.used_percent ?? 0) >= 70;
  const isCriticalDisk = (rootDisk?.used_percent ?? 0) >= 85;

  return (
    <div className="space-y-5" dir="rtl">
      {/* ─── Header & Live Controls ─── */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="w-5 h-5 text-emerald-500" />
                مركز حماية ومراقبة موارد النظام والـ VPS
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                متابعة حية لاستهلاك القرص وذاكرة السيرفر، مع أدوات فورية لتفريغ المساحة والتحكم بخدمات PM2.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh(v => !v)}
                className="gap-2 text-xs h-8"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', autoRefresh && 'animate-spin-slow')} style={autoRefresh ? { animationDuration: '3s' } : undefined} />
                {autoRefresh ? 'تحديث تلقائي (6s)' : 'متوقف'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAll}
                className="gap-2 text-xs h-8"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                تحديث الآن
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ─── Threat Alert Banner if Disk is High ─── */}
      {isHighDisk && rootDisk && (
        <div className={cn(
          'p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md transition-all',
          isCriticalDisk
            ? 'bg-red-500/10 border-red-500/40 text-red-500 dark:text-red-400'
            : 'bg-amber-500/10 border-amber-500/40 text-amber-500 dark:text-amber-400'
        )}>
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 flex-shrink-0 animate-pulse" />
            <div>
              <div className="font-bold text-sm">
                {isCriticalDisk ? '🚨 تحذير حرج: مساحة القرص ممتلئة بنسبة خطيرة!' : '⚠️ تنبيه: استهلاك مساحة القرص مرتفع (أكثر من 70%)'}
              </div>
              <div className="text-xs opacity-90 mt-0.5">
                المساحة المستخدمة: <b>{rootDisk.used_formatted}</b> من أصل <b>{rootDisk.size_formatted}</b> ({rootDisk.used_percent}%). يرجى تفريغ اللوجات وضغط قواعد البيانات لحماية النظام من التوقف.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="destructive"
              className="text-xs h-8 gap-1.5"
              disabled={activeAction !== null}
              onClick={() => handleAction('clean_logs')}
            >
              <Trash2 className="w-3.5 h-3.5" />
              تفريغ السجلات فوراً
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 gap-1.5 bg-background"
              disabled={activeAction !== null}
              onClick={() => handleAction('vacuum_databases')}
            >
              <Database className="w-3.5 h-3.5 text-amber-500" />
              ضغط قواعد البيانات
            </Button>
          </div>
        </div>
      )}

      {/* ─── Top Stats: CPU / Memory / Primary Disk ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <CpuCard data={resources} loading={loading} />
        <MemoryCard data={resources} loading={loading} />
        <DiskCard disk={rootDisk} loading={loading} />
        <HealthCard health={health} loading={loading} />
      </div>

      {/* ─── TASK-C: Historical Charts + Alerts side-by-side ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ResourceHistoryChart className="lg:col-span-2" />
        <ResourceAlerts />
      </div>

      {/* ─── One-Click Storage Cleanup Toolbar ─── */}
      <Card className="border-border/60">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              إجراءات تفريغ المساحة وحماية السيرفر (بنقرة واحدة)
            </CardTitle>
            <Badge variant="outline" className="text-[11px] text-muted-foreground">آمن وفوري</Badge>
          </div>
          <CardDescription className="text-xs mt-1">
            عمليات تنظيف آمنة لا توقف الموقع وتسترجع جيجابايتات التخزين فوراً من السجلات والصور المؤقتة والـ WAL.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Clean Logs */}
            <Button
              variant="outline"
              className="h-auto p-3 flex flex-col items-start gap-1 text-right border-border/80 hover:border-amber-500/50 hover:bg-amber-500/5 transition-all"
              disabled={activeAction !== null}
              onClick={() => handleAction('clean_logs')}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-sky-500" />
                  تفريغ سجلات PM2 واللوجات
                </span>
                {activeAction === 'clean_logs' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              </div>
              <span className="text-[10px] text-muted-foreground leading-relaxed">
                تنظيف ملفات stdout/stderr وتصفير ملفات `logs/*.log`
              </span>
            </Button>

            {/* Vacuum Databases */}
            <Button
              variant="outline"
              className="h-auto p-3 flex flex-col items-start gap-1 text-right border-border/80 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all"
              disabled={activeAction !== null}
              onClick={() => handleAction('vacuum_databases')}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-emerald-500" />
                  ضغط قواعد SQLite (VACUUM)
                </span>
                {activeAction === 'vacuum_databases' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              </div>
              <span className="text-[10px] text-muted-foreground leading-relaxed">
                تفريغ ملفات WAL Checkpoint واسترجاع المساحات المتروكة
              </span>
            </Button>

            {/* Clean Reports Images */}
            <Button
              variant="outline"
              className="h-auto p-3 flex flex-col items-start gap-1 text-right border-border/80 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all"
              disabled={activeAction !== null}
              onClick={() => handleAction('clean_reports')}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-violet-500" />
                  حذف تقارير الشارتات القديمة
                </span>
                {activeAction === 'clean_reports' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              </div>
              <span className="text-[10px] text-muted-foreground leading-relaxed">
                حذف آلاف صور الشارتات القديمة من `public/reports`
              </span>
            </Button>

            {/* Clean Next.js Build Cache */}
            <Button
              variant="outline"
              className="h-auto p-3 flex flex-col items-start gap-1 text-right border-border/80 hover:border-rose-500/50 hover:bg-rose-500/5 transition-all"
              disabled={activeAction !== null}
              onClick={() => handleAction('clean_cache')}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-rose-500" />
                  تفريغ كاش Next.js المؤقت
                </span>
                {activeAction === 'clean_cache' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              </div>
              <span className="text-[10px] text-muted-foreground leading-relaxed">
                حذف الكاش المتراكم في `.next/cache` بأمان
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── PM2 Live Services Controller Table ─── */}
      <Card className="border-border/60">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-500" />
              التحكم في خدمات النظام المباشرة (PM2 Process Manager)
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {resources?.pm2_services?.filter(s => s.status === 'online').length || 0} شغال / {resources?.pm2_services?.length || 0} خدمة
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {loading && !resources ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !resources?.pm2_services?.length ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              لا توجد عمليات PM2 نشطة حالياً أو أمر PM2 غير متاح محلياً.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 px-2">الخدمة</th>
                    <th className="py-2 px-2">الحالة</th>
                    <th className="py-2 px-2">PID</th>
                    <th className="py-2 px-2">CPU</th>
                    <th className="py-2 px-2">الذاكرة (RAM)</th>
                    <th className="py-2 px-2">وقت التشغيل</th>
                    <th className="py-2 px-2">إعادة التشغيل</th>
                    <th className="py-2 px-2 text-center">التحكم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {resources.pm2_services.map((proc) => {
                    const isOnline = proc.status === 'online';
                    const isBusy = activeAction?.startsWith(`service_control-${proc.name}`);
                    return (
                      <tr
                        key={proc.id}
                        className="hover:bg-muted/40 transition-colors cursor-pointer"
                        onClick={() => setDialogProcess(proc.name)}
                        title="اضغط لعرض السجل التاريخي للعملية"
                      >
                        <td className="py-2.5 px-2 font-mono font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDialogProcess(proc.name);
                              }}
                              className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-cyan-500/10 text-cyan-500 transition-colors"
                              title="عرض السجل التاريخي للعملية"
                              aria-label="عرض السجل التاريخي"
                            >
                              <BarChart3 className="w-3.5 h-3.5" />
                            </button>
                            <span>{proc.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge
                            variant={isOnline ? 'default' : 'destructive'}
                            className={cn('text-[10px] h-5', isOnline && 'bg-emerald-600 hover:bg-emerald-600')}
                          >
                            {isOnline ? '🟢 شغال' : '🔴 متوقف'}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-2 font-mono text-muted-foreground">{proc.pid || '—'}</td>
                        <td className="py-2.5 px-2 font-mono">{proc.cpu_percent}%</td>
                        <td className="py-2.5 px-2 font-mono font-medium">{proc.memory_formatted}</td>
                        <td className="py-2.5 px-2 font-mono text-muted-foreground">{formatUptimeDuration(proc.uptime_ms)}</td>
                        <td className="py-2.5 px-2 font-mono text-muted-foreground">{proc.restarts}x</td>
                        <td className="py-2.5 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-sky-500 hover:bg-sky-500/10"
                              title="إعادة تشغيل الخدمة"
                              disabled={activeAction !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAction('service_control', { command: 'restart', target: proc.name });
                              }}
                            >
                              <RotateCcw className={cn('w-3.5 h-3.5', isBusy && 'animate-spin')} />
                            </Button>
                            {isOnline ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                                title="إيقاف الخدمة"
                                disabled={activeAction !== null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction('service_control', { command: 'stop', target: proc.name });
                                }}
                              >
                                <Square className="w-3.5 h-3.5" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10"
                                title="تشغيل الخدمة"
                                disabled={activeAction !== null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction('service_control', { command: 'start', target: proc.name });
                                }}
                              >
                                <Play className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {/* TASK-C: Top processes summary (highest CPU + highest RAM) */}
        {!loading && resources?.pm2_services?.length ? (
          <TopProcessesSummary services={resources.pm2_services} />
        ) : null}
      </Card>

      {/* TASK-C: Process resource history dialog (opened on row click) */}
      <ProcessResourceHistory
        processName={dialogProcess ?? ''}
        open={!!dialogProcess}
        onClose={() => setDialogProcess(null)}
      />

      {/* ─── Storage Breakdown & Largest Files Scanner ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Storage Breakdown Cards */}
        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Folder className="w-4 h-4 text-violet-500" />
              توزيع استهلاك المساحة في مجلدات التطبيق
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {loading && !resources ? (
              <Skeleton className="h-32 w-full" />
            ) : resources?.storage_breakdown?.length ? (
              <div className="space-y-2.5">
                {resources.storage_breakdown.map((item) => (
                  <div key={item.path} className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/20">
                    <div className="flex items-center gap-2.5">
                      <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-semibold">{item.name_ar}</div>
                        <div className="text-[10px] text-muted-foreground font-mono" dir="ltr">{item.path}/ ({item.count} ملف)</div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {item.size_formatted}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-2">لا توجد بيانات تفصيلية.</div>
            )}
          </CardContent>
        </Card>

        {/* Top Largest Files List */}
        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-rose-500" />
              كاشف أضخم الملفات على القرص (&gt; 10 MB)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {loading && !resources ? (
              <Skeleton className="h-32 w-full" />
            ) : resources?.largest_files?.length ? (
              <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1">
                {resources.largest_files.map((file) => {
                  const isDeletable = file.relative_path.startsWith('logs/') ||
                    file.relative_path.startsWith('public/reports/') ||
                    file.relative_path.endsWith('.zip') ||
                    file.relative_path.endsWith('.bak');

                  return (
                    <div key={file.path} className="flex items-center justify-between p-2 rounded-md border border-border/50 bg-background text-xs">
                      <div className="min-w-0 flex-1 pl-2">
                        <div className="font-mono truncate font-medium text-[11px]" dir="ltr">
                          {file.relative_path}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {file.modified}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="font-mono text-[11px] text-amber-500 border-amber-500/30">
                          {file.size_formatted}
                        </Badge>
                        {isDeletable && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-red-500 hover:bg-red-500/10"
                            title="حذف هذا الملف لتوفير المساحة"
                            disabled={activeAction !== null}
                            onClick={() => handleAction('delete_file', { target_file: file.path })}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-4">
                لا توجد ملفات فردية تتجاوز 10 MB في المجلدات المفحوصة.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Health Checks Grid ─── */}
      <Card className="border-border/60">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            فحص استجابة المنافذ والملفات الحيوية
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {loading && !health ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {health?.services?.map((svc) => <ServiceRow key={svc.id} svc={svc} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subcomponents                                                     */
/* ------------------------------------------------------------------ */

function CpuCard({ data, loading }: { data: SystemResources | null; loading: boolean }) {
  if (loading && !data) return <Skeleton className="h-28 w-full rounded-xl" />;
  const pct = data?.cpu?.percent;
  const tone = pct === null ? 'neutral' : pct < 60 ? 'success' : pct < 85 ? 'warning' : 'danger';
  return (
    <Card className="border-border/60">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-emerald-500" />
            استخدام CPU
          </span>
          <Badge variant="outline" className="text-[10px] h-4">{data?.cpu?.cores ?? '—'} أنوية</Badge>
        </div>
        <div className={cn(
          'text-2xl font-bold mb-1.5',
          tone === 'success' ? 'text-emerald-500' :
          tone === 'warning' ? 'text-amber-500' :
          tone === 'danger' ? 'text-red-500' : 'text-muted-foreground',
        )}>
          {pct === null ? '—' : `${pct.toFixed(1)}%`}
        </div>
        <Progress value={pct ?? 0} className="h-1.5" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5 font-mono">
          <span>load 1m: {data?.cpu?.load_avg_1m?.toFixed(2) ?? '—'}</span>
          <span>load 5m: {data?.cpu?.load_avg_5m?.toFixed(2) ?? '—'}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function MemoryCard({ data, loading }: { data: SystemResources | null; loading: boolean }) {
  if (loading && !data) return <Skeleton className="h-28 w-full rounded-xl" />;
  const pct = data?.memory?.used_percent ?? 0;
  const tone = pct < 60 ? 'success' : pct < 85 ? 'warning' : 'danger';
  return (
    <Card className="border-border/60">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <MemoryStick className="w-3.5 h-3.5 text-sky-500" />
            استخدام الذاكرة (RAM)
          </span>
          <Badge variant="outline" className="text-[10px] h-4">{data?.memory?.total_formatted ?? '—'}</Badge>
        </div>
        <div className={cn(
          'text-2xl font-bold mb-1.5',
          tone === 'success' ? 'text-emerald-500' :
          tone === 'warning' ? 'text-amber-500' : 'text-red-500',
        )}>
          {pct}%
        </div>
        <Progress value={pct} className="h-1.5" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5 font-mono">
          <span>مستخدم: {data?.memory?.used_formatted ?? '—'}</span>
          <span>حر: {data?.memory?.free_formatted ?? '—'}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function DiskCard({ disk, loading }: { disk: DiskInfo | null | undefined; loading: boolean }) {
  if (loading && !disk) return <Skeleton className="h-28 w-full rounded-xl" />;
  const pct = disk?.used_percent ?? 0;
  const tone = pct < 65 ? 'success' : pct < 85 ? 'warning' : 'danger';
  return (
    <Card className="border-border/60">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <HardDrive className="w-3.5 h-3.5 text-amber-500" />
            القرص الأساسي ({disk?.mount || '/'})
          </span>
          <Badge variant="outline" className="text-[10px] h-4">{disk?.size_formatted ?? '—'}</Badge>
        </div>
        <div className={cn(
          'text-2xl font-bold mb-1.5',
          tone === 'success' ? 'text-emerald-500' :
          tone === 'warning' ? 'text-amber-500' : 'text-red-500',
        )}>
          {pct}%
        </div>
        <Progress value={pct} className="h-1.5" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5 font-mono">
          <span>مستخدم: {disk?.used_formatted ?? '—'}</span>
          <span>متبقي: {disk?.available_formatted ?? '—'}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthCard({ health, loading }: { health: SystemHealth | null; loading: boolean }) {
  if (loading && !health) return <Skeleton className="h-28 w-full rounded-xl" />;
  const score = health?.summary?.health_score ?? 0;
  const tone = score >= 80 ? 'success' : score >= 50 ? 'warning' : 'danger';
  return (
    <Card className="border-border/60">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-violet-500" />
            جاهزية الخدمات
          </span>
          <Badge variant="outline" className="text-[10px] h-4">
            {health?.summary?.online ?? 0}/{health?.summary?.total ?? 0} متاح
          </Badge>
        </div>
        <div className={cn(
          'text-2xl font-bold mb-1.5',
          tone === 'success' ? 'text-emerald-500' :
          tone === 'warning' ? 'text-amber-500' : 'text-red-500',
        )}>
          {score}%
        </div>
        <Progress value={score} className="h-1.5" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
          <span className="text-emerald-500">جاهز: {health?.summary?.online ?? 0}</span>
          <span className="text-red-500">معطل: {health?.summary?.offline ?? 0}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function TopProcessesSummary({ services }: { services: Pm2Process[] }) {
  const sortedByCpu = [...services].sort((a, b) => (b.cpu_percent ?? 0) - (a.cpu_percent ?? 0));
  const sortedByMem = [...services].sort((a, b) => (b.memory_bytes ?? 0) - (a.memory_bytes ?? 0));
  const topCpu = sortedByCpu[0];
  const topMem = sortedByMem[0];
  if (!topCpu && !topMem) return null;
  return (
    <div className="border-t border-border/40 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      {topCpu && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <span className="text-base">🔥</span>
          <span className="text-muted-foreground">أعلى Process استخداماً للـ CPU:</span>
          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{topCpu.name}</span>
          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{topCpu.cpu_percent}%</span>
        </div>
      )}
      {topMem && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <span className="text-base">🧠</span>
          <span className="text-muted-foreground">أعلى Process استخداماً للـ RAM:</span>
          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{topMem.name}</span>
          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{topMem.memory_formatted}</span>
        </div>
      )}
    </div>
  );
}

function ServiceRow({ svc }: { svc: ServiceCheck }) {
  const isOnline = svc.status === 'online';
  const isDegraded = svc.status === 'degraded';
  const Icon = svc.type === 'file' ? Database : Server;
  return (
    <div className={cn(
      'flex items-center gap-2 p-2 rounded-lg border text-xs',
      isOnline ? 'border-emerald-500/20 bg-emerald-500/5' :
      isDegraded ? 'border-amber-500/20 bg-amber-500/5' :
      'border-red-500/20 bg-red-500/5',
    )}>
      <div className={cn(
        'w-2 h-2 rounded-full flex-shrink-0',
        isOnline ? 'bg-emerald-500' :
        isDegraded ? 'bg-amber-500' : 'bg-red-500',
      )} />
      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{svc.name_ar}</div>
        <div className="text-[10px] text-muted-foreground truncate">{svc.message}</div>
      </div>
      {typeof svc.latency_ms === 'number' && (
        <Badge variant="secondary" className="text-[10px] h-4 font-mono">{svc.latency_ms}ms</Badge>
      )}
      {isOnline ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
      ) : isDegraded ? (
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      ) : (
        <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
      )}
    </div>
  );
}
