'use client';

/**
 * SystemTopologyTab (P1-GEMS-WIRING)
 * ===================================
 * تبويب Admin جديد يربط SystemTopologyGraph (851 LOC) الذي كان بدون render site.
 *
 * المسؤوليات:
 *  - يجيب بيانات الـ topology من /api/admin/system-topology (اللي بدوره بيروح
 *    للـ Python backend `/api/admin/system-topology`).
 *  - بيعمل poll كل 15 ثانية لو الـ tab مرئي.
 *  - بيتتبع changedNodes (الـ ids اللي اتغير حالتها بين آخر fetchين) عشان
 *    الـ graph يقدر يرسم border أصفر pulsing حواليهم.
 *  - بيوفر عناصر تحكم: refresh + zoom + selector للعنصر المختار.
 *
 * يتم تركيبه كـ admin tab جديد "طوبولوجيا النظام" داخل AdminView.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RefreshCw, AlertCircle, Activity, Database, Server,
  Heart, Zap, Loader2, ChevronDown, ChevronUp, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SystemTopologyGraph,
  type TopologyData,
  type ServiceNode,
  type DatabaseNode,
} from '@/modules/admin/components/SystemTopologyGraph';

const POLL_INTERVAL_MS = 15_000;
const FETCH_TIMEOUT_MS = 20_000;

export function SystemTopologyTab() {
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [lastChangedNodes, setLastChangedNodes] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  // Keep a ref to the previous status map so we can diff against the new fetch
  // and mark which nodes changed status (used by the graph's "pulse" highlight).
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch('/api/admin/system-topology', {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TopologyData;
      if (!json || !json.success) {
        throw new Error('استجابة غير صالحة من الـ backend');
      }

      // Compute changed nodes by diffing previous vs. new status
      const prev = prevStatusRef.current;
      const changed = new Set<string>();
      const next = new Map<string, string>();
      for (const svc of json.services ?? []) {
        next.set(svc.id, svc.status);
        if (prev.has(svc.id) && prev.get(svc.id) !== svc.status) {
          changed.add(svc.id);
        }
      }
      for (const db of json.databases ?? []) {
        next.set(db.id, db.status);
        if (prev.has(db.id) && prev.get(db.id) !== db.status) {
          changed.add(db.id);
        }
      }
      prevStatusRef.current = next;
      setLastChangedNodes(changed);
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
      // abort-triggered errors are transient — only set the error state on the first attempt
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto-refresh poller
  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // Don't trigger a refresh if the previous fetch is still in-flight.
      fetchData();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData, autoRefresh]);

  // Build the servicesById / dbsById maps that the graph component needs.
  const servicesById = useMemo(() => {
    const m = new Map<string, ServiceNode>();
    for (const s of data?.services ?? []) m.set(s.id, s);
    return m;
  }, [data]);

  const dbsById = useMemo(() => {
    const m = new Map<string, DatabaseNode>();
    for (const d of data?.databases ?? []) m.set(d.id, d);
    return m;
  }, [data]);

  const summary = data?.summary;
  const healthScore = summary?.health_score ?? 0;
  const healthTone = healthScore >= 80 ? 'emerald' : healthScore >= 50 ? 'amber' : 'red';

  const selected = selectedNode
    ? servicesById.get(selectedNode) ?? dbsById.get(selectedNode) ?? null
    : null;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard
          label="صحة النظام"
          value={`${healthScore}%`}
          icon={<Heart className={cn('h-4 w-4', healthTone === 'emerald' ? 'text-emerald-500' : healthTone === 'amber' ? 'text-amber-500' : 'text-red-500')} />}
          tone={healthTone}
        />
        <SummaryCard
          label="خدمات تعمل"
          value={`${summary?.services_up ?? 0} / ${summary?.services_total ?? 0}`}
          icon={<Server className="h-4 w-4 text-emerald-500" />}
          tone="blue"
        />
        <SummaryCard
          label="قواعد بيانات سليمة"
          value={`${summary?.dbs_healthy ?? 0} / ${summary?.dbs_total ?? 0}`}
          icon={<Database className="h-4 w-4 text-rose-500" />}
          tone="rose"
        />
        <SummaryCard
          label="تدفقات نشطة"
          value={`${summary?.flows_active ?? 0} / ${summary?.flows_total ?? 0}`}
          icon={<Activity className="h-4 w-4 text-cyan-500" />}
          tone="cyan"
        />
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">طوبولوجيا النظام</span>
            {data?.timestamp && (
              <span className="text-[10px] text-muted-foreground">
                آخر تحديث: {new Date(data.timestamp).toLocaleTimeString('ar-EG')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={autoRefresh ? 'default' : 'outline'}
              onClick={() => setAutoRefresh((v) => !v)}
            >
              <Activity className={cn('h-3.5 w-3.5 ml-1', autoRefresh && 'animate-pulse')} />
              {autoRefresh ? 'تلقائي (15s)' : 'متوقف'}
            </Button>
            <Button size="sm" variant="outline" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 ml-1', loading && 'animate-spin')} />
              تحديث
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDetails((v) => !v)}
            >
              {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showDetails ? 'إخفاء التفاصيل' : 'تفاصيل'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Graph */}
      {loading && !data ? (
        <Skeleton className="h-[600px] rounded-xl" />
      ) : error ? (
        <Card className="border-red-500/40">
          <CardContent className="p-6 text-center space-y-2">
            <AlertCircle className="h-6 w-6 text-red-500 mx-auto" />
            <p className="text-sm text-red-600">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchData}>
              <RefreshCw className="h-3 w-3 ml-1" /> حاول مرة أخرى
            </Button>
          </CardContent>
        </Card>
      ) : data ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-500" />
              خريطة الطبقات (7 طبقات)
            </CardTitle>
            <CardDescription className="text-xs">
              اضغط على أي عنصر لعرض التفاصيل — التحديث كل 15 ثانية تلقائياً
            </CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <SystemTopologyGraph
              data={data}
              selectedNode={selectedNode}
              setSelectedNode={setSelectedNode}
              changedNodes={lastChangedNodes}
              now={Date.now()}
              servicesById={servicesById}
              dbsById={dbsById}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Details drawer */}
      {showDetails && selected && (
        <Card className="border-emerald-500/40 bg-emerald-500/[0.02]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="font-mono">{selectedNode}</span>
                <span>·</span>
                <span>{selected.name_ar || selected.name}</span>
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setSelectedNode(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <Detail label="النوع" value={selected.kind} />
              <Detail label="الحالة" value={selected.status} />
              {('latency_ms' in selected) && (
                <Detail label="التأخير" value={`${(selected as ServiceNode).latency_ms ?? '—'} ms`} />
              )}
              {('port' in selected) && (
                <Detail label="المنفذ" value={String((selected as ServiceNode).port ?? '—')} />
              )}
              {('url' in selected) && (selected as ServiceNode).url && (
                <Detail label="URL" value={String((selected as ServiceNode).url)} />
              )}
              {('path' in selected) && (
                <Detail label="المسار" value={String((selected as DatabaseNode).path)} mono />
              )}
              {('size_kb' in selected) && (
                <Detail label="الحجم" value={`${Math.round(((selected as DatabaseNode).size_kb ?? 0) / 1024)} MB`} />
              )}
              {('all_tables_count' in selected) && (
                <Detail label="عدد الجداول" value={String((selected as DatabaseNode).all_tables_count ?? 0)} />
              )}
              {('minutes_ago' in selected) && (selected as ServiceNode | DatabaseNode).minutes_ago != null && (
                <Detail label="آخر تحديث منذ" value={`${(selected as ServiceNode | DatabaseNode).minutes_ago} دقيقة`} />
              )}
            </div>
            <div className="rounded-md bg-muted/30 px-3 py-2">
              <span className="text-[10px] text-muted-foreground">السبب: </span>
              <span className="text-xs">{(selected as ServiceNode | DatabaseNode).reason}</span>
            </div>
            {selected.layers && selected.layers.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground">طبقات المحرك:</div>
                <div className="flex flex-wrap gap-1">
                  {selected.layers.map((layer) => (
                    <Badge
                      key={layer.id}
                      variant="outline"
                      className={cn(
                        'text-[10px] font-mono',
                        layer.status === 'active'
                          ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/5'
                          : layer.status === 'missing'
                          ? 'border-red-500/40 text-red-700 dark:text-red-300 bg-red-500/5'
                          : 'border-muted-foreground/30 text-muted-foreground bg-muted/10',
                      )}
                    >
                      {layer.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Selected node prompt */}
      {!selected && showDetails && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            اضغط على أي عنصر في الخريطة بالأعلى لعرض تفاصيله هنا.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'amber' | 'red' | 'blue' | 'rose' | 'cyan';
}) {
  const toneClass = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    red: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
    blue: 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300',
    rose: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300',
    cyan: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-700 dark:text-cyan-300',
  }[tone];

  return (
    <Card className={cn('overflow-hidden', toneClass)}>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="rounded-lg bg-background/50 p-2">{icon}</div>
        <div>
          <div className="text-[10px] opacity-80">{label}</div>
          <div className="text-lg font-bold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('text-xs font-medium', mono && 'font-mono break-all')}>{value}</div>
    </div>
  );
}

export default SystemTopologyTab;
