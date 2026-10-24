'use client';

// ============================================================================
// MakerRadarTab.tsx — Container component (F-Phase3-Split)
// ============================================================================
// Container-only: imports all sub-components from ./maker-radar/* + the
// useMakerRadarData hook and renders them. All heavy lifting (data shaping,
// table rendering, drawer logic, trading-plan calculations) lives in the
// extracted sub-components. Original MakerRadarTab.tsx (3,763 LOC) → split
// into 8 files (types / helpers / RadarActivityCard / SectorHeatStrip /
// RadarSection / StockTable / TradingPlanSection / MakerRadarTab container).
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
 Radar, RefreshCw, Flame, TrendingUp, Activity, AlertTriangle,
 Target, Zap, Gauge, Award, Sparkles,
 DoorOpen, FileText, UserCircle, Clock, BarChart3, Eye, Rocket,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
// ALPHA-INCUBATOR: The Stalking Radar section (per Mohsen's directive 2026-10-20)
import { IncubatorSection } from '@/modules/radar/components/IncubatorSection';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useMakerRadarData } from '@/hooks/useMakerRadarData';
import { useRealtimeUpdates } from '@/lib/ws-client';
import { useAppStore } from '@/lib/store';
import { getMarketStatus } from '@/lib/market-hours';
import { getRadarAccess, getTrialStatus } from '@/lib/subscription-gate';
import { MarketRegimeBanner } from '@/components/market/MarketRegimeBanner';
import {
 RadarSignalStatsCard, SectorTreemapCard,
} from '@/modules/radar/components/RadarStatsCards';

