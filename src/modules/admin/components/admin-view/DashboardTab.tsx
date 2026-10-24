/**
 * admin-view/DashboardTab.tsx
 * ==========================
 * The default `dashboard` tab content. Composes:
 *  1. System Health card (color-coded by healthScore, with Progress bar).
 *  2. Quick Stats card (4 metrics: users, active stocks, predictions, success %).
 *  3. PurgeCacheButton (Phase 9).
 *  4. Data Status by Market card (per-source freshness grid + refresh button).
 *  5. Quick Actions card (sync / multi-market sync / generate predictions info
 *     toast / learning hub / command center / databases).
 *  6. Services Status mini-card (3 services: VPS / DB / Data Freshness).
 *  7. SystemHealthCard (Task 28-B Fix 9 — /api/admin/system-health).
 *  8. Mini Command Center preview card.
 *
 * Originally inlined inside AdminView (lines ~1365-1646, ~280 LOC).
 */

'use client';

import React from 'react';
import {
 Activity, BarChart3, Brain, Database, Loader2, RefreshCw, Server,
 Sparkles, Target, TrendingUp, Users, Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PurgeCacheButton } from '@/modules/admin/components/PurgeCacheButton';
import { SystemHealthCard } from '@/modules/admin/components/SystemHealthCard';
import type { AdminStats, ConnectionInfo, DataStatus, ServiceStatus } from './types';

interface DashboardTabProps {
 // Computed values
 healthScore: number;
 stats: AdminStats | null;
 predictionStats: any;
 dataStatus: DataStatus | null;
 dataStatusLoading: boolean;
 services: ServiceStatus[];

 // Sync handlers
 syncing: boolean;
 multiMarketSyncing: boolean;
 onSync: () => void;
 onMultiMarketSync: () => void;

 // Data status refresher
 fetchDataStatus: () => void;

 // Navigation (so Quick Actions buttons can switch tabs)
 onNavigate: (
 tab:
 | 'dashboard'
 | 'learning'
 | 'databases'
 ) => void;

 // Last update info
 lastUpdate: string | null;
 dataAgeMinutes: number | null;
}

