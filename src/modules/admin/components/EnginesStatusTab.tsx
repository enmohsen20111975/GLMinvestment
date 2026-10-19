'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Database,
    Loader2,
    RefreshCw,
    Server,
    Wifi,
    WifiOff,
    XCircle,
    Zap,
    TrendingUp,
    Brain,
    Target,
    ChevronDown,
    ChevronUp,
    Play,
    Square,
    RotateCcw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============== Types ==============

interface EngineStatus {
    name: string;
    name_ar: string;
    port: number;
    url: string;
    running: boolean;
    connection: string;
    latency_ms: number;
    last_update: string | null;
    minutes_ago: number | null;
    staleness: 'fresh' | 'stale' | 'old' | 'unknown';
    errors_count: number;
    recent_logs: string[];
    description: string;
    update_interval: string;
    pm2_name?: string;
    // Data engine specific
    scheduler_active?: boolean;
    scrapers?: {
        stocks: { running: boolean; count: number };
        crypto: { running: boolean; count: number };
        metals: { running: boolean; count: number };
    };
    price_history_last_date?: string | null;
    // Analysis engine specific
    last_analysis?: string | null;
    analysis_count?: number;
    background_analyzer?: boolean;
    // Prediction engine specific
    total_predictions?: number;
    today_predictions?: number;
    signal_distribution?: { signal_type: string; count: number }[];
}

interface EnginesResponse {
    success: boolean;
    timestamp: string;
    summary: {
        all_running: boolean;
        any_running: boolean;
        total_errors: number;
        engines_count: number;
        running_count: number;
    };
    engines: {
        data: EngineStatus;
        analysis: EngineStatus;
        prediction: EngineStatus;
    };
}

const REFRESH_INTERVAL = 10000; // 10 seconds

// ============== Helpers ==============

