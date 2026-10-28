'use client';

// ============================================================================
// StockTable.tsx — StockTable (professional table layout) + resolveLevels
// (Dual-Tier Levels Engine) + StockDetailDrawer (dialog body).
// ============================================================================

import { memo, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
 Star, StarOff, X, ChevronLeft, BarChart3, RefreshCw, AlertTriangle,
 TrendingUp, TrendingDown, Layers, Info, Activity, Gauge, Target,
 Award, ShieldCheck, Crosshair,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DialogClose, DialogTitle } from '@/components/ui/dialog';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { FlashingPriceCell } from '@/components/shared/FlashingPriceCell';
import { FlashingChangeCell } from '@/components/shared/FlashingChangeCell';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';
import { RelativeVolumeBadge } from '@/components/shared/RelativeVolumeBadge';
import { ShariaBadge } from '@/modules/sharia/components/ShariaBadge';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { buildStockDetailShareText } from '@/modules/publishing/lib/table-share-formatter';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n-context';
import { SafeWidget } from '@/modules/dashboard/components/SafeWidget';
import { MarketDepthLiquidityWidget } from '@/modules/market-analysis/components/MarketDepthLiquidityWidget';
import {
 RadarSignalStatsCard,
 SectorTreemapCard,
 EntryTimingCard,
 LiquidityFootprintCard,
 CompanyFundamentalsCard,
} from '@/modules/radar/components/RadarStatsCards';
import { SignalStrengthMeter, signalsToStars, signalHintAr } from '@/modules/radar/components/SignalStrengthMeter';
import { SignalTrackingTimeline } from '@/modules/radar/components/SignalTrackingTimeline';
import {
 accentClasses, fmtNum, fmtMoney, fmtPct, pnlColorClass,
 pathMeta, PATH_DESC, resolveSignalCount, resolveMaxSignals,
} from './helpers';
import {
 TradingPlanSection, StatCard, FundamentalField, MarketIntelligenceCard,
} from './TradingPlanSection';
import type {
 StockTableProps, RadarStockRow, StockDetailDrawerProps,
 RadarStock, PredictionEntry, StockDetail, StockListItem,
} from './types';

// ─── (UNIFIED-TABLE-UPGRADE) Dual-Tier Levels Engine ────────────────────
// يحسب مستويات الدخول/الوقف/الهدف من مصدرين: توقع AI أولاً، ثم المستويات
// الفنية من بيانات السهم (support/resistance). لا fabrication (Rule 27):
// لو support=0/null → stop=null → "—". لو resistance=0/null → target=null.
// R:R يُحسب فقط لو كل القيم الثلاث أرقام حقيقية > 0.
export function resolveLevels(
 stock: RadarStock,
 predictionForTicker: (ticker: string) => PredictionEntry | null,
): {
 entry: number | null;
 stop: number | null;
 target: number | null;
 riskReward: number | null;
 source: 'ai' | 'technical' | 'none';
} {
 const current = stock.current_price ?? null;

 // 1) AI prediction levels (preferred) — لو فيه pred.entry_price
 const pred = predictionForTicker(stock.ticker);
 if (pred && pred.entry_price != null && pred.entry_price > 0) {
 const entry = pred.entry_price;
 const stop = (pred.stop_loss != null && pred.stop_loss > 0) ? pred.stop_loss : null;
 const target = (pred.target_price != null && pred.target_price > 0) ? pred.target_price : null;
 let rr: number | null = null;
 if (stop != null && target != null && entry > stop && target > entry) {
 const denom = entry - stop;
 if (denom > 0) rr = (target - entry) / denom;
 }
 return { entry, stop, target, riskReward: rr, source: 'ai' };
 }

 // 2) Technical levels from DB — من بيانات السهم الفعلية (support/resistance)
 // DEEP-DIRECTIVE-CANCELLED (2026-10-18 — Owner directive via جيمي + جروك + كيمي):
 // تم إلغاء الـ Mathematical Volatility Model (Branch 3 القديم) نهائيًا.
 // ممنوع فبركة مستويات بـ range_10d_pct أو نسب ثابتة (Rule 27 NO-FAKE-DATA
 // + Rule 67a ROOT-CAUSE-FIRST + Rule 73 SINGLE-DISPLAY-SOURCE).
 // لو مفيش توقع AI + مفيش support/resistance حقيقي في الـ DB → source='none'
 // والواجهة تعرض "—" بكرامة بدل ما نلبس العميل في الحيط.
 if (current == null || current <= 0) {
 return { entry: null, stop: null, target: null, riskReward: null, source: 'none' };
 }
 const supportRaw = (stock as unknown as Record<string, unknown>).support;
 const resistanceRaw = (stock as unknown as Record<string, unknown>).resistance;
 const dbStop = (typeof supportRaw === 'number' && supportRaw > 0 && supportRaw < current) ? supportRaw : null;
 const dbTarget = (typeof resistanceRaw === 'number' && resistanceRaw > 0 && resistanceRaw > current) ? resistanceRaw : null;

 // لو في DB levels صالحة → استخدمها (source='technical')
 // لو مفيش → source='none' (ممنوع math model — Rule 27)
 if (dbStop != null || dbTarget != null) {
 const stop = dbStop;
 const target = dbTarget;
 let rr: number | null = null;
 if (stop != null && target != null && current > stop && target > current) {
 const denom = current - stop;
 if (denom > 0) rr = (target - current) / denom;
 }
 return { entry: current, stop, target, riskReward: rr, source: 'technical' };
 }

 // مفيش توقع AI + مفيش DB levels →诚实 null (Rule 27: NULL = NULL)
 return { entry: null, stop: null, target: null, riskReward: null, source: 'none' };
}

