'use client';

/**
 * SystemHealthCard
 * ================
 * Task 28-B (Fix 9 — Fix Battalion):
 *   Wires /api/admin/system-health into the AdminView dashboard.
 *
 *   The endpoint already existed (checks Next.js, Python Engine 8010,
 *   Data Engine 3010, News Agent 3002, WebSocket 3005, Telegram bot
 *   process, and 5 critical DB files) but was only consumed by
 *   SystemMonitorPanel — the dashboard showed a local computed
 *   healthScore only, ignoring the live service checks.
 *
 *   This component:
 *     - Auto-fetches /api/admin/system-health on mount + every 30s
 *     - Renders a compact grid of all services with online/offline badges
 *     - Highlights critical DB files (auth/stocks/predictions/data_engine/news)
 *     - Shows latency for TCP/HTTP checks
 *     - Includes a refresh button + auto-refresh toggle
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Server, RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Activity, Database, Cpu, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ServiceCheck {
  id: string;
  name_ar: string;
  type: 'http' | 'tcp' | 'process' | 'file';
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  latency_ms?: number;
  message: string;
  details?: Record<string, unknown>;
  // PHASE2-ADMIN-PANEL: surfaced by /api/admin/system-health for file-type
  // services (DB files) — used by the stale-DB alert (last_update > 2h).
  last_seen?: string | null;
}

interface SystemHealthResponse {
  success: boolean;
  timestamp: string;
  summary?: {
    total: number;
    online: number;
    offline: number;
    degraded: number;
    health_score: number;
  };
  services?: ServiceCheck[];
  error?: string;
}

const STATUS_META: Record<
  ServiceCheck['status'],
  { label: string; dot: string; badge: string; icon: 'check' | 'x' | 'alert' }
> = {
  online: {
    label: 'يعمل',
    dot: 'bg-emerald-500',
    badge: 'border-emerald-500 text-emerald-700',
    icon: 'check',
  },
  offline: {
    label: 'متوقف',
    dot: 'bg-red-500',
    badge: 'border-red-500 text-red-700',
    icon: 'x',
  },
  degraded: {
    label: 'متدهور',
    dot: 'bg-amber-500',
    badge: 'border-amber-500 text-amber-700',
    icon: 'alert',
  },
  unknown: {
    label: 'غير معروف',
    dot: 'bg-slate-400',
    badge: 'border-slate-500 text-slate-700',
    icon: 'alert',
  },
};

const TYPE_ICON: Record<ServiceCheck['type'], React.ReactNode> = {
  http: <Activity className="w-3 h-3" />,
  tcp: <Server className="w-3 h-3" />,
  process: <Cpu className="w-3 h-3" />,
  file: <Database className="w-3 h-3" />,
};

// PHASE2-ADMIN-PANEL: owner requirement — "تنبيه أحمر فوري لو توقف تحديث أي
// قاعدة لأكثر من ساعتين". Used for DB file service checks (type='file').
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function isStaleDb(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false; // unknown — don't alert (Rule 27)
  const d = new Date(lastSeen);
  if (isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > STALE_THRESHOLD_MS;
}

function timeAgoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'الآن';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)} ث`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} د`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} س`;
  return `${Math.floor(diffMs / 86_400_000)} يوم`;
}

function StatusIcon({ status }: { status: ServiceCheck['status'] }) {
  const meta = STATUS_META[status];
  if (meta.icon === 'check') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
  if (meta.icon === 'x') return <XCircle className="w-3.5 h-3.5 text-red-600" />;
  return <AlertCircle className="w-3.5 h-3.5 text-amber-600" />;
}

export function SystemHealthCard() {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/system-health', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const json: SystemHealthResponse = await res.json();
      setData(json);
    } catch (err) {
      // Silent — don't spam toast on every failed poll
      console.error('[SystemHealthCard]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // Poll every 30s when autoRefresh is on + tab is visible
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchHealth();
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  const summary = data?.summary;
  const services = data?.services ?? [];
  const healthScore = summary?.health_score ?? 0;
  const onlineCount = summary?.online ?? 0;
  const offlineCount = summary?.offline ?? 0;
  const totalCount = summary?.total ?? 0;

  // PHASE2-ADMIN-PANEL: stale DB files (type='file', last_seen > 2h)
  const staleDbServices = services.filter(
    s => s.type === 'file' && isStaleDb(s.last_seen),
  );

  return (
    <Card className="border-emerald-200 dark:border-emerald-900/40">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500" />
              صحة النظام المباشرة
              {summary && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] gap-1 ml-2',
                    healthScore >= 80
                      ? 'border-emerald-500 text-emerald-700'
                      : healthScore >= 50
                        ? 'border-amber-500 text-amber-700'
                        : 'border-red-500 text-red-700',
                  )}
                >
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full inline-block',
                      healthScore >= 80 ? 'bg-emerald-500' : healthScore >= 50 ? 'bg-amber-500' : 'bg-red-500',
                    )}
                  />
                  {healthScore}% ({onlineCount}/{totalCount})
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              فحص حيّ لكل الخدمات: Next.js + Python + Data Engine + News Agent + WebSocket + Telegram + DBs.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefresh(v => !v)}
              className="gap-1 h-7 text-xs"
            >
              <RefreshCw className={cn('w-3 h-3', autoRefresh && 'animate-spin-slow')} style={autoRefresh ? { animationDuration: '3s' } : undefined} />
              {autoRefresh ? 'تلقائي' : 'متوقف'}
            </Button>
            <Button onClick={fetchHealth} disabled={loading} variant="ghost" size="sm" className="h-7 w-7 p-0">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !data?.success ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
            {data?.error || 'تعذّر جلب صحة النظام'}
          </div>
        ) : (
          <>
            {/* Critical alert if any offline */}
            {offlineCount > 0 && (
              <div className="mb-3 p-2 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span className="text-xs font-bold text-red-700 dark:text-red-400">
                  {offlineCount} خدمة متوقفة — تحتاج تدخّل فوري
                </span>
              </div>
            )}

            {/* PHASE2-ADMIN-PANEL: stale DB alert — owner requirement.
                "تنبيه أحمر فوري لو توقف تحديث أي قاعدة لأكثر من ساعتين" */}
            {staleDbServices.length > 0 && (
              <div className="mb-3 p-2 rounded-lg border border-red-400 bg-red-50 dark:bg-red-950/30 dark:border-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="text-xs font-bold text-red-700 dark:text-red-400 block">
                    ⚠️ {staleDbServices.length} قاعدة بيانات لم تتحدث منذ أكثر من ساعتين
                  </span>
                  <span className="text-[10px] text-red-600/80 dark:text-red-300/70 block mt-0.5" dir="ltr">
                    {staleDbServices.map(s => `${s.id.replace('db_', '')} (${timeAgoShort(s.last_seen)})`).join(' • ')}
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {services.map((svc) => {
                const meta = STATUS_META[svc.status];
                // PHASE2-ADMIN-PANEL: override border/dot for stale DB files
                const stale = svc.type === 'file' && isStaleDb(svc.last_seen);
                return (
                  <div
                    key={svc.id}
                    className={cn(
                      'p-2 rounded-lg border flex items-center gap-2 text-xs',
                      stale
                        ? 'border-red-400 bg-red-50 dark:bg-red-950/30 dark:border-red-800'
                        : svc.status === 'online'
                          ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/40'
                          : svc.status === 'degraded'
                            ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40'
                            : 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40',
                    )}
                  >
                    <div className={cn('w-2 h-2 rounded-full shrink-0', stale ? 'bg-red-500' : meta.dot)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {TYPE_ICON[svc.type]}
                        <span className="font-medium truncate">{svc.name_ar}</span>
                        <StatusIcon status={svc.status} />
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate" dir="ltr">
                        {svc.message}
                        {/* PHASE2-ADMIN-PANEL: show last update age for DB files */}
                        {svc.type === 'file' && svc.last_seen && (
                          <span className={cn('ml-1', stale ? 'text-red-600 dark:text-red-400 font-bold' : 'text-muted-foreground')}>
                            • آخر تحديث: {timeAgoShort(svc.last_seen)}{stale && ' ⚠️ متأخر'}
                          </span>
                        )}
                      </div>
                    </div>
                    {svc.latency_ms !== undefined && svc.latency_ms > 0 && (
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0" dir="ltr">
                        {svc.latency_ms}ms
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {data.timestamp && (
              <div className="text-[10px] text-muted-foreground mt-2 text-center" dir="ltr">
                آخر تحديث: {new Date(data.timestamp).toLocaleString('ar-EG')}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