// Lazy-loaded sub-tabs (each ships as its own JS chunk).
const ExitRadarTab = dynamic(
 () => import('@/modules/radar/components/ExitRadarTab').then(m => ({ default: m.ExitRadarTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const WeeklyReportTab = dynamic(
 () => import('@/modules/radar/components/WeeklyReportTab').then(m => ({ default: m.WeeklyReportTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const MultiMarketRadarTab = dynamic(
 () => import('@/modules/radar/components/MultiMarketRadarTab').then(m => ({ default: m.MultiMarketRadarTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const AccuracyDashboard = dynamic(
 () => import('@/modules/radar/components/AccuracyDashboard').then(m => ({ default: m.AccuracyDashboard })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);
const PersonalizedRadarTab = dynamic(
 () => import('@/modules/radar/components/PersonalizedRadarTab').then(m => ({ default: m.PersonalizedRadarTab })),
 { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);

// ─── Extracted sub-components (F-Phase3-Split) ─────────────────────────
import { RadarActivityCard, KpiCard } from './RadarActivityCard';
import { SectorHeatStrip } from './SectorHeatStrip';
import { RadarSection } from './RadarSection';
import { StockDetailDrawer } from './StockTable';
import { ProofSection } from './TradingPlanSection';
import { fmtMoney } from './helpers';
import type {
 MakerRadarTabProps, FilterKey, RadarStock,
 SectorAgg, StockListItem, PredictionEntry, MakerRadarResponse,
} from './types';

export function MakerRadarTab({ market = 'EGX' }: MakerRadarTabProps) {
 // ─── F-Strangler-MakerRadar: data fetching extracted to a dedicated hook ──
 const {
 data, loading, refreshing, error, predMap, stockMap,
 warmingRadar, warmingV40, warmupMsg, lastUpdated,
 refetch, fetchStockMap, warmupRadar, refreshV40,
 } = useMakerRadarData(market);

 const [filter, setFilter] = useState<FilterKey>('all');
 const [timeframe, setTimeframe] = useState<'7d' | '30d' | '90d'>('7d');
 const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

 // ─── Real-time WebSocket subscription (Task 35-E — Rule 67 root cause) ──
 const { stockPrices, isConnected: wsConnected } = useRealtimeUpdates();
 const lastWsRefetchRef = useRef<number>(0);

 // RADAR-QUICK-WINS (Priority 1): keep the parent RadarStock alongside the
 // selected ticker so the drawer + Smart Entry Card can render path /
 // position_size / signal_count without re-fetching.
 const [selectedStock, setSelectedStock] = useState<RadarStock | null>(null);

 // PAYWALL Gate 7: wire getRadarAccess()
 const radarSubscriptionUser = useAppStore((s) => s.user);
 const radarSubStatus = getTrialStatus(radarSubscriptionUser);
 const radarTier = (radarSubscriptionUser?.subscription_tier || 'free').toLowerCase();
 const radarAccess = getRadarAccess(radarTier);
 const radarDelayed =
 !radarAccess.live && radarSubStatus.isFreeUser && radarSubStatus.isTrialExpired;
 const displayedLastUpdated = useMemo(() => {
 if (!lastUpdated) return null;
 if (!radarDelayed || radarAccess.delayMinutes <= 0) return lastUpdated;
 return new Date(lastUpdated.getTime() - radarAccess.delayMinutes * 60_000);
 }, [lastUpdated, radarDelayed, radarAccess.delayMinutes]);

 // Sort by upward prediction confidence (desc)
 const [sortByPrediction, setSortByPrediction] = useState(false);

 // Live real-time polling: refresh both stock quotes (for live prices & flashes) and radar data
 useVisibilityAwarePolling(
 () => {
 fetchStockMap();
 refetch(true);
 },
 15_000,
 [fetchStockMap, refetch],
 { market, allowOffMarket: true },
 );

 // ─── WS push → instant refetch (Task 35-E — Rule 67) ──────────────────
 useEffect(() => {
 if (!wsConnected || stockPrices.length === 0) return;
 const now = Date.now();
 if (now - lastWsRefetchRef.current < 3_000) return;
 lastWsRefetchRef.current = now;
 refetch(true);
 }, [stockPrices, wsConnected, refetch]);

 // Track toggle — add/remove a stock from tracking
 const handleTrackToggle = useCallback(async (ticker: string, currentPrice: number, isTracked: boolean) => {
 try {
 const res = await fetch('/api/maker-radar/track', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ticker,
 entryPrice: currentPrice,
 action: isTracked ? 'remove' : 'add',
 notes: 'tracked from maker radar tab',
 }),
 });
 const json = await res.json();
 if (json.success) {
 refetch(true);
 }
 } catch (e) {
 console.error('track toggle error:', e);
 }
 }, [refetch]);

 // AUTO-TRACK (2026-09-30): auto-track stocks from unified-watch
 const autoTrackUserStocks = useCallback(async () => {
 try {
 const res = await fetch('/api/portfolio/unified-watch', { cache: 'no-store' });
 if (!res.ok) return;
 const data = await res.json();
 if (!data.success || !data.stocks) return;

 const trackRes = await fetch('/api/maker-radar/track', { cache: 'no-store' });
 const trackData = await trackRes.json();
 const trackedTickers = new Set<string>(
 (Array.isArray(trackData.tracked) ? trackData.tracked : [])
 .map((t: { ticker?: string }) => String(t?.ticker || '').toUpperCase())
 .filter(Boolean)
 );

 const toAdd = (data.stocks as any[]).filter((s) => {
 const t = s?.ticker?.toUpperCase();
 return t && !trackedTickers.has(t);
 });
 if (toAdd.length === 0) return;

 await Promise.all(
 toAdd.map((stock) => {
 const ticker = stock.ticker.toUpperCase();
 return fetch('/api/maker-radar/track', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ticker,
 entryPrice: stock.entry_price || stock.current_price || 0,
 action: 'add',
 notes: `auto-tracked from ${stock.sources?.join('+') || 'portfolio'}`,
 }),
 }).catch(() => undefined);
 })
 );
 refetch(true);
 } catch (e) {
 console.error('auto-track error:', e);
 }
 }, [refetch]);

 useEffect(() => { autoTrackUserStocks(); }, [autoTrackUserStocks]);

 const handleSelectStock = useCallback((ticker: string, stock?: RadarStock | null) => {
 setSelectedTicker(ticker);
 if (stock) setSelectedStock(stock);
 }, []);

 // --------------------------------------------------------------------
 // Derived data — sector heat strip (client-side aggregation)
 // --------------------------------------------------------------------
 const sectors = useMemo<SectorAgg[]>(() => {
 if (!stockMap || stockMap.size === 0) return [];
 const agg = new Map<string, SectorAgg>();
 for (const s of stockMap.values()) {
 const sector = s.sector || 'غير مصنف';
 if (!agg.has(sector)) {
 agg.set(sector, {
 sector, avgChange: 0, advancers: 0, decliners: 0,
 totalStocks: 0, totalTurnover: 0, marketCapSum: 0,
 });
 }
 const entry = agg.get(sector)!;
 const chg = typeof s.change_percent === 'number' ? s.change_percent : null;
 if (chg != null) {
 entry.avgChange += chg;
 if (chg > 0) entry.advancers += 1;
 else if (chg < 0) entry.decliners += 1;
 }
 entry.totalStocks += 1;
 }
 const list: SectorAgg[] = [];
 for (const v of agg.values()) {
 if (v.totalStocks === 0) continue;
 v.avgChange = v.avgChange / v.totalStocks;
 list.push(v);
 }
 list.sort((a, b) => b.avgChange - a.avgChange);
 return list;
 }, [stockMap]);

 const sectorForTicker = useCallback((ticker: string): string | null => {
 if (!stockMap) return null;
 return stockMap.get(ticker.toUpperCase())?.sector || null;
 }, [stockMap]);

 const changePercentForTicker = useCallback((ticker: string): number | null => {
 if (!stockMap) return null;
 const chg = stockMap.get(ticker.toUpperCase())?.change_percent;
 return typeof chg === 'number' ? chg : null;
 }, [stockMap]);

 const stockInfoForTicker = useCallback((ticker: string): StockListItem | null => {
 if (!stockMap) return null;
 return stockMap.get(ticker.toUpperCase()) || null;
 }, [stockMap]);

 const marketStatus = getMarketStatus(market);

 const predScore = useCallback((ticker: string): number => {
 const p = predMap.get(ticker.toUpperCase());
 if (!p) return -1;
 const isBuy = p.direction === 'up' || p.signal === 'BUY' || p.signal === 'STRONG_BUY';
 if (!isBuy) return -1;
 return p.confidence ?? p.master_score ?? 0;
 }, [predMap]);

 // ── DEFAULT SORT (owner directive 2026-10-07): highest turnover → highest change
 const defaultSortFn = useCallback((a: RadarStock, b: RadarStock): number => {
 const aTurnover = Number(a.avg_turnover_20d ?? a.current_price * (a.avg_volume_20d ?? 0)) || 0;
 const bTurnover = Number(b.avg_turnover_20d ?? b.current_price * (b.avg_volume_20d ?? 0)) || 0;
 if (aTurnover !== bTurnover) return bTurnover - aTurnover;
 const aChange = Number((a as any).change_1d ?? (a as any).change_percent ?? 0) || 0;
 const bChange = Number((b as any).change_1d ?? (b as any).change_percent ?? 0) || 0;
 return bChange - aChange;
 }, []);

 const sortFn = useCallback((a: RadarStock, b: RadarStock): number => {
 if (sortByPrediction) return predScore(b.ticker) - predScore(a.ticker);
 return defaultSortFn(a, b);
 }, [sortByPrediction, predScore, defaultSortFn]);

 const predictionForTicker = useCallback((ticker: string): PredictionEntry | null =>
 predMap.get(ticker.toUpperCase()) || null,
 [predMap]);

 // --------------------------------------------------------------------
 // Filtering + dedup (FIX-UI-AUDIT — re-applied to NEW path)
 // --------------------------------------------------------------------
 const dedupSet = useMemo(() => {
 const seen = new Set<string>();
 const allow = (s: RadarStock, listKey: 'explosive' | 'early_break' | 'pre_surge' | 'quiet') => {
 if (filter !== 'all') return true;
 const k = s.ticker.toUpperCase();
 if (listKey === 'explosive') { seen.add(k); return true; }
 if (seen.has(k)) return false;
 seen.add(k); return true;
 };
 return { allow };
 }, [filter]);

 const filteredPreSurge = useMemo(() => {
 let list = (data?.pre_surge_list || []).filter(s => dedupSet.allow(s, 'pre_surge'));
 if (filter !== 'all' && filter !== 'pre_surge') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 const filteredQuiet = useMemo(() => {
 let list = (data?.quiet_list || []).filter(s => dedupSet.allow(s, 'quiet'));
 if (filter !== 'all' && filter !== 'quiet') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 const filteredExplosive = useMemo(() => {
 let list = (data?.explosive_list || []).filter(s => dedupSet.allow(s, 'explosive'));
 if (filter !== 'all' && filter !== 'explosive') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 const filteredEarlyBreak = useMemo(() => {
 let list = (data?.early_break_list || []).filter(s => dedupSet.allow(s, 'early_break'));
 if (filter !== 'all' && filter !== 'early_break') {
 list = filter === 'tracked' ? list.filter((s) => s.isTracked) : [];
 }
 return [...list].sort(sortFn);
 }, [data, filter, sortByPrediction, sortFn, dedupSet]);

 // FIX-UI-AUDIT (re-applied to NEW path): radarKpi aggregates the four lists
 const radarKpi = useMemo(() => {
 const allLists = [
 data?.pre_surge_list || [], data?.explosive_list || [],
 data?.early_break_list || [], data?.quiet_list || [],
 ];
 const allStocks = allLists.flat();
 if (allStocks.length === 0) {
 return { hasData: false, activeCount: 0, topMomentumTicker: null, topMomentumRoc: null, topLiquidityTicker: null, topLiquidityValue: null, realOpportunities: 0 };
 }
 const unique = new Set<string>();
 for (const s of allStocks) unique.add(s.ticker.toUpperCase());

 let topMomentumTicker: string | null = null;
 let topMomentumRoc = -Infinity;
 for (const s of allStocks) {
 const roc = typeof s.roc_10d === 'number' ? s.roc_10d : null;
 if (roc != null && roc > topMomentumRoc) {
 topMomentumRoc = roc;
 topMomentumTicker = s.ticker;
 }
 }

 let topLiquidityTicker: string | null = null;
 let topLiquidityValue = -Infinity;
 for (const s of allStocks) {
 const v = typeof s.avg_turnover_20d === 'number' ? s.avg_turnover_20d : null;
 if (v != null && v > topLiquidityValue) {
 topLiquidityValue = v;
 topLiquidityTicker = s.ticker;
 }
 }

 const realOpportunities =
 (data?.pre_surge_list?.length || 0) +
 (data?.explosive_list?.length || 0) +
 (data?.early_break_list?.length || 0);

 return {
 hasData: true,
 activeCount: unique.size,
 topMomentumTicker,
 topMomentumRoc: topMomentumTicker !== null ? topMomentumRoc : null,
 topLiquidityTicker,
 topLiquidityValue: topLiquidityTicker !== null ? topLiquidityValue : null,
 realOpportunities,
 };
 }, [data]);

 // --------------------------------------------------------------------
 // Loading / error states
 // --------------------------------------------------------------------
 if (loading && !data) {
 return (
 <div className="space-y-3 p-4" dir="rtl">
 <Skeleton className="h-20 w-full" />
 <Skeleton className="h-16 w-full" />
 <Skeleton className="h-12 w-full" />
 <Skeleton className="h-64 w-full" />
 <Skeleton className="h-64 w-full" />
 </div>
 );
 }

 if (error && !data) {
 return (
 <Card className="p-6 text-center" dir="rtl">
 <AlertTriangle className="h-10 w-10 text-loss mx-auto mb-3" />
 <p className="text-sm text-muted-foreground mb-3">{error}</p>
 <Button size="sm" onClick={() => refetch(false)}>
 <RefreshCw className="h-4 w-4 ml-1" /> إعادة المحاولة
 </Button>
 </Card>
 );
 }

 const totalCardsShown =
 filteredPreSurge.length + filteredQuiet.length +
 filteredExplosive.length + filteredEarlyBreak.length;

 const radarSectionCommon = {
 market,
 sectorForTicker, changePercentForTicker, stockInfoForTicker, predictionForTicker,
 onSelect: handleSelectStock, onTrackToggle: handleTrackToggle,
 };

 return (
 <div className="space-y-4" dir="rtl">
 <IncubatorSection
 market={market === 'TADAWUL' || market === 'KSA' ? 'TADAWUL' : 'EGX'}
 refreshIntervalMs={60_000}
 maxDisplay={6}
 />

 {/* ===== HEADER ===== */}
 <Card className="overflow-hidden">
 <div className="to-transparent /30 dark:to-transparent p-4 md:p-5">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className="relative">
 <div className="h-12 w-12 rounded-xl bg-profit/10 /10 flex items-center justify-center">
 <Radar className="h-6 w-6 text-profit " />
 </div>
 {marketStatus.isOpen && (
 <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-profit animate-pulse border-2 border-background" />
 )}
 </div>
 <div>
 <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
 رادار الميكرز
 <Badge
 variant="outline"
 className={
 marketStatus.isOpen
 ? 'bg-profit/10 text-profit border border-profit/20 border-profit text-xs'
 : 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-warning text-xs'
 }
 >
 <span className={`h-1.5 w-1.5 rounded-full mr-1 ${marketStatus.isOpen ? 'bg-profit animate-pulse' : 'bg-warning'}`} />
 {marketStatus.isOpen ? 'LIVE' : 'السوق مقفول'}
 </Badge>
 </h3>
 <p className="text-xs text-muted-foreground mt-0.5">
 اكتشف الأسهم قبل ما تنفجر — {radarDelayed ? 'بيانات متأخرة 60 دقيقة' : 'بيانات حية'}
 </p>
 </div>
 </div>

 <div className="flex items-center gap-2 flex-wrap">
 {displayedLastUpdated && (
 <span className="text-xs text-muted-foreground">
 آخر تحديث: {displayedLastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
 {radarDelayed && ' (متأخر)'}
 </span>
 )}
 {data?.cached && (
 <Badge variant="outline" className={`text-xs ${
 data.cache_stale
 ? 'text-warning border-warning bg-warning/10'
 : data.cache_age_seconds! < 60
 ? 'text-profit border-profit bg-profit/10'
 : 'text-muted-foreground border-border bg-muted/30'
 }`}
 title={`DB: ${data.db_source || 'unknown'}\nGenerated: ${data.cache_generated_at || '?'}\nLast warmup: ${data.last_warmup_status} (${data.last_warmup_duration_ms ?? 0}ms)`}
 >
 <Clock className="h-3 w-3 ml-0.5" />
 {data.cache_stale
 ? `قديم ${Math.floor(data.cache_age_seconds! / 60)}د`
 : data.cache_age_seconds! < 60
 ? `طازج ${data.cache_age_seconds}ث`
 : `${Math.floor(data.cache_age_seconds! / 60)}د`}
 </Badge>
 )}
 {data?.warmup_running && (
 <Badge variant="outline" className="text-xs text-primary border-primary bg-primary/10">
 <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse mr-1" />
 بيشتغل
 </Badge>
 )}
 {data?.db_source && (
 <Badge variant="outline" className="text-xs text-muted-foreground border-border bg-muted/20" title="قاعدة البيانات المستخدمة">
 {data.db_source.split('::')[0]}
 </Badge>
 )}
 {data?.last_warmup_status === 'failed' && data?.last_error && (
 <Badge variant="outline" className="text-xs text-loss border-loss bg-loss/10" title={data.last_error}>
 ⚠️ خطأ آخر تشغيل
 </Badge>
 )}
 <Button size="sm" variant="outline" onClick={() => refetch(true)} disabled={refreshing || loading || warmingRadar} className="h-8" title="إعادة قراءة الكاش">
 <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
 </Button>
 <Button size="sm" variant="default" onClick={warmupRadar} disabled={warmingRadar || warmingV40} className="h-8 gap-1" title="شغّل الرادار من جديد (Python script)">
 <RefreshCw className={`h-4 w-4 ${warmingRadar ? 'animate-spin' : ''}`} />
 <span className="hidden sm:inline">تشغيل الرادار</span>
 </Button>
 <Button size="sm" variant="secondary" onClick={refreshV40} disabled={warmingRadar || warmingV40} className="h-8 gap-1" title="ولّد توقعات اليوم">
 <Sparkles className={`h-4 w-4 ${warmingV40 ? 'animate-pulse' : ''}`} />
 <span className="hidden sm:inline">توليد التوقعات</span>
 </Button>
 </div>
 {warmupMsg && (
 <div className="mt-2 text-xs px-3 py-1.5 rounded-md bg-muted/50 border border-border text-foreground animate-in fade-in slide-in-from-top-1">
 {warmupMsg}
 </div>
 )}
 </div>
 </div>
 </Card>

 {/* ===== PAYWALL Gate 7 banner ===== */}
 {radarDelayed && (
 <Card className="border-warning/20 bg-warning/10 /30 p-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex items-center gap-2 text-warning ">
 <Clock className="h-4 w-4" />
 <span className="text-xs font-semibold">
 البيانات متأخرة 60 دقيقة — اشترك للبيانات الفورية
 </span>
 </div>
 <Button
 variant="outline" size="sm"
 className="h-7 text-xs gap-1 border-warning/20 text-warning hover:bg-warning/10 dark:hover:bg-warning/10"
 onClick={() => { if (typeof window !== 'undefined') window.location.href = '/pricing'; }}
 >
 اشترك للبيانات الفورية
 </Button>
 </div>
 </Card>
 )}

 {/* ===== SUB-TABS (Task 9-B Step 2) ===== */}
 <Tabs defaultValue="maker" className="w-full">
 <TabsList className="flex w-full overflow-x-auto sm:grid sm:grid-cols-3 lg:grid-cols-6 h-auto gap-1">
 <TabsTrigger value="maker" className="flex items-center gap-1">
 <Radar className="h-4 w-4 text-profit" />
 <span className="hidden sm:inline">رادار الميكرز</span>
 </TabsTrigger>
 <TabsTrigger value="exit-radar" className="flex items-center gap-1">
 <DoorOpen className="h-4 w-4 text-loss" />
 <span className="hidden sm:inline">رادار الخروج</span>
 </TabsTrigger>
 <TabsTrigger value="weekly-report" className="flex items-center gap-1">
 <FileText className="h-4 w-4 text-profit" />
 <span className="hidden sm:inline">التقرير الأسبوعي</span>
 </TabsTrigger>
 <TabsTrigger value="multi-market-radar" className="flex items-center gap-1">
 <Radar className="h-4 w-4 text-violet-600" />
 <span className="hidden sm:inline">الرادار الموحّد</span>
 </TabsTrigger>
 <TabsTrigger value="radar-accuracy" className="flex items-center gap-1">
 <Gauge className="h-4 w-4 text-warning" />
 <span className="hidden sm:inline">دقة الرادار</span>
 </TabsTrigger>
 <TabsTrigger value="personalized-radar" className="flex items-center gap-1">
 <UserCircle className="h-4 w-4 text-whale" />
 <span className="hidden sm:inline">الرادار المخصّص</span>
 </TabsTrigger>
 </TabsList>

 {/* ─── Maker Radar (default) ─── */}
 <TabsContent value="maker" className="mt-4 space-y-4">
 {/* MARKET REGIME BANNER */}
 {data?.market_regime && (
 <Card className={`p-4 border-l-4 transition-all ${
 data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? 'border-l-red-500 bg-loss/10 /30 border-loss shadow-lg shadow-red-500/20'
 : data.market_regime.regime === 'AGGRESSIVE'
 ? 'border-l-emerald-500 bg-profit/5 /20 border-profit '
 : 'border-l-blue-500 bg-primary/5 /20 border-primary '
 }`}>
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-2">
 <span className={`text-xs font-bold ${
 data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? 'text-loss animate-pulse'
 : data.market_regime.regime === 'AGGRESSIVE'
 ? 'text-profit '
 : 'text-primary '
 }`}>وضع السوق المستشعر:</span>
 <Badge variant="outline" className={`text-xs font-semibold ${
 data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? 'bg-loss/10 text-loss border border-loss/20 border-loss '
 : data.market_regime.regime === 'AGGRESSIVE'
 ? 'bg-profit/10 text-profit border border-profit/20 border-profit '
 : 'bg-primary text-primary border-primary '
 }`}>
 {data.market_regime.regime === 'DEFENSIVE' || data.market_regime.raw_regime === 'DEFENSIVE'
 ? '🔴 دِفاعي — قلّل الحجم وركّز على وقف الخسارة'
 : data.market_regime.regime === 'AGGRESSIVE'
 ? '🟢 هجومي — زخم صاعد'
 : '⚖️ عادي — حركة متوازنة'}
 </Badge>
 </div>
 {data.market_regime.breadth_pct != null && (
 <div className="flex items-center gap-3 text-xs text-muted-foreground">
 <span>صعود السوق: <strong className="font-mono text-foreground">{data.market_regime.breadth_pct}%</strong></span>
 {data.market_regime.turnover_ratio != null && (
 <span>نسبة السيولة: <strong className="font-mono text-foreground">{data.market_regime.turnover_ratio}x</strong></span>
 )}
 </div>
 )}
 </div>
 </Card>
 )}

 {/* KPI CARDS */}
 {radarKpi.hasData ? (
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
 <KpiCard icon={<Activity className="h-4 w-4" />} label="عدد الأسهم النشطة" value={radarKpi.activeCount} sub="عبر كل قوائم الرادار" accent="blue" />
 <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="أقوى زخم حالي" value={radarKpi.topMomentumTicker ?? '—'} sub={radarKpi.topMomentumRoc != null ? `ROC 10 أيام: ${(radarKpi.topMomentumRoc ?? 0).toFixed(2)}%` : 'بانتظار البيانات'} accent="emerald" />
 <KpiCard icon={<BarChart3 className="h-4 w-4" />} label="أعلى سيولة" value={radarKpi.topLiquidityTicker ?? '—'} sub={radarKpi.topLiquidityValue != null ? `متوسط سيولة 20 يوم: ${fmtMoney(radarKpi.topLiquidityValue)}` : 'بانتظار البيانات'} accent="amber" />
 <KpiCard icon={<Target className="h-4 w-4" />} label="عدد الفرص الحقيقية" value={radarKpi.realOpportunities} sub={radarKpi.realOpportunities > 0 ? 'فرص قابلة للتداول' : 'الرادار بيفحص الأسهم'} accent="rose" />
 </div>
 ) : (
 <Card className="p-4 border-dashed border-muted-foreground/30 bg-muted/20">
 <div className="flex items-center gap-3 text-sm text-muted-foreground">
 <Radar className="h-5 w-5 flex-shrink-0 opacity-60" />
 <div>
 <p className="font-semibold text-foreground">لا توجد فرص حالياً — الرادار بيفحص الأسهم</p>
 <p className="text-xs mt-0.5">جرّب تشغيل الرادار أو حدّث بعد دقيقة.</p>
 </div>
 </div>
 </Card>
 )}

 {/* RADAR SUMMARY */}
 {data && !loading && (
 <Card className="p-4 border-primary/20 ">
 <div className="flex items-start gap-3">
 <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
 <Target className="w-5 h-5 text-primary-foreground" />
 </div>
 <div className="flex-1 min-w-0 space-y-2">
 <div className="flex items-center gap-2">
 <span className="text-sm font-bold">خلاصة الرادار</span>
 {data.market_regime && (
 <Badge variant="outline" className={
 data.market_regime.effective_regime === 'AGGRESSIVE' ? 'bg-profit/10 text-profit border-profit/20' :
 data.market_regime.effective_regime === 'DEFENSIVE' ? 'bg-loss/10 text-loss border-loss/20' :
 'bg-warning/10 text-warning border-warning/20'
 }>
 {data.market_regime.effective_regime === 'AGGRESSIVE' ? '🟢 السوق عدواني' :
 data.market_regime.effective_regime === 'DEFENSIVE' ? '🔴 السوق دفاعي' :
 '🟡 السوق محايد'}
 </Badge>
 )}
 </div>
 <p className="text-xs text-muted-foreground leading-relaxed">
 {(() => {
 const totalStocks = data.total_scanned ?? 0;
 const underMicroscope = data.under_microscope_count ?? 0;
 const explosive = data.explosive_count ?? 0;
 const earlyBreak = data.early_break_count ?? 0;
 const tracked = data.tracked_count ?? 0;
 const totalOpportunities = underMicroscope + explosive + earlyBreak;

 if (totalStocks === 0) return 'الرادار قيد التحميل — انتظر دقيقة وحاول مرة أخرى.';
 if (totalOpportunities === 0) return `تم فحص ${totalStocks} سهم — لا توجد فرص واضحة حالياً. السوق هادئ، انتظر حركة.`;
 if (explosive > 0 || earlyBreak > 0) return `🔥 يوجد ${explosive + earlyBreak} سهم في حركة انفجارية/اختراق! ركّز على التبويبات الحمراء. + ${underMicroscope} تحت الميكروسكوب للتجميع.`;
 if (underMicroscope > 10) return `📊 ${underMicroscope} سهم تحت الميكروسكوب — السوق في مرحلة تجميع. تتركّز الفرص في الأسهم الصامتة قبل الانفجار.`;
 return `تم فحص ${totalStocks} سهم. ${totalOpportunities} فرصة محتملة. ${tracked} في قائمتك.`;
 })()}
 </p>
 {data.tracked_count === 0 && (data.under_microscope_count ?? 0) > 0 && (
 <p className="text-xs text-warning flex items-center gap-1">
 ⚠️ لا توجد أسهم في قائمة المتابعة — افتح أي سهم واضغط ⭐ لإضافته للمتابعة.
 </p>
 )}
 </div>
 </div>
 </Card>
 )}

 {/* RADAR ACTIVITY + SECTOR HEAT STRIP + TREEMAP + STATS */}
 <RadarActivityCard data={data} lastUpdated={lastUpdated} period={timeframe} onPeriodChange={setTimeframe} />
 <SectorHeatStrip sectors={sectors} loading={!stockMap} />
 <SectorTreemapCard />
 <RadarSignalStatsCard />

 {/* FILTER BAR */}
 <Card className="p-3">
 <div className="flex items-center gap-1.5 flex-wrap">
 <span className="text-xs text-muted-foreground ml-1">فلترة:</span>
 {([
 { key: 'all', label: 'الكل', emoji: null },
 { key: 'pre_surge', label: 'Pre-Surge', emoji: null },
 { key: 'quiet', label: 'ميكروسكوب', emoji: '🎯' },
 { key: 'explosive', label: 'منفجرة', emoji: '🔥' },
 { key: 'early_break', label: 'اختراق', emoji: '⚡' },
 { key: 'tracked', label: 'متابَعة', emoji: '⭐' },
 ] as const).map((f) => (
 <Button
 key={f.key}
 size="sm"
 variant={filter === f.key ? 'default' : 'outline'}
 className="h-7 text-xs"
 onClick={() => setFilter(f.key)}
 >
 {f.emoji && <span className="ml-1">{f.emoji}</span>}
 {f.label}
 {f.key === 'tracked' && data?.tracked_count ? (
 <Badge variant="secondary" className="mr-1 h-4 text-xs px-1">{data.tracked_count}</Badge>
 ) : null}
 </Button>
 ))}
 <div className="mr-auto flex items-center gap-1.5">
 {predMap.size > 0 && (
 <span className="text-xs text-muted-foreground">
 {predMap.size} توقع محمّل
 </span>
 )}
 <Button
 size="sm"
 variant={sortByPrediction ? 'default' : 'outline'}
 className={`h-7 text-xs gap-1 ${sortByPrediction ? 'bg-profit hover:bg-profit text-white border-transparent' : ''}`}
 onClick={() => setSortByPrediction((v) => !v)}
 title="ترتيب الأسهم من الأعلى توقع للصعود للأدنى"
 >
 <TrendingUp className="h-3.5 w-3.5" />
 {sortByPrediction ? 'مرتّب بالتوقع ✓' : 'ترتيب حسب التوقع'}
 </Button>
 </div>
 </div>
 </Card>

 <MarketRegimeBanner market={market} />

 {/* STOCK SECTIONS — owner directive: "الأسهم المنفجرة تظهر بشكل أكبر وأوضح في الأعلى" */}
 {(filter === 'all' || filter === 'explosive' || filter === 'tracked') && filteredExplosive.length > 0 && (
 <RadarSection
 key="radar-explosive"
 title="🔥 الأسهم المنفجرة الآن"
 subtitle="حجم فجائي + حركة قوية — تنبيه فوري"
 icon={<Flame className="h-4 w-4 text-loss " />}
 accent="rose"
 stocks={filteredExplosive}
 {...radarSectionCommon}
 />
 )}

 {(filter === 'all' || filter === 'pre_surge' || filter === 'tracked') && filteredPreSurge.length > 0 && (
 <RadarSection
 key="radar-pre-surge"
 title="Pre-Surge — متوقعة الانفجار"
 subtitle="أعلى أولوية — السهم بيتجمع قبل الانفجار"
 icon={<Rocket className="h-4 w-4 text-primary " />}
 accent="purple"
 stocks={filteredPreSurge}
 {...radarSectionCommon}
 />
 )}

 {(filter === 'all' || filter === 'quiet' || filter === 'tracked') && filteredQuiet.length > 0 && (
 <RadarSection
 key="radar-quiet"
 title="🎯 تحت الميكروسكوب"
 subtitle="تجميع هادئ — أسهم بتتراكم قبل ما تنفجر"
 icon={<Eye className="h-4 w-4 text-warning " />}
 accent="amber"
 stocks={filteredQuiet}
 {...radarSectionCommon}
 />
 )}

 {(filter === 'all' || filter === 'early_break' || filter === 'tracked') && filteredEarlyBreak.length > 0 && (
 <RadarSection
 key="radar-early-break"
 title="⚡ اختراق مبكر"
 subtitle="خروج من نطاق ضيق بحجم — أول إشارة اختراق"
 icon={<Zap className="h-4 w-4 text-profit " />}
 accent="emerald"
 stocks={filteredEarlyBreak}
 {...radarSectionCommon}
 />
 )}

 {/* EMPTY STATE */}
 {totalCardsShown === 0 && (
 <Card className="p-8 text-center border-dashed border-muted-foreground/30 bg-muted/10">
 <Radar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
 {filter === 'all' ? (
 <>
 <p className="text-sm font-semibold text-foreground">لا توجد فرص حالياً — الرادار بيفحص الأسهم</p>
 <p className="text-xs text-muted-foreground mt-1">
 الرادار بيفحص الأسهم بشكل دوري. جرّب تشغيل الرادار أو حدّث بعد دقيقة.
 </p>
 </>
 ) : (
 <>
 <p className="text-sm font-semibold text-foreground">لا توجد أسهم مطابقة للفلتر الحالي</p>
 <p className="text-xs text-muted-foreground mt-1">جرّب فلتراً آخر أو أعد العرض للكل</p>
 </>
 )}
 {filter !== 'all' && (
 <Button size="sm" variant="outline" className="mt-3" onClick={() => setFilter('all')}>
 عرض الكل
 </Button>
 )}
 </Card>
 )}

 <ProofSection />
 </TabsContent>

 <TabsContent value="exit-radar" className="mt-4">
 <ExitRadarTab market={market === 'CRYPTO' ? 'EGX' : market} />
 </TabsContent>
 <TabsContent value="weekly-report" className="mt-4">
 <WeeklyReportTab market={market === 'CRYPTO' ? 'EGX' : market} />
 </TabsContent>
 <TabsContent value="multi-market-radar" className="mt-4">
 <MultiMarketRadarTab />
 </TabsContent>
 <TabsContent value="radar-accuracy" className="mt-4">
 <AccuracyDashboard market={market} />
 </TabsContent>
 <TabsContent value="personalized-radar" className="mt-4">
 <PersonalizedRadarTab />
 </TabsContent>
 </Tabs>

 {/* ===== Stock Detail Drawer (kept outside Tabs so it stays mounted) ===== */}
 <Dialog open={!!selectedTicker} onOpenChange={(open) => { if (!open) { setSelectedTicker(null); setSelectedStock(null); } }}>
 <DialogContent
 className="max-w-[95vw] w-full h-[92vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg sm:max-w-3xl"
 showCloseButton={false}
 >
 {selectedTicker && (
 <StockDetailDrawer
 ticker={selectedTicker}
 radarStock={selectedStock}
 sectorForTicker={sectorForTicker}
 sectorChangeForTicker={(t) => {
 const sec = sectorForTicker(t);
 if (!sec) return null;
 const agg = sectors.find((s) => s.sector === sec);
 return agg?.avgChange ?? null;
 }}
 onClose={() => { setSelectedTicker(null); setSelectedStock(null); }}
 onTrackToggle={handleTrackToggle}
 />
 )}
 </DialogContent>
 </Dialog>
 </div>
 );
}

export default MakerRadarTab;
