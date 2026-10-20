'use client';

/**
 * ResourceAlerts
 * ===============
 * بطاقة عرض التنبيهات الأخيرة + درجة صحة النظام (Health Score).
 *
 * يستدعي: GET /api/admin/system-resources/anomalies?limit=10
 *
 * - Health Score gauge (0-100) مع لون ووصف عربي
 * - قائمة التنبيهات (max 10) قابلة للتمرير
 * - كل تنبيه: emoji + المورد + الرسالة + الوقت النسبي
 * - تحديث تلقائي كل 60 ثانية
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
 Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
 ShieldCheck, ShieldAlert, ShieldX, RefreshCw,
 AlertTriangle, CheckCircle2, Activity, Clock, Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface Alert {
 id: number;
 ts: string;
 resource: string;
 severity: 'critical' | 'warning' | 'info' | 'recovered';
 type: string;
 message: string;
 value?: number | null;
}

interface AnomaliesResponse {
 alerts: Alert[];
 health_score?: number;
 health_severity?: 'critical' | 'warning' | 'good' | string;
 count?: number;
 error?: string;
}

interface ResourceAlertsProps {
 className?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

const RESOURCE_LABELS: Record<string, string> = {
 cpu: 'CPU',
 ram: 'RAM',
 memory: 'RAM',
 disk: 'Disk',
 pm2: 'PM2',
 net: 'Network',
 load: 'Load Avg',
 process: 'Process',
};

const SEVERITY_CONFIG: Record<string, {
 emoji: string;
 color: string;
 border: string;
 bg: string;
 text: string;
}> = {
 critical: {
 emoji: '🔴',
 color: '#ef4444',
 border: 'border-loss/20',
 bg: 'bg-loss/5',
 text: 'text-loss ',
 },
 warning: {
 emoji: '🟡',
 color: '#f59e0b',
 border: 'border-warning/20',
 bg: 'bg-warning/5',
 text: 'text-warning ',
 },
 info: {
 emoji: '🔵',
 color: '#06b6d4',
 border: 'border-cyan-500/40',
 bg: 'bg-cyan-500/5',
 text: 'text-cyan-600 dark:text-cyan-400',
 },
 recovered: {
 emoji: '🟢',
 color: '#10b981',
 border: 'border-profit/20',
 bg: 'bg-profit/5',
 text: 'text-profit ',
 },
};

function resourceLabel(resource: string): string {
 return RESOURCE_LABELS[resource?.toLowerCase()] || resource || 'نظام';
}

function severityConfig(severity: string) {
 return SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
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
 } catch {
 return ts;
 }
}

function healthTone(score: number): {
 color: string;
 label: string;
 Icon: typeof ShieldCheck;
 ring: string;
} {
 if (score >= 80) return {
 color: '#10b981',
 label: 'ممتاز',
 Icon: ShieldCheck,
 ring: 'stroke-profit',
 };
 if (score >= 60) return {
 color: '#f59e0b',
 label: 'جيد',
 Icon: ShieldAlert,
 ring: 'stroke-warning',
 };
 return {
 color: '#ef4444',
 label: 'خطر',
 Icon: ShieldX,
 ring: 'stroke-loss',
 };
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export function ResourceAlerts({ className }: ResourceAlertsProps) {
 const [data, setData] = useState<AnomaliesResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [autoRefresh, setAutoRefresh] = useState(true);
 const [lastUpdated, setLastUpdated] = useState<string>('');
 const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

 const fetchData = useCallback(async () => {
 setError(null);
 try {
 const res = await fetch(
 '/api/admin/system-resources/anomalies?limit=10',
 { credentials: 'same-origin', cache: 'no-store' },
 );
 if (!res.ok) {
 const txt = await res.text().catch(() => '');
 throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
 }
 const json: AnomaliesResponse = await res.json();
 setData(json);
 setLastUpdated(new Date().toISOString());
 } catch (e: any) {
 setError(e?.message || 'خطأ في جلب التنبيهات');
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 useEffect(() => {
 if (!autoRefresh) {
 if (timerRef.current) clearInterval(timerRef.current);
 return;
 }
 timerRef.current = setInterval(fetchData, 60_000);
 return () => {
 if (timerRef.current) clearInterval(timerRef.current);
 };
 }, [autoRefresh, fetchData]);

 const alerts = data?.alerts || [];
 const score = typeof data?.health_score === 'number' ? data.health_score : 100;
 const tone = healthTone(score);
 const HealthIcon = tone.Icon;

 // Counts by severity for the badge summary
 const counts = alerts.reduce((acc, a) => {
 acc[a.severity] = (acc[a.severity] || 0) + 1;
 return acc;
 }, {} as Record<string, number>);

 return (
 <Card className={cn('border-border/60 shadow-sm', className)}>
 <CardHeader className="p-4 pb-2">
 <div className="flex items-center justify-between gap-3">
 <div>
 <CardTitle className="flex items-center gap-2 text-sm font-bold">
 <Bell className="w-4 h-4 text-warning" />
 التنبيهات ودرجة الصحة
 </CardTitle>
 <CardDescription className="mt-1 text-xs">
 كشف الشذوذ التلقائي + درجة صحة النظام (0-100).
 </CardDescription>
 </div>
 <div className="flex items-center gap-1.5">
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
 onClick={fetchData}
 className="gap-1.5 text-xs h-8"
 >
 <RefreshCw className="w-3.5 h-3.5" />
 تحديث
 </Button>
 </div>
 </div>
 </CardHeader>

 <CardContent className="p-4 pt-2 space-y-3" dir="rtl">
 {/* Health score gauge */}
 {loading && !data ? (
 <Skeleton className="h-32 w-full rounded-lg" />
 ) : error ? (
 <div className="rounded-lg border border-loss/20 bg-loss/5 p-4 text-center">
 <AlertTriangle className="w-6 h-6 text-loss mx-auto mb-2" />
 <div className="text-xs text-muted-foreground">{error}</div>
 <Button
 size="sm" variant="outline" onClick={fetchData}
 className="mt-2 gap-1.5 text-xs h-8"
 >
 <RefreshCw className="w-3.5 h-3.5" />
 إعادة المحاولة
 </Button>
 </div>
 ) : (
 <div
 className={cn(
 'rounded-xl border p-4 flex items-center gap-4',
 score >= 80 ? 'border-profit/20 bg-profit/5' :
 score >= 60 ? 'border-warning/20 bg-warning/5' :
 'border-loss/20 bg-loss/5',
 )}
 >
 {/* Big number */}
 <div className="flex flex-col items-center justify-center min-w-[100px]">
 <div
 className="text-4xl font-extrabold tabular-nums"
 style={{ color: tone.color }}
 >
 {score}
 </div>
 <div className="text-xs text-muted-foreground mt-0.5">/ 100</div>
 <div
 className="mt-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
 style={{ background: `${tone.color}20`, color: tone.color }}
 >
 <HealthIcon className="w-3 h-3" />
 {tone.label}
 </div>
 </div>

 {/* Side info */}
 <div className="flex-1 min-w-0 space-y-1.5">
 <Progress value={score} className="h-2"
 style={{ ['--progress-foreground' as any]: tone.color }} />
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
 {counts.critical ? (
 <span className="flex items-center gap-1 text-loss">
 🔴 {counts.critical} حرج
 </span>
 ) : null}
 {counts.warning ? (
 <span className="flex items-center gap-1 text-warning">
 🟡 {counts.warning} تحذير
 </span>
 ) : null}
 {counts.recovered ? (
 <span className="flex items-center gap-1 text-profit">
 🟢 {counts.recovered} تعافى
 </span>
 ) : null}
 {!counts.critical && !counts.warning && !counts.recovered && (
 <span className="flex items-center gap-1 text-profit">
 <CheckCircle2 className="w-3.5 h-3.5" />
 لا توجد تنبيهات نشطة
 </span>
 )}
 </div>
 {lastUpdated && (
 <div className="flex items-center gap-1 text-xs text-muted-foreground">
 <Clock className="w-3 h-3" />
 آخر تحديث: {formatTimeAgo(lastUpdated)}
 </div>
 )}
 </div>
 </div>
 )}

 {/* Alerts list */}
 <div>
 <div className="flex items-center justify-between mb-2">
 <span className="flex items-center gap-1.5 text-xs font-semibold">
 <Activity className="w-3.5 h-3.5 text-cyan-500" />
 آخر التنبيهات
 </span>
 <Badge variant="outline" className="text-xs h-5">
 {alerts.length} / 10
 </Badge>
 </div>

 {loading && !data ? (
 <div className="space-y-2">
 {Array.from({ length: 3 }).map((_, i) => (
 <Skeleton key={i} className="h-14 w-full rounded-lg" />
 ))}
 </div>
 ) : !loading && alerts.length === 0 ? (
 <div className="rounded-lg border border-profit/20 bg-profit/5 p-4 text-center text-xs text-profit flex flex-col items-center gap-2">
 <CheckCircle2 className="w-6 h-6" />
 <div>كل المؤشرات ضمن النطاق الطبيعي — لا توجد تنبيهات.</div>
 </div>
 ) : (
 <div
 className="max-h-96 overflow-y-auto space-y-2 pr-1"
 style={{
 scrollbarWidth: 'thin',
 }}
 >
 {alerts.map((a) => {
 const cfg = severityConfig(a.severity);
 return (
 <div
 key={a.id}
 className={cn(
 'flex items-start gap-2.5 rounded-lg border p-2.5 text-xs',
 cfg.border, cfg.bg,
 )}
 >
 <span className="text-base leading-none mt-0.5">{cfg.emoji}</span>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2">
 <span className={cn('font-bold', cfg.text)}>
 {resourceLabel(a.resource)}
 {a.type ? ` · ${a.type}` : ''}
 </span>
 <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
 {formatTimeAgo(a.ts)}
 </span>
 </div>
 <div className="mt-0.5 text-foreground/90 leading-relaxed break-words">
 {a.message}
 </div>
 {typeof a.value === 'number' && !Number.isNaN(a.value) && (
 <div className="mt-1 font-mono text-xs text-muted-foreground">
 القيمة: {(a.value ?? 0).toFixed(1)}
 {a.resource === 'cpu' || a.resource === 'ram' || a.resource === 'disk' ? '%' : ''}
 </div>
 )}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 </CardContent>
 </Card>
 );
}

export default ResourceAlerts;
