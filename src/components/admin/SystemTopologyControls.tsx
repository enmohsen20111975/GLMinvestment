'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
    Activity, AlertTriangle, CheckCircle2, Clock, Database, Loader2,
    RefreshCw, Server, Wifi, WifiOff, XCircle, Zap, Brain, Cpu,
    Network, ArrowRight, ChevronDown, ChevronUp, Info, Boxes,
    CircuitBoard, HardDrive, Radio, Globe, Eye, AlertCircle,
    Target, Layers, Heart, Shield, FlaskConical, GitBranch,
    Gauge, Sparkles, Timer, Waypoints,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
    TopologyData,
    getStatusColor,
    formatLiveSeconds,
} from './SystemTopologyGraph';

// ============== Helper (re-used) ==============

function formatTimeAgo(minutesAgo: number | null): string {
    if (minutesAgo === null) return 'غير معروف';
    if (minutesAgo < 1) return 'الآن';
    if (minutesAgo < 60) return `منذ ${minutesAgo} دقيقة`;
    const hours = Math.floor(minutesAgo / 60);
    const mins = minutesAgo % 60;
    if (hours < 24) return `منذ ${hours} س${mins > 0 ? ` و${mins} د` : ''}`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
}

function formatSize(kb: number): string {
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

function getServiceIcon(kind: string) {
    switch (kind) {
        case 'frontend': return <Globe className="w-5 h-5" />;
        case 'backend': return <Server className="w-5 h-5" />;
        case 'data-engine': return <CircuitBoard className="w-5 h-5" />;
        case 'ws-service': return <Radio className="w-5 h-5" />;
        case 'glminvestment-engines': return <Brain className="w-5 h-5" />;
        case 'prediction-engine': return <Target className="w-5 h-5" />;
        case 'analytics-engine': return <Cpu className="w-5 h-5" />;
        case 'risk-engine': return <Shield className="w-5 h-5" />;
        case 'backtest-engine': return <FlaskConical className="w-5 h-5" />;
        case 'confluence-engine': return <GitBranch className="w-5 h-5" />;
        default: return <Boxes className="w-5 h-5" />;
    }
}

// ============== Props ==============

interface SystemTopologyControlsProps {
    data: TopologyData;
    loading: boolean;
    lastUpdate: Date | null;
    secondsSinceUpdate: number;
    fetchTopology: () => void;
    selectedNode: string | null;
    setSelectedNode: (id: string | null) => void;
    changedNodes: Set<string>;
    now: number;
    refreshInterval: number;
    graphSlot: React.ReactNode;
}

// ============== Component ==============

export function SystemTopologyControls({
    data,
    loading,
    lastUpdate,
    secondsSinceUpdate,
    fetchTopology,
    selectedNode,
    setSelectedNode,
    changedNodes,
    now,
    refreshInterval,
    graphSlot,
}: SystemTopologyControlsProps) {

    const { summary } = data;
    const servicesById = Object.fromEntries(data.services.map(s => [s.id, s]));
    const dbsById = Object.fromEntries(data.databases.map(d => [d.id, d]));

    // ============== Detail panel ==============

    function renderDetailPanel() {
        if (!selectedNode) return null;
        const svc = servicesById[selectedNode] as any;
        const db = dbsById[selectedNode] as any;

        if (selectedNode === 'sources') {
            const dataEng = servicesById['data-engine'] as any;
            const scrapers = dataEng?.layers || [];
            return (
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-1"
                >
                    <Card className="border-2 border-purple-400">
                        <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    <Globe className="w-5 h-5 text-purple-500" />
                                    <CardTitle className="text-base">مصادر البيانات</CardTitle>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)} className="h-7 w-7 p-0">
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </div>
                            <CardDescription className="font-mono text-xs">External data sources + 10 scrapers</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                <div className="font-medium mb-2">🌐 المصادر الخارجية</div>
                                <ul className="space-y-1 text-muted-foreground">
                                    <li>• <strong>TradingView</strong> — أسعار الأسهم والمؤشرات</li>
                                    <li>• <strong>CoinGecko</strong> — أسعار العملات الرقمية</li>
                                    <li>• <strong>Investing</strong> — المعادن والفوركس والأخبار</li>
                                    <li>• <strong>Yahoo Finance</strong> — البيانات التاريخية (5 سنوات)</li>
                                    <li>• <strong>EGX Official</strong> — شعارات وأخبار البورصة المصرية</li>
                                </ul>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium">📥 الساحبات (Scrapers)</span>
                                    <Badge variant="outline" className="text-[10px]">
                                        {scrapers.filter((s: any) => s.status === 'active').length}/{scrapers.length}
                                    </Badge>
                                </div>
                                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                                    {scrapers.map((s: any) => (
                                        <div key={s.id} className="p-2 rounded bg-background/50 border border-border/50">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <span className="font-mono text-[11px] font-medium">{s.name_ar}</span>
                                                <Badge variant={s.status === 'active' ? 'default' : 'destructive'} className="text-[9px] h-4">
                                                    {s.status === 'active' ? 'موجود' : 'مفقود'}
                                                </Badge>
                                            </div>
                                            <div className="font-mono text-[10px] text-muted-foreground truncate">{s.name}</div>
                                            <div className="text-[10px] text-muted-foreground mt-0.5">{s.description}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            );
        }

        if (svc) {
            const color = getStatusColor(svc.status);
            return (
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-1"
                >
                    <Card className={cn('border-2', color.border)}>
                        <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    {getServiceIcon(svc.kind)}
                                    <CardTitle className="text-base">{svc.name_ar}</CardTitle>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)} className="h-7 w-7 p-0">
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </div>
                            <CardDescription className="font-mono text-xs">{svc.name}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">الحالة</span>
                                <Badge className={cn(color.bg, 'text-white')}>{color.label}</Badge>
                            </div>
                            {svc.port && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">المنفذ</span>
                                    <span className="font-mono">:{svc.port}</span>
                                </div>
                            )}
                            {svc.url && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">URL</span>
                                    <span className="font-mono text-xs truncate max-w-[180px]">{svc.url}</span>
                                </div>
                            )}
                            {svc.latency_ms > 0 && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">زمن الاستجابة</span>
                                    <span className="font-mono">{svc.latency_ms}ms</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">آخر تحديث</span>
                                <span className="font-mono text-xs tabular-nums">
                                    {svc.last_update
                                        ? formatLiveSeconds(svc.last_update, now)
                                        : formatTimeAgo(svc.minutes_ago)}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/50 text-xs">
                                <div className="flex items-center gap-1 text-amber-600 font-medium mb-1">
                                    <Info className="w-3.5 h-3.5" />
                                    السبب
                                </div>
                                <p className="text-muted-foreground">{svc.reason}</p>
                            </div>
                            {svc.layers && svc.layers.length > 0 && (
                                <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                    <div className="flex items-center gap-1 font-medium mb-2">
                                        <Layers className="w-3.5 h-3.5 text-emerald-500" />
                                        الطبقات ({svc.layers.filter((l: any) => l.status === 'active').length}/{svc.layers.length})
                                    </div>
                                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                                        {svc.layers.map((layer: any) => (
                                            <div key={layer.id} className="p-2 rounded bg-background/50 border border-border/50">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <span className="font-mono text-[11px] font-medium">{layer.name_ar}</span>
                                                    <Badge variant={layer.status === 'active' ? 'default' : 'destructive'} className="text-[9px] h-4">
                                                        {layer.status === 'active' ? 'موجود' : 'مفقود'}
                                                    </Badge>
                                                </div>
                                                <div className="font-mono text-[10px] text-muted-foreground truncate">{layer.name}</div>
                                                <div className="text-[10px] text-muted-foreground mt-0.5">{layer.description}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {svc.details && Object.keys(svc.details).length > 0 && (
                                <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                    <div className="font-medium mb-1">تفاصيل</div>
                                    <pre className="text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-48">
                                        {JSON.stringify(svc.details, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            );
        }

        if (db) {
            const color = getStatusColor(db.status);
            return (
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-1"
                >
                    <Card className={cn('border-2', color.border, db.is_heart && 'ring-2 ring-rose-400')}>
                        <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    {db.is_heart ? <Heart className="w-5 h-5 text-rose-500" /> : <Database className="w-5 h-5" />}
                                    <CardTitle className="text-base">{db.name}</CardTitle>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)} className="h-7 w-7 p-0">
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </div>
                            <CardDescription className="font-mono text-xs">
                                {db.is_heart ? '💗 قلب النظام (HEART)' : db.kind}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">الحالة</span>
                                <Badge className={cn(color.bg, 'text-white')}>{color.label}</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">الحجم</span>
                                <span className="font-mono">{db.exists ? formatSize(db.size_kb) : '—'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">عدد الجداول</span>
                                <span className="font-mono">{db.exists ? db.all_tables_count : '—'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">آخر كتابة</span>
                                <span className="font-mono text-xs tabular-nums">
                                    {db.last_write
                                        ? formatLiveSeconds(db.last_write, now)
                                        : formatTimeAgo(db.minutes_ago)}
                                </span>
                            </div>
                            {db.last_modified && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">آخر تعديل للملف</span>
                                    <span className="font-mono text-xs">{new Date(db.last_modified).toLocaleString('ar-EG')}</span>
                                </div>
                            )}
                            <div className="p-3 rounded-lg bg-muted/50 text-xs">
                                <div className="flex items-center gap-1 text-amber-600 font-medium mb-1">
                                    <Info className="w-3.5 h-3.5" />
                                    السبب
                                </div>
                                <p className="text-muted-foreground">{db.reason}</p>
                            </div>
                            <div>
                                <div className="text-xs font-medium mb-2 text-muted-foreground">
                                    الجداول ({db.tables.length}{db.all_tables_count > db.tables.length ? ` من ${db.all_tables_count}` : ''})
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                                    {db.tables.map((t: any) => (
                                        <div key={t.name} className="flex items-center justify-between p-2 rounded bg-muted/30 text-xs">
                                            <span className="font-mono truncate flex items-center gap-1">
                                                {!t.expected && <span className="text-[9px] text-emerald-500" title="جدول إضافى">+</span>}
                                                {t.name}
                                            </span>
                                            <Badge variant={t.rows === -1 ? 'destructive' : t.rows === 0 ? 'outline' : 'secondary'} className="text-[10px]">
                                                {t.rows === -1 ? 'مفقود' : t.rows.toLocaleString()}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            );
        }

        return null;
    }

    return (
        <>
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className={cn(
                        'w-12 h-12 rounded-xl flex items-center justify-center',
                        summary.health_score >= 80 ? 'bg-emerald-100 dark:bg-emerald-900/30' :
                            summary.health_score >= 50 ? 'bg-amber-100 dark:bg-amber-900/30' :
                                'bg-red-100 dark:bg-red-900/30'
                    )}>
                        <Network className={cn(
                            'w-6 h-6',
                            summary.health_score >= 80 ? 'text-emerald-600' :
                                summary.health_score >= 50 ? 'text-amber-600' :
                                    'text-red-600'
                        )} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">المخطط الهندسى الحى للنظام</h2>
                        <p className="text-xs text-muted-foreground" dir="rtl">
                            {lastUpdate
                                ? <>آخر تحديث: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">منذ {secondsSinceUpdate} ثانية</span> ({lastUpdate.toLocaleTimeString('ar-EG')}) · يتجدد كل 10 ثوانٍ</>
                                : 'يتجدد كل 10 ثوانٍ'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={fetchTopology} disabled={loading}>
                        <RefreshCw className={cn('w-4 h-4 ml-1', loading && 'animate-spin')} />
                        تحديث الآن
                    </Button>
                </div>
            </div>

            {/* Live status bar */}
            <Card className="border-2 border-emerald-300 dark:border-emerald-800 bg-gradient-to-l from-emerald-50/60 via-transparent to-transparent dark:from-emerald-900/15">
                <CardContent className="p-3">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" dir="rtl">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                            <span className="relative flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                            </span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 tracking-wide">LIVE</span>
                        </div>
                        <div className="flex items-center gap-1.5" title="الوقت الحالى">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="font-mono text-xs tabular-nums">
                                {new Date(now).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5" title="آخر تحديث من الخادم">
                            <Timer className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs">
                                آخر تحديث: <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">منذ {secondsSinceUpdate} ثانية</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2 min-w-[170px]" title="صحة النظام">
                            <Gauge className={cn(
                                'w-4 h-4',
                                summary.health_score >= 80 ? 'text-emerald-600' :
                                    summary.health_score >= 50 ? 'text-amber-600' : 'text-red-600'
                            )} />
                            <div className="flex-1">
                                <div className="flex justify-between text-[10px] mb-0.5">
                                    <span className="text-muted-foreground">صحة</span>
                                    <span className="font-mono font-bold tabular-nums">{summary.health_score}%</span>
                                </div>
                                <Progress
                                    value={summary.health_score}
                                    className={cn(
                                        'h-1.5 transition-all duration-700',
                                        summary.health_score >= 80 ? '[&>div]:bg-emerald-500' :
                                            summary.health_score >= 50 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'
                                    )}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5" title="التدفقات النشطة">
                            <Waypoints className="w-4 h-4 text-emerald-600" />
                            <span className="font-mono text-xs">
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">{summary.flows_active}</span>
                                <span className="text-muted-foreground">/{summary.flows_total} تدفق</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5" title="المحركات العاملة">
                            <Server className="w-4 h-4 text-emerald-600" />
                            <span className="font-mono text-xs">
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">{summary.services_up}</span>
                                <span className="text-muted-foreground">/{summary.services_total} محرك</span>
                            </span>
                        </div>
                        {changedNodes.size > 0 && (
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30">
                                <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                    {changedNodes.size} عنصر تغيّر
                                </span>
                            </div>
                        )}
                        <div className="flex items-center gap-1.5 mr-auto" title="التحديث القادم خلال">
                            <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', loading && 'animate-spin')} />
                            <span className="text-[11px] text-muted-foreground">
                                التحديث القادم خلال <span className="font-mono font-medium tabular-nums">{Math.max(0, Math.ceil((refreshInterval - secondsSinceUpdate * 1000) / 1000))}ث</span>
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Heart status alert */}
            {summary.heart_exists === false && (
                <div className="p-4 rounded-lg border-2 border-red-400 bg-red-50 dark:bg-red-900/20 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-bold text-red-700 dark:text-red-400">💀 قلب النظام مفقود!</p>
                        <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                            data_engine.db غير موجود — محرك البيانات (port 5000) متوقف أو لم يشتغل قط.
                            هذا هو القلب الذي يغذّي كل النظام. شغّله الآن:
                            <code className="mx-1 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 font-mono text-xs">cd data_engine && python3 main.py</code>
                        </p>
                    </div>
                </div>
            )}

            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">صحة النظام</p>
                                <p className={cn(
                                    'text-2xl font-bold',
                                    summary.health_score >= 80 ? 'text-emerald-600' :
                                        summary.health_score >= 50 ? 'text-amber-600' :
                                            'text-red-600'
                                )}>{summary.health_score}%</p>
                            </div>
                            <Activity className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <Progress value={summary.health_score} className={cn(
                            'mt-2 h-1.5',
                            summary.health_score >= 80 ? '[&>div]:bg-emerald-500' :
                                summary.health_score >= 50 ? '[&>div]:bg-amber-500' :
                                    '[&>div]:bg-red-500'
                        )} />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">المحركات</p>
                                <p className="text-2xl font-bold">
                                    <span className="text-emerald-600">{summary.services_up}</span>
                                    <span className="text-muted-foreground text-base"> / {summary.services_total}</span>
                                </p>
                            </div>
                            <Server className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            {summary.services_up === summary.services_total ? '✅ كل المحركات تعمل' :
                                `${summary.services_total - summary.services_up} محرك متوقف`}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">قواعد البيانات</p>
                                <p className="text-2xl font-bold">
                                    <span className="text-emerald-600">{summary.dbs_healthy}</span>
                                    <span className="text-muted-foreground text-base"> / {summary.dbs_total}</span>
                                </p>
                            </div>
                            <Database className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            {summary.dbs_healthy === summary.dbs_total ? '✅ كل القواعد سليمة' :
                                `${summary.dbs_total - summary.dbs_healthy} قاعدة بها مشاكل`}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">تدفقات البيانات</p>
                                <p className="text-2xl font-bold">
                                    <span className="text-emerald-600">{summary.flows_active}</span>
                                    <span className="text-muted-foreground text-base"> / {summary.flows_total}</span>
                                </p>
                            </div>
                            <Zap className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            {summary.flows_active === summary.flows_total ? '✅ كل التدفقات نشطة' :
                                `${summary.flows_total - summary.flows_active} تدفق مقطوع/متأخر`}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Architecture layers legend */}
            <Card className="bg-gradient-to-r from-purple-50 to-emerald-50 dark:from-purple-900/20 dark:to-emerald-900/20 border-purple-200 dark:border-purple-900">
                <CardContent className="p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-purple-700 dark:text-purple-300">الطبقات المعمارية:</span>
                        <Badge variant="outline" className="bg-white dark:bg-background">L0 مصادر</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L1 Data Engine</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">L2 💗 القلب</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L3 DBs</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L4 Analysis+Prediction</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L5 Risk+Backtest+Confluence</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L6 API</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L7 Frontend</Badge>
                    </div>
                </CardContent>
            </Card>

            {/* Main diagram + detail panel */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <Card className="lg:col-span-3 overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <CircuitBoard className="w-5 h-5 text-emerald-500" />
                            مخطط العمارة المعمارى (7 طبقات)
                        </CardTitle>
                        <CardDescription className="text-xs">
                            اضغط على أي عنصر لعرض التفاصيل · النقاط المتحركة = جسيمات بيانات تتدفق الآن · 💗 = قلب النظام · يتجدد كل 10 ثوانٍ
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        {graphSlot}
                    </CardContent>
                </Card>

                {selectedNode ? renderDetailPanel() : (
                    <Card className="lg:col-span-1">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Info className="w-4 h-4 text-emerald-500" />
                                لوحة التفاصيل
                            </CardTitle>
                            <CardDescription className="text-xs">
                                اضغط على أي عنصر في المخطط لعرض تفاصيله هنا
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">المحركات ({data.services.length})</div>
                                <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
                                    {data.services.map(s => (
                                        <div key={s.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                                            <span className="truncate flex items-center gap-1.5">
                                                {getServiceIcon(s.kind)}
                                                {s.name_ar}
                                            </span>
                                            <Badge variant="outline" className={cn('text-[10px]', getStatusColor(s.status).text)}>
                                                {getStatusColor(s.status).label}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2 pt-2 border-t">
                                <div className="text-xs font-medium text-muted-foreground">قواعد البيانات ({data.databases.length})</div>
                                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                                    {data.databases.map(d => (
                                        <div key={d.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                                            <span className="truncate flex items-center gap-1.5">
                                                {d.is_heart ? <Heart className="w-3 h-3 text-rose-500" /> : <Database className="w-3 h-3" />}
                                                {d.name}
                                            </span>
                                            <Badge variant="outline" className={cn('text-[10px]', getStatusColor(d.status).text)}>
                                                {getStatusColor(d.status).label}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2 pt-2 border-t">
                                <div className="text-xs font-medium text-muted-foreground">إحصائيات الطبقات</div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                    <div>• {data.services.reduce((sum, s) => sum + (s.layers?.filter(l => l.status === 'active').length || 0), 0)} طبقة نشطة في المحركات</div>
                                    <div>• {summary.scrapers_present || 0}/{summary.scrapers_count || 0} ساحب بيانات نشط</div>
                                    <div>• {data.databases.reduce((sum, d) => sum + d.all_tables_count, 0)} جدول إجمالي</div>
                                    <div>• {data.flows.filter(f => f.status === 'flowing').length}/{data.flows.length} تدفق نشط</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Detailed flows table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <ArrowRight className="w-5 h-5 text-purple-500" />
                        تفاصيل تدفقات البيانات
                    </CardTitle>
                    <CardDescription className="text-xs">
                        كل سطر يمثّل تدفق بيانات بين عنصرين — الحالة توضّح هل البيانات تنتقل أم لا ولماذا
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-right text-xs text-muted-foreground">
                                    <th className="p-2 font-medium">من → إلى</th>
                                    <th className="p-2 font-medium">الوصف</th>
                                    <th className="p-2 font-medium">الحالة</th>
                                    <th className="p-2 font-medium">آخر نقل</th>
                                    <th className="p-2 font-medium">السبب</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.flows.map(f => {
                                    const color = getStatusColor(f.status);
                                    return (
                                        <tr key={f.id} className="border-b hover:bg-muted/30">
                                            <td className="p-2 font-mono text-xs">
                                                {f.from} → {f.to}
                                            </td>
                                            <td className="p-2">{f.label_ar}</td>
                                            <td className="p-2">
                                                <Badge variant="outline" className={cn('gap-1', color.text)}>
                                                    <div className={cn('w-2 h-2 rounded-full', color.bg)} />
                                                    {color.label}
                                                </Badge>
                                            </td>
                                            <td className="p-2 text-xs text-muted-foreground font-mono tabular-nums">
                                                {f.last_transfer
                                                    ? formatLiveSeconds(f.last_transfer, now)
                                                    : formatTimeAgo(f.minutes_ago)}
                                            </td>
                                            <td className="p-2 text-xs text-muted-foreground">{f.reason}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </>
    );
}