const STALENESS_CONFIG = {
    fresh: { label: 'حديث', color: 'text-profit', bg: 'bg-profit', border: 'border-profit' },
    stale: { label: 'متأخر', color: 'text-warning', bg: 'bg-warning', border: 'border-warning' },
    old: { label: 'قديم', color: 'text-loss', bg: 'bg-loss', border: 'border-loss' },
    unknown: { label: 'غير معروف', color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border' },
};

const SIGNAL_COLORS: Record<string, string> = {
    STRONG_BUY: 'text-profit',
    BUY: 'text-success',
    ACCUMULATE: 'text-whale',
    HOLD: 'text-warning',
    REDUCE: 'text-warning',
    SELL: 'text-loss',
    STRONG_SELL: 'text-loss',
};

function formatTimeAgo(minutesAgo: number | null): string {
    if (minutesAgo === null) return 'غير معروف';
    if (minutesAgo < 1) return 'الآن';
    if (minutesAgo < 60) return `منذ ${minutesAgo} دقيقة`;
    const hours = Math.floor(minutesAgo / 60);
    const mins = minutesAgo % 60;
    if (hours < 24) return `منذ ${hours} ساعة${mins > 0 ? ` و${mins} دقيقة` : ''}`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
}

function formatDateTime(dateStr: string | null): string {
    if (!dateStr) return '--';
    try {
        return new Date(dateStr).toLocaleString('ar-EG', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

// ============== Engine Card Component ==============

function EngineCard({
    engine,
    icon,
    color,
    expanded,
    onToggle,
    onPm2Action,
    actionLoading,
    onForceUpdate,
    forceLoading,
}: {
    engine: EngineStatus;
    icon: React.ReactNode;
    color: string;
    expanded: boolean;
    onToggle: () => void;
    onPm2Action: (action: string, name: string) => void;
    actionLoading: string | null;
    onForceUpdate: (engineName: string) => void;
    forceLoading: string | null;
}) {
    const stalenessCfg = STALENESS_CONFIG[engine.staleness] || STALENESS_CONFIG.unknown;

    return (
        <Card className={cn('border-2', stalenessCfg.border, engine.running ? '' : 'opacity-75')}>
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', color)}>
                            {icon}
                        </div>
                        <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                                {engine.name_ar}
                                <Badge variant={engine.running ? 'default' : 'destructive'} className="text-xs">
                                    {engine.running ? 'يعمل' : 'متوقف'}
                                </Badge>
                                <span className="text-xs text-muted-foreground mr-auto">
                                    PM2: {engine.pm2_name || engine.name}
                                </span>
                            </CardTitle>
                            <CardDescription className="text-xs">
                                {engine.name} · Port {engine.port}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1.5">
                            {engine.running ? (
                                <Wifi className="w-4 h-4 text-profit" />
                            ) : (
                                <WifiOff className="w-4 h-4 text-loss" />
                            )}
                            <span className={cn('text-xs font-medium', engine.running ? 'text-profit' : 'text-loss')}>
                                {engine.connection === 'connected' ? 'متصل' : engine.connection === 'disconnected' ? 'غير متصل' : 'خطأ'}
                            </span>
                        </div>
                        {engine.latency_ms > 0 && (
                            <span className="text-xs text-muted-foreground">{engine.latency_ms}ms</span>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-3">
                {/* Control Buttons */}
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1 text-profit border-profit hover:bg-profit"
                        onClick={() => onPm2Action('start', engine.pm2_name || engine.name)}
                        disabled={engine.running || actionLoading === `start-${engine.pm2_name || engine.name}`}
                    >
                        <Play className="w-3.5 h-3.5" />
                        {actionLoading === `start-${engine.pm2_name || engine.name}` ? 'جاري...' : 'تشغيل'}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1 text-loss border-loss hover:bg-loss"
                        onClick={() => onPm2Action('stop', engine.pm2_name || engine.name)}
                        disabled={!engine.running || actionLoading === `stop-${engine.pm2_name || engine.name}`}
                    >
                        <Square className="w-3.5 h-3.5" />
                        {actionLoading === `stop-${engine.pm2_name || engine.name}` ? 'جاري...' : 'إيقاف'}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1 text-warning border-warning hover:bg-warning"
                        onClick={() => onPm2Action('restart', engine.pm2_name || engine.name)}
                        disabled={actionLoading === `restart-${engine.pm2_name || engine.name}`}
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {actionLoading === `restart-${engine.pm2_name || engine.name}` ? 'جاري...' : 'إعادة'}
                    </Button>
                </div>

                {/* Force Update Button — يجبر المحرك على جلب بيانات جديدة فوراً */}
                <Button
                    variant="default"
                    size="sm"
                    className={cn(
                        'w-full gap-1.5 font-semibold',
                        engine.name === 'Data Engine' ? 'bg-primary hover:bg-primary' :
                        engine.name === 'Analysis Engine' ? 'bg-primary hover:bg-primary' :
                        'bg-profit hover:bg-profit'
                    )}
                    onClick={() => onForceUpdate(engine.name)}
                    disabled={forceLoading === engine.name}
                >
                    {forceLoading === engine.name ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> جارٍ التحديث الإجباري...</>
                    ) : (
                        <><Zap className="w-4 h-4" /> تحديث إجباري للبيانات</>
                    )}
                </Button>

                {/* Description */}
                <p className="text-sm text-muted-foreground">{engine.description}</p>

                {/* Status Grid */}
                <div className="grid grid-cols-2 gap-3">
                    {/* Last Update */}
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                        <Clock className="w-4 h-4 text-primary flex-shrink-0" />
                        <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">آخر تحديث</div>
                            <div className="text-sm font-medium truncate">{formatTimeAgo(engine.minutes_ago)}</div>
                        </div>
                    </div>

                    {/* Staleness */}
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                        <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', stalenessCfg.bg)} />
                        <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">حالة البيانات</div>
                            <div className={cn('text-sm font-medium', stalenessCfg.color)}>{stalenessCfg.label}</div>
                        </div>
                    </div>

                    {/* Update Interval */}
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                        <RefreshCw className="w-4 h-4 text-primary flex-shrink-0" />
                        <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">معدل التحديث</div>
                            <div className="text-sm font-medium truncate">{engine.update_interval}</div>
                        </div>
                    </div>

                    {/* Errors */}
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                        {engine.errors_count > 0 ? (
                            <AlertTriangle className="w-4 h-4 text-loss flex-shrink-0" />
                        ) : (
                            <CheckCircle2 className="w-4 h-4 text-profit flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">الأخطاء</div>
                            <div className={cn('text-sm font-medium', engine.errors_count > 0 ? 'text-loss' : 'text-profit')}>
                                {engine.errors_count} خطأ
                            </div>
                        </div>
                    </div>
                </div>

                {/* Engine-specific info */}
                {engine.name === 'Data Engine' && engine.scrapers && (
                    <div className="grid grid-cols-3 gap-2">
                        {Object.entries(engine.scrapers).map(([key, val]) => (
                            <div key={key} className={cn('p-2 rounded-lg border text-center', val.running ? 'border-profit bg-profit dark:bg-profit/20' : 'border-border')}>
                                <div className="text-xs text-muted-foreground capitalize">{key}</div>
                                <div className="flex items-center justify-center gap-1 mt-0.5">
                                    <div className={cn('w-2 h-2 rounded-full', val.running ? 'bg-profit' : 'bg-loss')} />
                                    <span className="text-sm font-bold">{val.count.toLocaleString()}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {engine.name === 'Analysis Engine' && (
                    <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded-lg bg-muted/50 text-center">
                            <div className="text-xs text-muted-foreground">عدد التحليلات</div>
                            <div className="text-lg font-bold text-primary">{(engine.analysis_count || 0).toLocaleString()}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/50 text-center">
                            <div className="text-xs text-muted-foreground">Background Analyzer</div>
                            <div className={cn('text-lg font-bold', engine.background_analyzer ? 'text-profit' : 'text-loss')}>
                                {engine.background_analyzer ? 'نشط' : 'متوقف'}
                            </div>
                        </div>
                    </div>
                )}

                {engine.name === 'Prediction Engine' && (
                    <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 rounded-lg bg-muted/50 text-center">
                                <div className="text-xs text-muted-foreground">توقعات اليوم</div>
                                <div className="text-lg font-bold text-primary">{engine.today_predictions || 0}</div>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/50 text-center">
                                <div className="text-xs text-muted-foreground">إجمالي التوقعات</div>
                                <div className="text-lg font-bold text-primary">{(engine.total_predictions || 0).toLocaleString()}</div>
                            </div>
                        </div>
                        {engine.signal_distribution && engine.signal_distribution.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {engine.signal_distribution.map((s) => (
                                    <Badge key={s.signal_type} variant="outline" className={cn('text-xs', SIGNAL_COLORS[s.signal_type] || '')}>
                                        {s.signal_type}: {s.count}
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Last update timestamp */}
                {engine.last_update && (
                    <div className="text-xs text-muted-foreground text-center">
                        📅 {formatDateTime(engine.last_update)}
                    </div>
                )}

                {/* Logs toggle */}
                {engine.recent_logs && engine.recent_logs.length > 0 && (
                    <div>
                        <button
                            onClick={onToggle}
                            className="flex items-center justify-between w-full p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                        >
                            <span className="text-xs font-medium flex items-center gap-1">
                                <Activity className="w-3 h-3" />
                                السجلات ({engine.recent_logs.length})
                            </span>
                            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {expanded && (
                            <div className="mt-2 bg-slate-900 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-xs">
                                {engine.recent_logs.map((log, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            'py-0.5',
                                            log.includes('✅') || log.includes('success') ? 'text-profit' :
                                                log.includes('❌') || log.includes('error') || log.includes('ERROR') ? 'text-loss' :
                                                    log.includes('⚠️') || log.includes('WARNING') ? 'text-warning' :
                                                        'text-slate-300'
                                        )}
                                    >
                                        {log}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ============== Main Component ==============

export function EnginesStatusTab() {
    const [data, setData] = useState<EnginesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [expandedEngine, setExpandedEngine] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [forceLoading, setForceLoading] = useState<string | null>(null);

    const handlePm2Action = async (action: string, processName: string) => {
        const key = `${action}-${processName}`;
        setActionLoading(key);
        try {
            const res = await fetch('/api/admin/pm2-control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, process_name: processName }),
            });
            const json = await res.json();
            if (json.success) {
                toast.success(`✅ تم ${action === 'start' ? 'تشغيل' : action === 'stop' ? 'إيقاف' : 'إعادة تشغيل'} ${processName}`);
                // Refresh status after 2 seconds
                setTimeout(() => fetchData(), 2000);
            } else {
                toast.error(`❌ فشل: ${json.error || json.output}`);
            }
        } catch (e: any) {
            toast.error(`❌ خطأ: ${e.message}`);
        } finally {
            setActionLoading(null);
        }
    };

    // ====== Force Update Handler ======
    // يجبر المحرك على جلب بيانات جديدة فوراً (تحديث إجباري)
    const handleForceUpdate = async (engineName: string) => {
        setForceLoading(engineName);
        toast.info(`🔄 بدأ التحديث الإجباري لـ ${engineName === 'Data Engine' ? 'محرك البيانات' : engineName === 'Analysis Engine' ? 'محرك التحليلات' : 'محرك التوقعات'}...`);
        try {
            // تحديد الإجراء المناسب لكل محرك
            // Data Engine → trigger_all (يجلب كل الأسعار)
            // Analysis Engine → trigger analyzer عبر VPS
            // Prediction Engine → ✅ DISABLED (PHASE4-APIS): /api/admin/generate-predictions
            //   is 410 Gone. Predictions now auto-generate via cron (daily_predictor.py).
            //   No manual trigger — show guidance toast and skip the fetch.
            if (engineName === 'Prediction Engine') {
                toast.info(
                    'التوقعات تُولّد تلقائيًا عبر cron (daily_predictor.py) — لا حاجة لتشغيل يدوي.',
                    { description: 'مسار /api/admin/generate-predictions معطّل (410 Gone).' }
                );
                return;
            }

            let endpoint = '/api/data-engine/control';
            let body: any = { action: 'trigger_all' };

            if (engineName === 'Analysis Engine') {
                endpoint = '/api/admin/daily-analysis';
                body = { force: true };
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (json.success) {
                toast.success(`✅ تم التحديث الإجباري بنجاح${json.message ? ` — ${json.message}` : ''}`);
                // Refresh status after 3 seconds to show new timestamps
                setTimeout(() => fetchData(), 3000);
            } else {
                toast.error(`❌ فشل التحديث: ${json.error || 'استجابة غير متوقعة'}`);
            }
        } catch (e: any) {
            toast.error(`❌ خطأ في التحديث الإجباري: ${e.message}`);
        } finally {
            setForceLoading(null);
        }
    };

    // ====== Force Update ALL Engines (زر شامل) ======
    const handleForceUpdateAll = async () => {
        setForceLoading('ALL');
        toast.info('🔄 بدأ التحديث الإجباري الشامل لكل المحركات...');
        try {
            // 1) Data Engine
            await fetch('/api/data-engine/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'trigger_all' }),
            });
            // 2) Predictions — ✅ DISABLED (PHASE4-APIS): /api/admin/generate-predictions
            //    is 410 Gone. Predictions auto-generate via cron (daily_predictor.py).
            //    Skipped — no manual trigger (Rule 27: no call to dead endpoint).
            toast.info(
                'التوقعات تُولّد تلقائيًا عبر cron (daily_predictor.py) — تخطي التحديث اليدوي.',
                { description: 'مسار /api/admin/generate-predictions معطّل (410 Gone).' }
            );
            toast.success('✅ تم تحديث البيانات والتحليلات — التوقعات تُولّد تلقائيًا عبر cron');
            setTimeout(() => fetchData(), 3000);
        } catch (e: any) {
            toast.error(`❌ خطأ: ${e.message}`);
        } finally {
            setForceLoading(null);
        }
    };

    const fetchData = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch('/api/admin/engines-status');
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const json = await res.json();
            if (json.success) {
                setData(json);
            }
        } catch (error: any) {
            console.error('Fetch engines status error:', error);
            setError(error.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchData();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-profit" />
                <span className="ml-3 text-lg text-profit font-bold">جاري تحميل حالة المحركات...</span>
            </div>
        );
    }

    if (!data) {
        return (
            <Card>
                <CardContent className="py-12 text-center">
                    <XCircle className="w-12 h-12 mx-auto text-loss mb-3" />
                    <p className="text-muted-foreground">تعذر تحميل حالة المحركات</p>
                    {error && <p className="text-sm text-loss mt-2">{error}</p>}
                    <Button onClick={handleRefresh} className="mt-4" variant="outline">
                        <RefreshCw className="w-4 h-4 ml-2" /> إعادة المحاولة
                    </Button>
                </CardContent>
            </Card>
        );
    }

    const { summary, engines } = data;
    if (!summary || !engines) {
        return (
            <Card>
                <CardContent className="py-12 text-center">
                    <XCircle className="w-12 h-12 mx-auto text-loss mb-3" />
                    <p className="text-muted-foreground">تعذر تحميل حالة المحركات</p>
                    <Button onClick={handleRefresh} className="mt-4" variant="outline">
                        <RefreshCw className="w-4 h-4 ml-2" /> إعادة المحاولة
                    </Button>
                </CardContent>
            </Card>
        );
    }
    const healthScore = Math.round((summary.running_count / summary.engines_count) * 100);

    return (
        <div className="space-y-4" dir="rtl">
            {/* Header / Summary */}
            <Card>
                <CardContent className="p-6">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                            <div className={cn(
                                'w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold',
                                healthScore === 100 ? 'bg-profit text-profit dark:bg-profit/30' :
                                    healthScore >= 66 ? 'bg-warning text-warning dark:bg-warning/30' :
                                        'bg-loss text-loss dark:bg-loss/30'
                            )}>
                                {healthScore}%
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">حالة المحركات</h2>
                                <p className="text-sm text-muted-foreground">
                                    {summary.running_count} من {summary.engines_count} محركات تعمل
                                    {summary.total_errors > 0 && ` · ${summary.total_errors} أخطاء`}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {summary.all_running ? (
                                <Badge className="gap-1 bg-profit">
                                    <CheckCircle2 className="w-3 h-3" /> الكل يعمل
                                </Badge>
                            ) : (
                                <Badge variant="destructive" className="gap-1">
                                    <AlertTriangle className="w-3 h-3" /> يوجد مشاكل
                                </Badge>
                            )}
                            <Button
                                variant="default"
                                size="sm"
                                className="gap-1.5 bg-warning hover:bg-warning font-semibold"
                                onClick={handleForceUpdateAll}
                                disabled={forceLoading === 'ALL'}
                            >
                                {forceLoading === 'ALL' ? (
                                    <><RefreshCw className="w-4 h-4 animate-spin" /> جارٍ التحديث الشامل...</>
                                ) : (
                                    <><Zap className="w-4 h-4" /> تحديث إجباري شامل</>
                                )}
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                                <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
                            </Button>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <Progress
                        value={healthScore}
                        className={cn(
                            'mt-4 h-2',
                            healthScore === 100 ? '[&>div]:bg-profit' :
                                healthScore >= 66 ? '[&>div]:bg-warning' :
                                    '[&>div]:bg-loss'
                        )}
                    />

                    {/* Auto-refresh indicator */}
                    <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        تحديث تلقائي كل {REFRESH_INTERVAL / 1000} ثانية
                    </div>
                </CardContent>
            </Card>

            {/* Three Engine Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <EngineCard
                    engine={{ ...engines.data, pm2_name: engines.data.pm2_name || 'data-engine' }}
                    icon={<Database className="w-6 h-6 text-primary" />}
                    color="bg-primary dark:bg-primary/30"
                    expanded={expandedEngine === 'data'}
                    onToggle={() => setExpandedEngine(expandedEngine === 'data' ? null : 'data')}
                    onPm2Action={handlePm2Action}
                    actionLoading={actionLoading}
                    onForceUpdate={handleForceUpdate}
                    forceLoading={forceLoading}
                />
                <EngineCard
                    engine={{ ...engines.analysis, pm2_name: engines.analysis.pm2_name || 'python-backend' }}
                    icon={<Brain className="w-6 h-6 text-primary" />}
                    color="bg-primary dark:bg-primary/30"
                    expanded={expandedEngine === 'analysis'}
                    onToggle={() => setExpandedEngine(expandedEngine === 'analysis' ? null : 'analysis')}
                    onPm2Action={handlePm2Action}
                    actionLoading={actionLoading}
                    onForceUpdate={handleForceUpdate}
                    forceLoading={forceLoading}
                />
                <EngineCard
                    engine={{ ...engines.prediction, pm2_name: engines.prediction.pm2_name || 'python-backend' }}
                    icon={<Target className="w-6 h-6 text-profit" />}
                    color="bg-profit dark:bg-profit/30"
                    expanded={expandedEngine === 'prediction'}
                    onToggle={() => setExpandedEngine(expandedEngine === 'prediction' ? null : 'prediction')}
                    onPm2Action={handlePm2Action}
                    actionLoading={actionLoading}
                    onForceUpdate={handleForceUpdate}
                    forceLoading={forceLoading}
                />
            </div>

            {/* Architecture Info */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Server className="w-5 h-5 text-primary" />
                        معمارية النظام
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="p-3 rounded-lg bg-primary dark:bg-primary/20 border border-primary">
                            <div className="flex items-center gap-2 mb-1">
                                <Database className="w-4 h-4 text-primary" />
                                <span className="font-medium text-sm">محرك البيانات</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                يجلب الأسعار من المصادر (TradingView, Yahoo, Binance) ويخزنها في قاعدة البيانات
                            </p>
                        </div>
                        <div className="p-3 rounded-lg bg-primary dark:bg-primary/20 border border-purple-200">
                            <div className="flex items-center gap-2 mb-1">
                                <Brain className="w-4 h-4 text-primary" />
                                <span className="font-medium text-sm">محرك التحليلات</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                يحلل البيانات فنياً وأساسياً (RSI, MACD, Patterns, Fibonacci) وينتج إشارات
                            </p>
                        </div>
                        <div className="p-3 rounded-lg bg-profit dark:bg-profit/20 border border-profit">
                            <div className="flex items-center gap-2 mb-1">
                                <Target className="w-4 h-4 text-profit" />
                                <span className="font-medium text-sm">محرك التوقعات</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                يولّد التوقعات والأسعار المستهدفة ووقف الخسارة بناءً على التحليلات
                            </p>
                        </div>
                    </div>

                    <div className="mt-3 p-3 rounded-lg bg-warning dark:bg-warning/20 border border-warning">
                        <div className="flex items-start gap-2">
                            <Zap className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-muted-foreground">
                                <strong className="text-warning dark:text-warning">ملاحظة:</strong> المحركات الثلاثة تعمل معاً.
                                محرك البيانات يجلب الأسعار كل 5-10 دقائق، ومحرك التحليلات يعمل كل ساعة (كامل) + كل 5 دقائق (تزايدي)،
                                ومحرك التوقعات من المفترض أن يحدّث كل 15 دقيقة. إذا كانت شاشة التحليلات ثابتة، تأكد من أن المحركات تعمل.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}