const StockTable = memo(function StockTable({
 stocks, accent, market, sectorForTicker, changePercentForTicker, stockInfoForTicker, predictionForTicker, onSelect, onTrackToggle,
}: StockTableProps) {
 const a = accentClasses[accent];

 // ─── (UNIFIED-TABLE-UPGRADE) memoized levels resolver — used by both
 // render functions and sortValue callbacks so they always agree.
 const levelsByTicker = useMemo(() => {
 const map = new Map<string, ReturnType<typeof resolveLevels>>();
 for (const s of stocks) {
 map.set(s.ticker, resolveLevels(s, predictionForTicker));
 }
 return map;
 }, [stocks, predictionForTicker]);

 // إعداد الـ columns للجدول الموحّد
 const columns: Column<RadarStockRow>[] = useMemo(() => [
 {
 key: '_idx',
 header: '#',
 align: 'center',
 width: 'w-10',
 sortable: true,
 className: 'text-center text-muted-foreground font-mono text-xs',
 render: (r) => r._idx,
 },
 {
 key: 'ticker',
 header: 'السهم',
 sortable: true,
 filterable: true,
 hideable: true,
 render: (stock) => {
 const sInfo = stockInfoForTicker(stock.ticker);
 return (
 <div className="flex items-center gap-2">
 <StockIconMini
 ticker={stock.ticker}
 name={sInfo?.name_ar || sInfo?.name}
 sector={sectorForTicker(stock.ticker) || sInfo?.sector}
 logoUrl={sInfo?.logo_url}
 className="w-6 h-6"
 />
 <div className="flex flex-col">
 <div className="flex items-center gap-1.5">
 <span className="font-bold text-sm leading-tight">{stock.ticker}</span>
 {/* Task 23-C Deliverable 2 — inline Sharia badge next to each
 radar pick. EGX-only: badge shows "غير متاح" for other
 markets until their Sharia data is wired. */}
 {market === 'EGX' && (
 <ShariaBadge ticker={stock.ticker} variant="compact" />
 )}
 </div>
 {sInfo?.name_ar && (
 <span className="text-xs text-muted-foreground truncate max-w-[110px]">{sInfo.name_ar}</span>
 )}
 </div>
 {stock.isTracked && (
 <span className="h-1.5 w-1.5 rounded-full bg-warning" title="متابَع" />
 )}
 </div>
 );
 },
 },
 {
 key: 'current_price',
 header: 'السعر',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono font-semibold',
 render: (stock) => {
 const liveInfo = stockInfoForTicker(stock.ticker);
 const livePrice = liveInfo?.current_price ?? stock.current_price;
 // ─── FRESHNESS GUARD (Task FIX-STALE-DTPP) ────────────────────────
 // عرض badge صغير تحت السعر يوضّح لو البيانات fresh أو stale.
 // العميل لازم يعرف لو السعر ده فعلاً بتاع اليوم ولا قديم بـ 10 أيام.
 const q = stock.data_quality;
 const sd = stock.staleness_days;
 const src = stock.price_source;
 let badgeColor = 'bg-muted text-muted-foreground';
 let badgeText = '—';
 let badgeTitle = '';
 if (q === 'fresh') {
 badgeColor = 'bg-profit/15 text-profit ';
 badgeText = src === 'live' ? '🔴 live' : `✓ ${sd ?? 0}d`;
 badgeTitle = `بيانات حديثة — ${src === 'live' ? 'مصدر حي' : `آخر إغلاق ${sd ?? 0} يوم`} (data_date: ${stock.data_date ?? '?'})`;
 } else if (q === 'stale') {
 badgeColor = 'bg-warning/15 text-warning ';
 badgeText = `⚠️ ${sd}d`;
 badgeTitle = `بيانات قديمة (${sd} يوم) — آخر تحديث: ${stock.data_date ?? '?'}`;
 } else if (q === 'very_stale') {
 badgeColor = 'bg-loss/15 text-loss ';
 badgeText = `⛔ ${sd}d`;
 badgeTitle = `بيانات قديمة جداً (${sd} يوم) — السعر ده مش مظبوط! آخر تحديث: ${stock.data_date ?? '?'}`;
 } else if (q === 'unknown') {
 badgeColor = 'bg-muted text-muted-foreground';
 badgeText = '?';
 badgeTitle = 'بيانات freshness مش متاحة';
 }
 return (
 <div className="flex flex-col items-end gap-0.5">
 <FlashingPriceCell price={livePrice} />
 {q && (
 <span
 className={`text-xs px-1 rounded font-bold ${badgeColor}`}
 title={badgeTitle}
 >
 {badgeText}
 </span>
 )}
 </div>
 );
 },
 },
 {
 key: 'changePct',
 header: 'التغير%',
 align: 'right',
 sortable: true,
 filterable: true,
 render: (stock) => {
 const changePct = changePercentForTicker(stock.ticker);
 return <FlashingChangeCell changePct={changePct} />;
 },
 },
 {
 key: 'roc_10d',
 header: 'ROC10',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 const val = stock.roc_10d;
 return (
 <div className="flex flex-col items-end gap-0.5">
 <span className={`font-mono font-bold ${pnlColorClass(val)}`}>
 {fmtPct(val)}
 </span>
 {val != null && (
 <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
 <div
 className={`h-full rounded-full ${val >= 0 ? 'bg-profit' : 'bg-loss'}`}
 style={{ width: `${Math.min(100, Math.abs(val) * 6)}%` }}
 />
 </div>
 )}
 </div>
 );
 },
 },
 {
 key: 'roc_20d',
 header: 'ROC20',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 const r20 = stock.roc_30d != null && stock.roc_10d != null
 ? Math.round(((stock.roc_10d + stock.roc_30d) / 2) * 10) / 10
 : stock.roc_30d ?? stock.roc_10d;
 return (
 <span className={`font-mono font-semibold ${pnlColorClass(r20 ?? undefined)}`}>
 {fmtPct(r20)}
 </span>
 );
 },
 },
 {
 key: 'volume_ratio_10d_vs_20d',
 header: 'حجم نسبي',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 const volRatio = stock.volume_ratio_10d_vs_20d;
 const volHighlight = volRatio >= 1.4;
 return (
 <div className="flex flex-col items-end gap-0.5">
 <span className={`font-mono ${volHighlight ? 'text-profit font-bold' : ''}`}>
 {(volRatio ?? 0).toFixed(2)}×
 </span>
 {/* (ALPHA-FUNDAMENTALS-AND-TABS، Task 3): شارة الحجم النسبي > 1.2x.
     تأخذ relative_volume_10d الرسمي (برافو) أو volume_ratio_10d_vs_20d
     أو volume_surge كـ fallback. لو القيمة طبيعية → لا تظهر. */}
 <RelativeVolumeBadge
 relativeVolume10d={stock.relative_volume_10d}
 volumeRatio10dVs20d={stock.volume_ratio_10d_vs_20d}
 volumeSurge={stock.volume_surge}
 threshold={1.2}
 size="sm"
 />
 </div>
 );
 },
 },
 {
 // (ALPHA-FUNDAMENTALS-AND-TABS، Task 3): عمود السيولة الكاش المنفّذة —
 // value_traded بالمليون (مثال: 767M لـ COMI، 626M لـ KORA).
 // fallback على avg_turnover_20d لو value_traded مش متاح (pre-merge).
 key: 'value_traded',
 header: 'السيولة كاش',
 align: 'right',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 sortValue: (stock) => {
 const v = stock.value_traded ?? stock.avg_turnover_20d;
 return typeof v === 'number' && v > 0 ? v : -1;
 },
 render: (stock) => {
 const cash = stock.value_traded ?? stock.avg_turnover_20d;
 if (typeof cash !== 'number' || cash <= 0) {
 return <span className="text-muted-foreground text-xs">—</span>;
 }
 const formatted = cash >= 1e6
 ? `${(cash / 1e6).toFixed(1)}M`
 : cash >= 1e3
 ? `${(cash / 1e3).toFixed(0)}K`
 : cash.toFixed(0);
 // لون حسب الحجم: > 100M = سيولة قوية (أخضر)، 20-100M عادية، < 20M ضعيفة.
 const isStrong = cash >= 100e6;
 const isWeak = cash < 20e6;
 return (
 <span
 className={`font-semibold ${isStrong ? 'text-profit ' : isWeak ? 'text-muted-foreground' : 'text-foreground/80'}`}
 title={`القيمة المتداولة الكاش: ${cash.toLocaleString('en-US')} ج.م`}
 >
 {formatted}
 </span>
 );
 },
 },
 {
 key: 'rebound',
 header: 'الارتدادات',
 align: 'center',
 sortable: true,
 className: 'text-xs',
 render: (stock) => {
 const bounces = stock.pre_surge_details?.signal_count
 ? Math.min(4, Math.max(2, stock.pre_surge_details.signal_count))
 : stock.quiet_details?.signal_count
 ? Math.min(4, Math.max(1, stock.quiet_details.signal_count - 2))
 : 2;
 return (
 <div className="flex items-center justify-center gap-1">
 <span className={`font-mono font-semibold ${bounces >= 3 ? 'text-profit ' : 'text-foreground/80'}`}>
 {bounces}
 </span>
 <span className="text-xs text-muted-foreground whitespace-nowrap">
 {bounces >= 3 ? 'ارتدادات 🟢' : 'ارتداد'}
 </span>
 </div>
 );
 },
 },
 {
 key: '_sparkline',
 header: 'سبارك',
 align: 'center',
 width: 'w-[90px]',
 render: (stock) => (
 <MiniSparkline ticker={stock.ticker} height={24} width={80} showArea={true} />
 ),
 },
 {
 key: 'liquidity_pct',
 header: 'سيولة %',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs font-mono',
 render: (stock) => {
 const liq = stock.buy_pct ?? (stock.liquidity_state === 'مرتفعة' ? 76 : stock.liquidity_state === 'عادية' ? 54 : 38);
 const isHigh = liq >= 60;
 const isLow = liq <= 40;
 return (
 <div className="flex flex-col items-center gap-0.5">
 <span className={`font-bold ${isHigh ? 'text-profit ' : isLow ? 'text-loss ' : 'text-muted-foreground'}`}>
 {liq}%
 </span>
 <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
 <div
 className={`h-full rounded-full ${isHigh ? 'bg-profit' : isLow ? 'bg-loss' : 'bg-warning'}`}
 style={{ width: `${Math.min(100, liq)}%` }}
 />
 </div>
 </div>
 );
 },
 },
 {
 key: 'net_flow_egp',
 header: 'Net Flow',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'font-mono text-xs',
 render: (stock) => {
 // P0-4 FIX (RADAR-AUDIT-UI): أزلنا fabrication net_flow_egp بـ 3.5M fallback.
 // القيمة الحقيقية من radar cache أو لا شيء (Rule 27 NO-FAKE-DATA).
 const flowVal = (stock.net_flow_egp && stock.net_flow_egp !== 0)
 ? stock.net_flow_egp
 : null;
 if (flowVal === null) {
 return <span className="text-muted-foreground text-xs">—</span>;
 }
 const sign = flowVal >= 0 ? '+' : '';
 const absVal = Math.abs(flowVal);
 const formatted = absVal >= 1e6 ? `${(absVal / 1e6).toFixed(1)}M` : `${(absVal / 1e3).toFixed(0)}K`;
 return (
 <span className={`font-semibold ${flowVal >= 0 ? 'text-profit ' : 'text-loss '}`}>
 {sign}{formatted}
 </span>
 );
 },
 },
 // NEW (Task IMPROVEMENT-18-2026-10-07): money_flow_state column
 // عرض حالة السيولة (🔥 دخول قوي / 🔴 خروج قوي / 🟢 داخلة / 🔴 خارجة)
 {
 key: 'money_flow_state',
 header: 'حالة السيولة',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs',
 sortValue: (stock) => String(stock.money_flow_state || '⚪ متوازنة'),
 filterValue: (stock) => String(stock.money_flow_state || '⚪ متوازنة'),
 render: (stock) => {
 const state = String(stock.money_flow_state || '⚪ متوازنة');
 let bgClass = 'bg-muted/30 text-muted-foreground border-border';
 if (state.includes('🔥 دخول') || state.includes('🟢 سيولة داخلة')) {
 bgClass = 'bg-profit/10 text-profit border border-profit/20 border-profit/20 ';
 } else if (state.includes('🔥 خروج') || state.includes('🔴 سيولة خارجة')) {
 bgClass = 'bg-loss/10 text-loss border border-loss/20 border-loss/20 ';
 } else if (state.includes('⚪')) {
 bgClass = 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-warning/20 ';
 }
 return (
 <Badge variant="outline" className={`text-xs font-bold ${bgClass}`}>
 {state}
 </Badge>
 );
 },
 },
 // NEW (Task IMPROVEMENT-18-2026-10-07): buy/sell pressure column
 // عرض ضغط الشراء vs البيع (buy_value_m vs sell_value_m)
 {
 key: 'buy_sell_pressure',
 header: 'ضغط شراء/بيع',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs font-mono',
 sortValue: (stock) => Number(stock.buy_pct ?? 50),
 filterValue: (stock) => String(stock.buy_pct ?? 50),
 render: (stock) => {
 const buyPct = stock.buy_pct ?? 50;
 const sellPct = 100 - buyPct;
 const buyVal = Number(stock.buy_value_m ?? 0);
 const sellVal = Number(stock.sell_value_m ?? 0);
 const isBuyDominant = buyPct >= 60;
 const isSellDominant = sellPct >= 60;
 return (
 <div className="flex flex-col items-center gap-1">
 <div className="flex items-center gap-2 text-xs font-mono">
 <span className={`font-bold ${isBuyDominant ? 'text-profit ' : 'text-muted-foreground'}`}>
 🟢 {(buyPct ?? 0).toFixed(0)}%
 </span>
 <span className="text-muted-foreground">|</span>
 <span className={`font-bold ${isSellDominant ? 'text-loss ' : 'text-muted-foreground'}`}>
 🔴 {(sellPct ?? 0).toFixed(0)}%
 </span>
 </div>
 <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden flex">
 <div
 className="h-full bg-profit"
 style={{ width: `${buyPct}%` }}
 />
 <div
 className="h-full bg-loss"
 style={{ width: `${sellPct}%` }}
 />
 </div>
 {buyVal > 0 && (
 <div className="text-xs text-muted-foreground">
 شراء: {(buyVal).toFixed(1)}M | بيع: {(sellVal).toFixed(1)}M
 </div>
 )}
 </div>
 );
 },
 },
 {
 key: 'markup_cycle',
 header: 'دورة الصعود',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs',
 render: (stock) => {
 if (stock.kill_switch) {
 return <Badge variant="outline" className="text-xs text-loss border-loss bg-loss/10">⚠️ تدوير وهمي</Badge>;
 }
 let cycle = stock.life_cycle && stock.life_cycle !== 'عادي' ? stock.life_cycle : null;
 if (!cycle) {
 if (stock.path === 'A_pre_surge') cycle = 'بداية انطلاق';
 else if (stock.path === 'D_explosive_surge') cycle = '🔥 انفجار نشط';
 else if (stock.path === 'E_early_break') cycle = '⚡ اختراق مبكر';
 else cycle = '🎯 تجميع قاع';
 }
 return (
 <span className="text-xs font-medium text-foreground/90 whitespace-nowrap">
 {cycle}
 </span>
 );
 },
 },
 {
 key: 'accumulation',
 header: 'تجميع/تصريف',
 align: 'center',
 sortable: true,
 filterable: true,
 className: 'text-xs',
 render: (stock) => {
 // CANONICAL-CALCULATIONS (Task CALC-DUP-1): accum الآن يأتي من backend
 // باستخدام canonical_signal.classify_accumulation(buy_pct) — لا حاجة
 // لـ frontend fallback. الـ fallback القديم كان بيعطي نتائج متضاربة
 // مع الـ backend (وكان بيخفي bug الـ buy_days_count القديم).
 const accum = stock.accumulation || 'محايد';
 const isStrong = accum.includes('تجميع قوي');
 const isDist = accum.includes('تصريف');
 return (
 <Badge
 variant="outline"
 className={`text-xs h-5 px-1.5 whitespace-nowrap ${
 isStrong
 ? 'bg-profit/10 text-profit border border-profit/20 border-profit/20 font-semibold'
 : isDist
 ? 'bg-loss/10 text-loss border border-loss/20 border-loss/20 font-semibold'
 : 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-warning/20 '
 }`}
 >
 {accum}
 </Badge>
 );
 },
 },
 {
 key: 'frequency',
 header: 'التردد',
 align: 'center',
 sortable: true,
 className: 'font-mono text-xs',
 // ALPHA-MAKER-RADAR-NO-FAB: ADR ليس من API → لا fabrication (Rule 20+27).
 // range_10d_pct/2.8 كان fabrication — اتشال. ADR يحتاج ATR من Python.
 sortValue: () => -1,
 render: () => (
 <span className="text-muted-foreground font-mono">—</span>
 ),
 },
 {
 key: 'expected',
 header: 'المتوقع',
 align: 'center',
 sortable: true,
 className: 'text-xs',
 // ALPHA-MAKER-RADAR-NO-FAB: expected gain من pred.target_price فقط (Rule 20+27).
 // range_10d_pct/2 fallback كان fabrication — اتشال.
 sortValue: (stock) => {
 const pred = predictionForTicker(stock.ticker);
 if (pred?.target_price && pred.target_price > 0 && stock.current_price > 0) {
 return ((pred.target_price - stock.current_price) / stock.current_price * 100);
 }
 return -1;
 },
 render: (stock) => {
 // ALPHA-MAKER-RADAR-NO-FAB: expected gain من pred.target_price فقط (Rule 20+27).
 // range_10d_pct/2 fallback كان fabrication — اتشال. لو مفيش توقع → "—".
 const pred = predictionForTicker(stock.ticker);
 if (pred?.target_price && stock.current_price) {
 const expGain = ((pred.target_price - stock.current_price) / stock.current_price * 100);
 return (
 <div className="flex flex-col items-center leading-tight">
 <span className="text-profit font-bold font-mono text-xs">
 +{(expGain ?? 0).toFixed(0)}%
 </span>
 <span className="text-xs text-muted-foreground whitespace-nowrap">
 خلال 7-14ي
 </span>
 </div>
 );
 }
 // لا توقع متاح
 return (
 <div className="flex flex-col items-center leading-tight bg-warning/10 /10 rounded px-1">
 <span className="text-muted-foreground font-mono text-xs">—</span>
 </div>
 );
 },
 },
 {
 key: 'trigger',
 header: 'التفعيل',
 align: 'center',
 sortable: true,
 className: 'font-mono text-xs',
 // (UNIFIED-TABLE-UPGRADE) sortValue: trigger price (null → -1)
 // Dual-Tier: AI entry_price first, then technical current_price fallback.
 sortValue: (stock) => {
 const levels = levelsByTicker.get(stock.ticker);
 const entry = levels?.entry ?? null;
 return entry != null && entry > 0 ? entry : -1;
 },
 render: (stock) => {
 // (UNIFIED-TABLE-UPGRADE) Dual-Tier: استخدم levelsByTicker بدلاً من قراءة
 // predictionForTicker مباشرة عشان يبقى متوافق مع sortValue + badge.
 const levels = levelsByTicker.get(stock.ticker);
 const trig = levels?.entry ?? null;
 const source = levels?.source ?? 'none';
 if (trig === null || trig <= 0) {
 return <span className="font-mono text-muted-foreground">—</span>;
 }
 const badge = source === 'ai' ? '🤖' : source === 'technical' ? '📊' : '';
 return (
 <span className="font-mono font-bold text-warning inline-flex items-center gap-1">
 {badge && <span title={source === 'ai' ? 'توقع AI' : 'مستوى فني'}>{badge}</span>}
 {fmtNum(trig)}
 </span>
 );
 },
 },
 {
 key: 'price_targets',
 header: 'السعر',
 align: 'right',
 sortable: true,
 className: 'font-mono text-xs',
 // (UNIFIED-TABLE-UPGRADE) Dual-Tier: sortValue = target_price (null → -1)
 // نرتّب حسب الهدف لأنه أهم قيمة في القرار.
 sortValue: (stock) => {
 const levels = levelsByTicker.get(stock.ticker);
 const t = levels?.target ?? null;
 return t != null && t > 0 ? t : -1;
 },
 render: (stock) => {
 // (UNIFIED-TABLE-UPGRADE) Dual-Tier Levels Engine:
 // 🤖 توصية AI لو predMap فيه entry_price
 // 📊 مستوى فني لو محسوب من support/resistance (real numbers > 0)
 // — لو مفيش لا ده ولا ده (Rule 27: لا fabrication)
 const levels = levelsByTicker.get(stock.ticker);
 const source = levels?.source ?? 'none';
 const tPrice = levels?.target ?? null;
 const slPrice = levels?.stop ?? null;
 const rr = levels?.riskReward ?? null;
 const badge = source === 'ai'
 ? '🤖 توقع AI'
 : source === 'technical'
 ? '📊 مستوى فني'
 : null;
 const badgeCls = source === 'ai'
 ? 'bg-profit/15 text-profit '
 : source === 'technical'
 ? 'bg-warning/15 text-warning '
 : 'bg-muted text-muted-foreground';

 if (tPrice === null && slPrice === null) {
 // لا توقع ولا مستويات فنية
 return (
 <div className="flex flex-col text-xs leading-tight font-mono bg-warning/10 /10 rounded p-1 gap-0.5">
 <span className="text-muted-foreground text-center">— راجع التحليل</span>
 {badge && <span className={`text-[8px] px-1 rounded text-center ${badgeCls}`}>{badge}</span>}
 </div>
 );
 }

 return (
 <div className="flex flex-col text-xs leading-tight font-mono gap-0.5">
 {tPrice !== null && (
 <div className="flex gap-1 justify-between">
 <span className="text-muted-foreground">هدف:</span>
 <span className="text-profit font-bold">{fmtNum(tPrice)}</span>
 </div>
 )}
 {slPrice !== null && (
 <div className="flex gap-1 justify-between">
 <span className="text-muted-foreground">وقف:</span>
 <span className="text-loss ">{fmtNum(slPrice)}</span>
 </div>
 )}
 {rr !== null ? (
 <div className="text-xs text-muted-foreground text-center">1:{(rr ?? 0).toFixed(1)} RR</div>
 ) : (
 <div className="text-xs text-muted-foreground/60 text-center">RR: —</div>
 )}
 {badge && <span className={`text-[8px] px-1 rounded text-center ${badgeCls}`}>{badge}</span>}
 </div>
 );
 },
 },
 {
 key: 'action',
 header: 'الحركة',
 align: 'center',
 sortable: true,
 className: 'text-xs',
 render: (stock) => {
 // P0-3 FIX (RADAR-AUDIT-UI): أزلنا fabrication "دخول فوري" / "اختراق وشيك".
 // قرار التداول يجب أن يأتي من Python (Rule 20 Python=Brain) عبر unified API
 // canonical.signal (Rule 73 SINGLE-DISPLAY-SOURCE). لا قرار تداول client-side.
 const pred = predictionForTicker(stock.ticker);
 if (stock.kill_switch) {
 return (
 <Badge variant="outline" className="text-xs h-5 px-1.5 whitespace-nowrap bg-loss/10 text-loss border border-loss/20 border-loss">
 ⚠️ حذر
 </Badge>
 );
 }
 // اعرض canonical signal من prediction (لو متوفر) بدل fabrication.
 if (pred?.signal_ar) {
 return (
 <Badge variant="outline" className="text-xs h-5 px-1.5 whitespace-nowrap bg-profit/10 text-profit border border-profit/20 border-profit">
 {pred.signal_ar}
 </Badge>
 );
 }
 // لا توقع → لا قرار client-side. اعرض توجيه للـ canonical API.
 return (
 <Badge variant="outline" className="text-xs h-5 px-1.5 whitespace-nowrap bg-muted text-muted-foreground border-border">
 راجع التوصية الرسمية
 </Badge>
 );
 },
 },
 {
 key: 'isTracked',
 header: '⭐',
 align: 'center',
 width: 'w-8',
 sortable: true,
 render: (stock) => (
 <button
 onClick={(e) => { e.stopPropagation(); onTrackToggle(stock.ticker, stock.current_price, !!stock.isTracked); }}
 className="text-muted-foreground hover:text-warning transition-colors p-1 rounded"
 title={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
 aria-label={stock.isTracked ? 'إزالة من المتابعة' : 'أضف للمتابعة'}
 >
 {stock.isTracked ? (
 <Star className="h-4 w-4 fill-warning text-warning" />
 ) : (
 <StarOff className="h-4 w-4" />
 )}
 </button>
 ),
 },
 ], [a.badge, changePercentForTicker, onSelect, onTrackToggle, predictionForTicker, sectorForTicker, stockInfoForTicker, levelsByTicker]);

 // إضافة index وحساب السعر والتغير اللحظي لكل صف لضمان الترتيب الحي
 const data: RadarStockRow[] = useMemo(
 () => stocks.map((s, i) => {
 const live = stockInfoForTicker(s.ticker);
 return {
 ...s,
 current_price: live?.current_price ?? s.current_price,
 changePct: live?.change_percent ?? s.roc_10d ?? 0,
 _idx: i + 1,
 };
 }),
 [stocks, stockInfoForTicker],
 );

 return (
 <UnifiedTable<RadarStockRow>
 columns={columns}
 data={data}
 keyField="ticker"
 dense
 columnToggle
 filterable
 onRowClick={(row) => onSelect(row.ticker, row)}
 rowClassName={(_row, idx) => (idx % 2 === 1 ? 'bg-muted/20' : undefined)}
 className={`-mx-1 ${a.border}`}
 publishable
 publishTitle="رادار السيولة — فرص اليوم"
 publishFilename={`maker-radar-${new Date().toISOString().slice(0,10)}`}
 publishHashtags={['رادار_السيولة', 'EGX', 'بورصة_مصر', 'تداول', 'استثمار']}
 />
 );
});

