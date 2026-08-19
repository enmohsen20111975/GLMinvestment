'use client';

/**
 * LiveTopologyView - المخطط الحي للصفحة الرئيسية
 * =============================================
 * نفس SystemTopologyTab بس للصفحة الرئيسية بدون حاجة لتوكن أدمن.
 * يعرض حالة النظام الكاملة: الخدمات، قواعد البيانات، والمحركات.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { SystemTopologyGraph, TopologyData } from '@/components/admin/SystemTopologyGraph';
import { cn } from '@/lib/utils';

const REFRESH_INTERVAL = 15000;

export function LiveTopologyView() {
    const [data, setData] = useState<TopologyData | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [now, setNow] = useState<number>(() => Date.now());
    const [changedNodes, setChangedNodes] = useState<Set<string>>(new Set());
    const previousDataRef = React.useRef<TopologyData | null>(null);

    const fetchTopology = useCallback(async () => {
        try {
            const res = await fetch('/api/topology', {
                cache: 'no-store',
            });
            if (!res.ok) {
                // Fallback: try admin API
                const adminRes = await fetch('/api/admin/system-topology', { cache: 'no-store' });
                if (!adminRes.ok) return;
                const json = await adminRes.json();
                if (json.success) {
                    processData(json);
                }
                return;
            }
            const json = await res.json();
            if (json.success) {
                processData(json);
            }
        } catch (err) {
            console.warn('Topology fetch failed:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const processData = useCallback((json: any) => {
        const prev = previousDataRef.current;
        if (prev) {
            const changed = new Set<string>();
            prev.services.forEach((s: any) => {
                const next = (json.services as any[])?.find((n: any) => n.id === s.id);
                if (next && next.status !== s.status) changed.add(s.id);
            });
            prev.databases.forEach((d: any) => {
                const next = (json.databases as any[])?.find((n: any) => n.id === d.id);
                if (next && next.status !== d.status) changed.add(d.id);
            });
            if (changed.size > 0) {
                setChangedNodes(prevSet => {
                    const merged = new Set(prevSet);
                    changed.forEach(c => merged.add(c));
                    return merged;
                });
                setTimeout(() => {
                    setChangedNodes(prevSet => {
                        const nextSet = new Set(prevSet);
                        changed.forEach(c => nextSet.delete(c));
                        return nextSet;
                    });
                }, 3500);
            }
        }
        previousDataRef.current = json as TopologyData;
        setData(json);
        setLastUpdate(new Date());
    }, []);

    useEffect(() => {
        fetchTopology();
        let elapsed = 0;
        const interval = setInterval(() => {
            setNow(Date.now());
            elapsed += 1;
            if (elapsed >= REFRESH_INTERVAL / 1000) {
                fetchTopology();
                elapsed = 0;
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [fetchTopology]);

    const secondsSinceUpdate = lastUpdate
        ? Math.max(0, Math.floor((now - lastUpdate.getTime()) / 1000))
        : 0;

    const servicesById = useMemo(() => {
        const map: Record<string, any> = {};
        data?.services.forEach(s => { map[s.id] = s; });
        return map;
    }, [data]);

    const dbsById = useMemo(() => {
        const map: Record<string, any> = {};
        data?.databases.forEach(d => { map[d.id] = d; });
        return map;
    }, [data]);

    // ============== Stats ==============
    const runningCount = data?.services.filter(s => s.status === 'running').length ?? 0;
    const freshDbs = data?.databases.filter(d => d.staleness === 'fresh').length ?? 0;
    const healthScore = data?.health_score ?? 0;

    // ============== Loading ==============
    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-20" dir="rtl">
                <div className="text-center space-y-3">
                    <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto" />
                    <p className="text-muted-foreground">جارٍ تحميل المخطط الهندسى...</p>
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex items-center justify-center py-20" dir="rtl">
                <div className="text-center space-y-3">
                    <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
                    <p className="text-muted-foreground">المخطط الحي يحتاج صلاحيات الأدمن</p>
                    <p className="text-xs text-muted-foreground">يمكنك مشاهدته من لوحة التحكم</p>
                </div>
            </div>
        );
    }

    // ============== Main ==============
    return (
        <div className="space-y-4" dir="rtl">
            {/* Status Bar */}
            <Card className="border-primary/30 bg-gradient-to-l from-primary/5 to-transparent">
                <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">المخطط الحي</span>
                                    <Badge variant="outline" className="text-[10px] font-mono">
                                        {new Date(now).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </Badge>
                                    <Badge variant="secondary" className="text-[10px]">مباشر</Badge>
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                    {lastUpdate ? `آخر تحديث: منذ ${secondsSinceUpdate}ث` : 'جارٍ التحميل...'}
                                    {lastUpdate && ` • التحديث القادم خلال ${Math.max(0, Math.floor(REFRESH_INTERVAL / 1000 - secondsSinceUpdate))}ث`}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-emerald-600">{runningCount}</div>
                                <div className="text-[10px] text-muted-foreground">خدمة تعمل</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-emerald-600">{freshDbs}</div>
                                <div className="text-[10px] text-muted-foreground">قاعدة بيانات نشطة</div>
                            </div>
                            <div className="text-center min-w-[60px]">
                                <div className={cn(
                                    'text-2xl font-bold',
                                    healthScore >= 80 ? 'text-emerald-600' : healthScore >= 50 ? 'text-amber-600' : 'text-red-600'
                                )}>
                                    {healthScore}%
                                </div>
                                <div className="text-[10px] text-muted-foreground">صحة</div>
                            </div>
                            <Button onClick={fetchTopology} disabled={loading} size="sm" variant="outline" className="gap-1">
                                <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
                                تحديث
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Topology Graph */}
            <SystemTopologyGraph
                data={data}
                selectedNode={selectedNode}
                setSelectedNode={setSelectedNode}
                changedNodes={changedNodes}
                now={now}
                servicesById={servicesById}
                dbsById={dbsById}
            />
        </div>
    );
}