export function DashboardTab({
 healthScore,
 stats,
 predictionStats,
 dataStatus,
 dataStatusLoading,
 services,
 syncing,
 multiMarketSyncing,
 onSync,
 onMultiMarketSync,
 fetchDataStatus,
 onNavigate,
 lastUpdate,
 dataAgeMinutes,
}: DashboardTabProps) {
 return (
 <div className="space-y-6">
 {/* Health Score & Quick Stats */}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
 {/* System Health */}
 <Card className="md:col-span-1">
 <CardContent className="p-6">
 <div className="text-center">
 <div className={cn(
 "w-20 h-20 mx-auto rounded-full flex items-center justify-center text-lg md:text-xl lg:text-2xl font-bold",
 healthScore >= 80 ? "bg-profit/10 text-profit border border-profit/20" :
 healthScore >= 50 ? "bg-warning/10 text-warning dark:text-warning border border-warning/20" :
 "bg-loss/10 text-loss border border-loss/20"
 )}>
 {healthScore}%
 </div>
 <p className="mt-3 font-medium">صحة النظام</p>
 <Progress
 value={healthScore}
 className={cn(
 "mt-2 h-2",
 healthScore >= 80 ? "[&>div]:bg-profit" :
 healthScore >= 50 ? "[&>div]:bg-warning" :
 "[&>div]:bg-loss"
 )}
 />
 </div>
 </CardContent>
 </Card>

 {/* Quick Stats */}
 <Card className="md:col-span-3">
 <CardContent className="p-4">
 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
 <div className="text-center p-3 rounded-lg bg-muted/50">
 <Users className="w-6 h-6 mx-auto mb-2 text-primary" />
 <div className="text-lg md:text-xl lg:text-2xl font-bold">{stats?.users?.total ?? 0}</div>
 <div className="text-xs text-muted-foreground">مستخدم</div>
 </div>
 <div className="text-center p-3 rounded-lg bg-muted/50">
 <TrendingUp className="w-6 h-6 mx-auto mb-2 text-profit" />
 <div className="text-lg md:text-xl lg:text-2xl font-bold">{stats?.stocks?.active ?? 0}</div>
 <div className="text-xs text-muted-foreground">سهم نشط</div>
 </div>
 <div className="text-center p-3 rounded-lg bg-muted/50">
 <Target className="w-6 h-6 mx-auto mb-2 text-primary" />
 <div className="text-lg md:text-xl lg:text-2xl font-bold">{predictionStats?.total_predictions ?? 0}</div>
 <div className="text-xs text-muted-foreground">توقع</div>
 </div>
 <div className="text-center p-3 rounded-lg bg-muted/50">
 <BarChart3 className="w-6 h-6 mx-auto mb-2 text-warning" />
 <div className="text-lg md:text-xl lg:text-2xl font-bold">{predictionStats?.success_rate?.toFixed?.(0) ?? 0}%</div>
 <div className="text-xs text-muted-foreground">نسبة النجاح</div>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Phase 9: Purge Cache + Rebuild Predictions */}
 <PurgeCacheButton />

 {/* Data Status by Market - جديد */}
 <Card>
 <CardHeader className="pb-2">
 <div className="flex items-center justify-between">
 <CardTitle className="text-base flex items-center gap-2">
 <Database className="w-5 h-5 text-profit" />
 حالة تحديث البيانات (تفصيلي)
 </CardTitle>
 <div className="flex items-center gap-2">
 {dataStatus?.summary && (
 <Badge variant={dataStatus.summary.health_score >= 80 ? 'default' : dataStatus.summary.health_score >= 50 ? 'outline' : 'destructive'} className="gap-1">
 صحة البيانات: {dataStatus.summary.health_score}%
 </Badge>
 )}
 <Button variant="ghost" size="sm" onClick={fetchDataStatus} disabled={dataStatusLoading}>
 <RefreshCw className={cn("w-4 h-4", dataStatusLoading && "animate-spin")} />
 </Button>
 </div>
 </div>
 </CardHeader>
 <CardContent>
 {dataStatusLoading && !dataStatus ? (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
 </div>
 ) : dataStatus?.categories ? (
 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
 {dataStatus.categories.map((cat) => (
 <div key={cat.category} className={cn(
 "p-3 rounded-lg border-2",
 cat.status === 'fresh' ? "border-profit bg-profit/20" :
 cat.status === 'stale' ? "border-warning bg-warning/20" :
 cat.status === 'old' ? "border-loss bg-loss/20" :
 "border-border bg-muted /20"
 )}>
 <div className="flex items-center justify-between mb-2">
 <span className="font-medium text-sm">{cat.name_ar}</span>
 <div className={cn(
 "w-2.5 h-2.5 rounded-full",
 cat.status === 'fresh' ? "bg-profit" :
 cat.status === 'stale' ? "bg-warning" :
 cat.status === 'old' ? "bg-loss" :
 "bg-muted"
 )} />
 </div>
 <div className="text-lg font-bold">{cat.count.toLocaleString()}</div>
 <div className="text-xs text-muted-foreground">{cat.message}</div>
 </div>
 ))}
 </div>
 ) : (
 <div className="text-center py-8 text-muted-foreground">
 لا توجد بيانات
 </div>
 )}
 </CardContent>
 </Card>

 {/* Quick Actions */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-base flex items-center gap-2">
 <Zap className="w-5 h-5 text-warning" />
 إجراءات سريعة
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
 <Button onClick={onSync} disabled={syncing} className="h-auto py-4 flex-col gap-2">
 <RefreshCw className={cn("w-6 h-6", syncing && "animate-spin")} />
 <span>تحديث البيانات</span>
 {lastUpdate && (
 <span className="text-xs opacity-70">منذ {dataAgeMinutes ?? '—'} دقيقة</span>
 )}
 </Button>
 <Button
 onClick={onMultiMarketSync}
 disabled={multiMarketSyncing}
 variant="secondary"
 className="h-auto py-4 flex-col gap-2"
 >
 <RefreshCw className={cn("w-6 h-6", multiMarketSyncing && "animate-spin")} />
 <span>تحديث كل الأسواق</span>
 <span className="text-xs opacity-70">EGX, KSA, KSE, DFM...</span>
 </Button>
 {/* PHASE4-APIS (Task PHASE4-APIS, Option A): زر "توليد التوقعات"
 كان بـ يستدعي /api/admin/generate-predictions (410 Gone).
 التوقعات الآن تُولّد تلقائيًا عبر cron (daily_predictor.py).
 الزر يُظهر توضيحًا بدلًا من نداء الـ endpoint الميّت. */}
 <Button
 onClick={() => {
 toast.info(
 'التوقعات تُولّد تلقائيًا عبر cron (daily_predictor.py) — لا حاجة لتشغيل يدوي.',
 {
 description:
 'مسار /api/admin/generate-predictions معطّل (410 Gone). ' +
 'MarketScheduler.tick + daily_closer.py يكفيان لإدارة دورة التوقع.',
 }
 );
 }}
 title="التوقعات تُولّد تلقائيًا عبر cron (daily_predictor.py)"
 className="h-auto py-4 flex-col gap-2 from-profit to-whale hover:from-profit hover:to-whale text-foreground"
 >
 <Sparkles className="w-6 h-6" />
 <span>توليد التوقعات</span>
 <span className="text-xs opacity-80">تلقائي عبر cron</span>
 </Button>
 {/* Stream C: fixed dead 'egx' button → now correctly opens the learning hub tab */}
 <Button variant="outline" onClick={() => onNavigate('learning')} className="h-auto py-4 flex-col gap-2">
 <Brain className="w-6 h-6" />
 <span>التعلم الذكي</span>
 <span className="text-xs opacity-70">تحسين التحليل</span>
 </Button>
 <Button variant="outline" onClick={() => onNavigate('dashboard')} className="h-auto py-4 flex-col gap-2 relative">
 <Zap className="w-6 h-6" />
 <span>مركز القيادة</span>
 <span className="text-xs opacity-70">Maestro Command Center</span>
 </Button>
 {/* FIX-P3-P5-P6 (Group P6 — Fix 7): 'data-engine' tab removed —
 rewired to open 'databases' (the closest live equivalent in
 the data hub) so the button is no longer a no-op. */}
 <Button variant="outline" onClick={() => onNavigate('databases')} className="h-auto py-4 flex-col gap-2">
 <Database className="w-6 h-6" />
 <span>إدارة البيانات</span>
 <span className="text-xs opacity-70">المحرك والمصادر</span>
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Services Status Mini */}
 <Card>
 <CardHeader className="pb-2">
 <div className="flex items-center justify-between">
 <CardTitle className="text-base flex items-center gap-2">
 <Server className="w-5 h-5 text-profit" />
 حالة الخدمات
 </CardTitle>
 <Button variant="ghost" size="sm" onClick={() => onNavigate('dashboard')}>
 المخطط الكامل
 </Button>
 </div>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 {services.map(service => (
 <div key={service.name} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
 <div className={cn(
 "w-3 h-3 rounded-full",
 service.status === 'online' ? "bg-profit" :
 service.status === 'degraded' ? "bg-warning" :
 "bg-loss"
 )} />
 <div className="flex-1 min-w-0">
 <div className="font-medium text-sm truncate">{service.nameAr}</div>
 <div className="text-xs text-muted-foreground truncate">{service.message}</div>
 </div>
 {service.latency && (
 <div className="text-xs text-muted-foreground">{service.latency}ms</div>
 )}
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Task 28-B (Fix 9) — Fix Battalion: wire /api/admin/system-health */}
 <SystemHealthCard />

 {/* Mini command center preview */}
 <Card className="border-profit/20">
 <CardHeader className="pb-2">
 <div className="flex items-center justify-between">
 <CardTitle className="text-base flex items-center gap-2">
 <Zap className="w-5 h-5 text-profit" />
 لوحة التحكم
 </CardTitle>
 <Button variant="ghost" size="sm" onClick={() => onNavigate('dashboard')}>
 عرض كامل
 </Button>
 </div>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
 <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
 <Server className="w-5 h-5 text-profit" />
 <div>
 <div className="text-xs text-muted-foreground">المحركات</div>
 <div className="font-bold">
 <span className="text-profit">{services.filter(s => s.status === 'online').length}</span>
 <span className="text-muted-foreground"> / {services.length}</span>
 </div>
 </div>
 </div>
 <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
 <Database className="w-5 h-5 text-primary" />
 <div>
 <div className="text-xs text-muted-foreground">قواعد البيانات</div>
 <div className="font-bold">
 <span className="text-profit">{dataStatus?.categories?.filter(c => c.status === 'fresh').length || 0}</span>
 <span className="text-muted-foreground"> متاحة</span>
 </div>
 </div>
 </div>
 <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
 <Zap className="w-5 h-5 text-warning" />
 <div>
 <div className="text-xs text-muted-foreground">صحة النظام</div>
 <div className="font-bold text-profit">{healthScore}%</div>
 </div>
 </div>
 <Button variant="outline" size="sm" onClick={() => onNavigate('dashboard')} className="h-auto py-3">
 <Zap className="w-4 h-4 ml-1" />
 مركز القيادة
 </Button>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}