// ============================================================================
// Stock Detail Drawer
// ============================================================================
export function StockDetailDrawer({
 ticker, radarStock, sectorForTicker, sectorChangeForTicker, onClose, onTrackToggle,
}: StockDetailDrawerProps) {
 const t = useTranslation();
 const [detail, setDetail] = useState<StockDetail | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const loadStockDetail = useAppStore((s) => s.loadStockDetail);
 // ref للـ drawer content عشان نقدر نلتقطه كصورة للنشر
 const drawerContentRef = useRef<HTMLDivElement>(null);

 const fetchDetail = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const res = await fetch(`/api/maker-radar/stock?ticker=${ticker}&days=30`, { cache: 'no-store' });
 const json = await res.json();
 if (json.success) {
 setDetail(json);
 } else if (!json.warming_up) {
 setError(json.error || 'فشل تحميل البيانات');
 }
 // if warming_up, keep existing data silently
 } catch (e) {
 setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
 } finally {
 setLoading(false);
 }
 }, [ticker]);

 useEffect(() => { fetchDetail(); }, [fetchDetail]);

 const handleTrack = async () => {
 if (!detail?.stats?.lastClose) return;
 await onTrackToggle(ticker, detail.stats.lastClose, !!detail?.tracking?.isTracked);
 fetchDetail();
 };

 // sparkline geometry
 const sparkline = useMemo(() => {
 if (!detail?.prices || detail.prices.length < 2) return null;
 const prices = detail.prices.map((p) => p.close).filter((c) => c > 0);
 if (prices.length < 2) return null;
 const min = Math.min(...prices);
 const max = Math.max(...prices);
 const range = max - min || 1;
 const w = 320;
 const h = 60;
 const points = prices.map((p, i) => {
 const x = (i / (prices.length - 1)) * w;
 const y = h - ((p - min) / range) * h;
 return `${(x ?? 0).toFixed(1)},${(y ?? 0).toFixed(1)}`;
 }).join(' ');
 const isUp = prices[prices.length - 1] >= prices[0];
 const firstP = prices[0];
 const lastP = prices[prices.length - 1];
 const totalChange = firstP > 0 ? ((lastP - firstP) / firstP) * 100 : 0;
 return { points, isUp, w, h, min, max, totalChange };
 }, [detail]);

 const sector = sectorForTicker(ticker);
 const sectorChange = sectorChangeForTicker(ticker);
 const stockInfo = detail?.stock_info;

 return (
 <>
 {/* sticky header */}
 <div className="flex items-center justify-between p-3 border-b border-border bg-background sticky top-0 z-10">
 <div className="flex items-center gap-2 flex-wrap">
 <DialogTitle className="text-base font-bold">{ticker}</DialogTitle>
 {(stockInfo?.name_ar || stockInfo?.name) && (
 <span className="text-xs text-muted-foreground truncate max-w-[200px]">
 {stockInfo.name_ar || stockInfo.name}
 </span>
 )}
 {sector && (
 <Badge variant="outline" className="text-xs">
 <Layers className="h-3 w-3 ml-1" />
 {sector}
 </Badge>
 )}
 {sectorChange != null && (
 <Badge variant="outline" className={`text-xs ${pnlColorClass(sectorChange)}`}>
 القطاع {fmtPct(sectorChange)}
 </Badge>
 )}
 {/* RADAR-QUICK-WINS (Priority 1): Path badge + inline signal meter */}
 {radarStock?.path && (
 <Badge variant="outline" className={`text-xs ${accentClasses[pathMeta[radarStock.path].accent].badge}`} title={t(`predictions.makerRadar.paths.${radarStock.path}.descLong`)}>
 <span className="ml-0.5">{PATH_DESC[radarStock.path].emoji}</span>
 {t(`predictions.makerRadar.paths.${radarStock.path}.descShort`)}
 </Badge>
 )}
 {(() => {
 const sc = resolveSignalCount(radarStock);
 const mx = resolveMaxSignals(radarStock?.path ?? null);
 if (sc == null || mx == null) return null;
 return (
 <div className="hidden sm:flex" title={signalHintAr(signalsToStars(sc, mx))}>
 <SignalStrengthMeter signalCount={sc} maxSignals={mx} size="sm" showBar={false} />
 </div>
 );
 })()}
 </div>
 <div className="flex items-center gap-1">
 {detail && (
 <UnifiedPublishButton
 content={buildStockDetailShareText(
 ticker,
 stockInfo?.name_ar || stockInfo?.name,
 {
 price: detail.stats?.lastClose,
 changePct: detail.stats?.changePct,
 entryLow: detail.entryCard?.entryLow,
 entryHigh: detail.entryCard?.entryHigh,
 target1: detail.entryCard?.target1,
 target2: detail.entryCard?.target2,
 stopLoss: detail.entryCard?.stopLoss,
 rr: detail.entryCard?.rr,
 accumulation: detail.entryCard?.accumulation,
 upcycle: detail.entryCard?.upcycle,
 signal: detail.entryCard?.signal,
 },
 )}
 title={`تحليل سهم: ${ticker}`}
 image={drawerContentRef}
 filename={`analysis-${ticker}-${new Date().toISOString().slice(0,10)}`}
 hashtags={['بورصة_مصر', 'EGX', 'تحليل_فني', ticker]}
 triggerLabel="نشر التحليل"
 variant="outline"
 size="sm"
 ticker={ticker}
 />
 )}
 {detail && (
 <Button
 size="sm"
 variant={detail.tracking?.isTracked ? 'default' : 'outline'}
 onClick={handleTrack}
 className="h-8"
 disabled={loading}
 >
 {detail.tracking?.isTracked ? (
 <><Star className="h-3.5 w-3.5 fill-current" /> متابَع</>
 ) : (
 <><StarOff className="h-3.5 w-3.5" /> أضف للمتابعة</>
 )}
 </Button>
 )}
 <Button size="sm" variant="ghost" onClick={() => loadStockDetail(ticker)} className="h-8" title="افتح صفحة السهم الكاملة">
 <BarChart3 className="h-3.5 w-3.5 ml-1" />
 <span className="hidden sm:inline">صفحة السهم</span>
 </Button>
 <DialogClose asChild>
 <Button size="sm" variant="ghost" onClick={onClose} className="h-8 w-8 p-0">
 <X className="h-4 w-4" />
 </Button>
 </DialogClose>
 </div>
 </div>

 <div ref={drawerContentRef} className="flex-1 overflow-y-auto p-3 md:p-4 bg-muted/10">
 {loading && (
 <div className="space-y-3">
 <Skeleton className="h-24 w-full" />
 <Skeleton className="h-48 w-full" />
 <Skeleton className="h-32 w-full" />
 </div>
 )}

 {error && !loading && (
 <Card className="p-6 text-center">
 <AlertTriangle className="h-8 w-8 text-loss mx-auto mb-2" />
 <p className="text-sm text-muted-foreground">{error}</p>
 <Button size="sm" variant="outline" onClick={fetchDetail} className="mt-3">
 <RefreshCw className="h-4 w-4 ml-1" /> إعادة
 </Button>
 </Card>
 )}

 {detail && !loading && (
 <div className="space-y-3">
 {/* === Price + sparkline === */}
 <Card className="p-3">
 <div className="flex items-center justify-between mb-2">
 <div>
 <div className="text-xs text-muted-foreground">السعر الحالي</div>
 <div className="text-2xl font-bold font-mono">
 {fmtNum(detail.stats?.lastClose ?? 0)}
 <span className="text-xs text-muted-foreground mr-1">EGP</span>
 </div>
 </div>
 <div className="text-left">
 <div className="text-xs text-muted-foreground">تغير {detail.stats?.dataPoints ?? 0} يوم</div>
 <div className={`text-lg font-bold font-mono ${pnlColorClass(detail.stats?.changePct)}`}>
 {fmtPct(detail.stats?.changePct)}
 </div>
 </div>
 </div>
 {sparkline && (
 <div className="mt-2">
 <svg viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} className="w-full h-14" preserveAspectRatio="none">
 <defs>
 <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
 <stop offset="0%" stopColor={sparkline.isUp ? '#10b981' : '#f43f5e'} stopOpacity="0.3" />
 <stop offset="100%" stopColor={sparkline.isUp ? '#10b981' : '#f43f5e'} stopOpacity="0" />
 </linearGradient>
 </defs>
 <polyline
 points={`0,${sparkline.h} ${sparkline.points} ${sparkline.w},${sparkline.h}`}
 fill="url(#sparkGrad)"
 stroke="none"
 />
 <polyline
 points={sparkline.points}
 fill="none"
 stroke={sparkline.isUp ? '#10b981' : '#f43f5e'}
 strokeWidth="1.5"
 />
 </svg>
 <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
 <span>أدنى: {fmtNum(sparkline.min)}</span>
 <Badge variant="outline" className={sparkline.isUp ? 'text-profit' : 'text-loss'}>
 {sparkline.isUp ? <TrendingUp className="h-3 w-3 ml-1" /> : <TrendingDown className="h-3 w-3 ml-1" />}
 {fmtPct(sparkline.totalChange)}
 </Badge>
 <span>أعلى: {fmtNum(sparkline.max)}</span>
 </div>
 </div>
 )}
 </Card>

 {/* === Tracking banner === */}
 {detail.tracking?.isTracked && (
 <Card className="p-3 bg-warning/10 /20 border-warning/20">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Star className="h-4 w-4 fill-warning text-warning" />
 <span className="text-xs font-medium">
 تحت المتابعة منذ {detail.tracking.entryDate}
 </span>
 </div>
 <div className="text-left">
 <div className={`text-sm font-bold ${pnlColorClass(detail.tracking.changeSinceTracking)}`}>
 {fmtPct(detail.tracking.changeSinceTracking)}
 </div>
 <div className="text-xs text-muted-foreground">
 {detail.tracking.daysTracked} يوم · من {fmtNum(detail.tracking.entryPrice)} لـ {fmtNum(detail.tracking.currentPrice)}
 </div>
 </div>
 </div>
 </Card>
 )}

 {/* === Stats grid === */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 <StatCard
 label="ROC 10 أيام"
 value={fmtPct(detail.stats?.roc10d)}
 valueClass={pnlColorClass(detail.stats?.roc10d)}
 icon={<Gauge className="h-3 w-3" />}
 />
 <StatCard
 label="مدى 20 يوم"
 value={`${(detail.stats?.range20Pct ?? 0).toFixed(1)}%`}
 sub={`${fmtNum(detail.stats?.min20)} - ${fmtNum(detail.stats?.max20)}`}
 icon={<Activity className="h-3 w-3" />}
 />
 <StatCard
 label="متوسط حجم 20 يوم"
 value={fmtMoney(detail.stats?.avgVolume20)}
 icon={<BarChart3 className="h-3 w-3" />}
 />
 <StatCard
 label="متوسط سيولة 20 يوم"
 value={fmtMoney(detail.stats?.avgTurnover20)}
 sub="EGP"
 icon={<Gauge className="h-3 w-3" />}
 />
 </div>

 {/* === Sector context === */}
 {sector && sectorChange != null && (
 <Card className="p-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Layers className="h-4 w-4 text-primary " />
 <div>
 <div className="text-xs font-semibold">قطاع: {sector}</div>
 <div className="text-xs text-muted-foreground">أداء القطاع اليوم</div>
 </div>
 </div>
 <div className={`text-base font-bold ${pnlColorClass(sectorChange)}`}>
 {fmtPct(sectorChange)}
 </div>
 </div>
 </Card>
 )}

 {/* === Fundamentals — بيظهر دايماً (حتى لو ناقص) === */}
 {stockInfo && (
 <Card className="p-3">
 <div className="flex items-center gap-1.5 mb-2">
 <Info className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-xs font-semibold">البيانات الأساسية</span>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 <FundamentalField label="P/E" value={stockInfo.pe_ratio != null ? stockInfo.pe_ratio.toFixed(2) : null} />
 <FundamentalField label="P/B" value={stockInfo.pb_ratio != null ? stockInfo.pb_ratio.toFixed(2) : null} />
 <FundamentalField label="P/S" value={stockInfo.ps_ratio != null ? stockInfo.ps_ratio.toFixed(2) : null} />
 <FundamentalField label="ROE" value={stockInfo.roe != null ? `${stockInfo.roe.toFixed(1)}%` : null} />
 <FundamentalField label="ROA" value={stockInfo.roa != null ? `${stockInfo.roa.toFixed(1)}%` : null} />
 <FundamentalField label="EPS" value={stockInfo.eps != null ? fmtNum(stockInfo.eps) : null} />
 <FundamentalField label="القيمة السوقية" value={stockInfo.market_cap != null ? `${fmtMoney(stockInfo.market_cap)} EGP` : null} />
 <FundamentalField label="توزيعات" value={stockInfo.dividend_yield != null ? `${stockInfo.dividend_yield.toFixed(2)}%` : null} />
 <FundamentalField label="دعم" value={stockInfo.support != null ? fmtNum(stockInfo.support) : null} />
 <FundamentalField label="مقاومة" value={stockInfo.resistance != null ? fmtNum(stockInfo.resistance) : null} />
 <FundamentalField label="أعلى 52أ" value={stockInfo.high_52w != null ? fmtNum(stockInfo.high_52w) : null} />
 <FundamentalField label="أدنى 52أ" value={stockInfo.low_52w != null ? fmtNum(stockInfo.low_52w) : null} />
 </div>
 </Card>
 )}

 {/* === Last 10 days price table === */}
 {detail.prices && detail.prices.length > 0 && (
 <Card className="p-3">
 <div className="text-xs font-semibold mb-2">آخر {Math.min(detail.prices.length, 10)} أيام</div>
 <div className="overflow-x-auto -mx-3 md:mx-0">
 <table className="w-full text-xs">
 <thead>
 <tr className="text-muted-foreground border-b border-border/50">
 <th className="text-right py-1.5 px-2 font-medium">التاريخ</th>
 <th className="text-right py-1.5 px-2 font-medium">إغلاق</th>
 <th className="text-right py-1.5 px-2 font-medium hidden sm:table-cell">أعلى</th>
 <th className="text-right py-1.5 px-2 font-medium hidden sm:table-cell">أقل</th>
 <th className="text-right py-1.5 px-2 font-medium">حجم</th>
 </tr>
 </thead>
 <tbody>
 {detail.prices.slice(-10).reverse().map((p) => (
 <tr key={p.date} className="border-b border-border/30">
 <td className="py-1.5 px-2 text-muted-foreground">{p.date}</td>
 <td className="py-1.5 px-2 font-mono font-semibold">{fmtNum(p.close)}</td>
 <td className="py-1.5 px-2 font-mono hidden sm:table-cell">{fmtNum(p.high)}</td>
 <td className="py-1.5 px-2 font-mono hidden sm:table-cell">{fmtNum(p.low)}</td>
 <td className="py-1.5 px-2 font-mono text-muted-foreground">{fmtMoney(p.volume)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </Card>
 )}

 {/* === Price Statistics — إحصائيات السعر المخفية === */}
 {detail.stats && (
 <Card className="p-3">
 <div className="flex items-center gap-1.5 mb-2">
 <Activity className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-xs font-semibold">إحصائيات السعر (20 يوم)</span>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 <FundamentalField label="متوسط حجم" value={detail.stats.avgVolume20 != null ? fmtMoney(detail.stats.avgVolume20) : null} />
 <FundamentalField label="متوسط تداول" value={detail.stats.avgTurnover20 != null ? `${fmtMoney(detail.stats.avgTurnover20)} EGP` : null} />
 <FundamentalField label="أعلى 20ي" value={detail.stats.max20 != null ? fmtNum(detail.stats.max20) : null} />
 <FundamentalField label="أدنى 20ي" value={detail.stats.min20 != null ? fmtNum(detail.stats.min20) : null} />
 <FundamentalField label="المدى" value={detail.stats.range20Pct != null ? `${detail.stats.range20Pct.toFixed(1)}%` : null} />
 <FundamentalField label="ROC 10ي" value={detail.stats.roc10d != null ? `${detail.stats.roc10d.toFixed(2)}%` : null} />
 <FundamentalField label="نقاط بيانات" value={detail.stats.dataPoints != null ? `${detail.stats.dataPoints} يوم` : null} />
 </div>
 </Card>
 )}

 {/* === Trading Plan (real numbers + dynamic analysis from price history) ===
 RADAR-QUICK-WINS (Priority 1): now enhanced into a Smart Entry
 Card — path description, entry zone, target_1/target_2/stop_loss
 grid, position-size badge, and the SignalStrengthMeter. */}
 <TradingPlanSection detail={detail} radarStock={radarStock} />

 {/* === Entry Timing Signal — توقيت الدخول الذكي (0-100) === */}
 <EntryTimingCard ticker={ticker} />

 {/* === Signal Tracking Timeline — رحلة الإشارة (L2) ===
 Visual timeline of the tracked stock's journey from entry until now.
 Only renders for tracked stocks (has tracking?.isTracked). */}
 {detail.tracking?.isTracked && (
 <SignalTrackingTimeline ticker={ticker} />
 )}

 {/* === Liquidity Footprint — بصمة السيولة (Volume Profile) === */}
 <LiquidityFootprintCard ticker={ticker} />

 {/* === Company Fundamentals — بيانات الشركة المالية (8 جداول) === */}
 <CompanyFundamentalsCard ticker={ticker} />

 {/* === Market Depth / DOM (Liquidity Depth Widget) ===
 Reconstructed from stock_intraday tick volume — see API route. */}
 <SafeWidget name="MarketDepthLiquidityWidget" fallback={
 <Card className="p-3 border-dashed border-muted-foreground/30">
 <div className="text-xs text-muted-foreground text-center">
 تعذّر تحميل دفتر الأوامر لهذا السهم
 </div>
 </Card>
 }>
 <MarketDepthLiquidityWidget ticker={ticker} compact />
 </SafeWidget>

 {/* === Market Intelligence — خريطة الكنوز (intraday + fundamentals + price history) === */}
 <MarketIntelligenceCard ticker={ticker} />
 </div>
 )}
 </div>
 </>
 );
}

export { StockTable };
