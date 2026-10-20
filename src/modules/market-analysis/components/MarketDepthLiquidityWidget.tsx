'use client';

/**
 * MarketDepthLiquidityWidget — DOM / دفتر الأوامر
 * ===============================================
 * Reconstructs a Level-2-style order book view from real intraday tick data
 * (db/intraday.db.stock_intraday aggregated by price bucket). The widget is
 * NOT a true exchange DOM (EGX doesn't publish Level-2 publicly) — it shows
 * "liquidity depth": where actual trade volume clustered above/below the
 * current price during the latest trading session.
 *
 * Data source: GET /api/stocks/[ticker]/depth?levels=5
 *
 * Layout (RTL):
 * ┌─────────────────────────────────────────────┐
 * │ Ticker · Current Price · Spread · Signal │
 * ├─────────────────────────────────────────────┤
 * │ Asks (sell pressure) │ Bids (buy) │
 * │ ──── red bars │ green bars ──── │
 * │ ▓▓▓▓▓ 140.50 120K │ 138.50 90K ▓▓▓ │
 * │ ▓▓▓ 140.00 60K │ 138.25 45K ▓ │
 * │ ─────── current ───── │ ──── current ──── │
 * │ [Current Price 139.28] │
 * ├─────────────────────────────────────────────┤
 * │ Buy ◀███████░░░░░░░░░░░░░░░░▶ Sell │
 * │ Imbalance: -72% → ضغط بيعي │
 * └─────────────────────────────────────────────┘
 *
 * No mock data. Numbers come exclusively from the API (SQLite-backed).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
 Activity, TrendingUp, TrendingDown, Loader2, AlertTriangle,
 RefreshCw, Layers, Scale,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, fmtPrice } from '@/lib/utils';

// ============================================================================
// Types — mirror the API contract
// ============================================================================
interface DepthLevel {
 price: number;
 volume: number;
 orders: number;
 distance_pct: number;
}

interface DepthResponse {
 success: boolean;
 ticker: string;
 current_price: number;
 bids: DepthLevel[];
 asks: DepthLevel[];
 spread: number;
 total_bid_volume: number;
 total_ask_volume: number;
 imbalance: number;
 interpretation: 'buy_pressure' | 'sell_pressure' | 'balanced';
 source: string;
 generated_at: string;
 note?: string;
 error?: string;
}

interface WidgetProps {
 ticker: string;
 compact?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================
function fmtVol(n: number | null | undefined): string {
 if (n == null || !Number.isFinite(n)) return '0';
 const abs = Math.abs(n);
 if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
 if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'K';
 return (n ?? 0).toFixed(0);
}

// P0-COMPONENT-UNIFICATION Phase 2.7: removed local fmtPrice — now imported from '@/lib/utils'.
// (was: function fmtPrice(n) { if (n == null...) return '—'; return n.toFixed(2); })

function fmtPct(n: number | null | undefined): string {
 if (n == null || !Number.isFinite(n)) return '0.0%';
 return (n * 100).toFixed(1) + '%';
}

// ============================================================================
// Main Component
// ============================================================================
export function MarketDepthLiquidityWidget({ ticker, compact = false }: WidgetProps) {
 const [data, setData] = useState<DepthResponse | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const fetchData = useCallback(async () => {
 if (!ticker || !ticker.trim()) {
 setData(null);
 return;
 }
 setLoading(true);
 setError(null);
 try {
 const res = await fetch(
 `/api/stocks/${encodeURIComponent(ticker.toUpperCase())}/depth?levels=5`,
 { cache: 'no-store' }
 );
 if (!res.ok) {
 throw new Error(`HTTP ${res.status}`);
 }
 const json = (await res.json()) as DepthResponse;
 if (json.success) {
 setData(json);
 } else {
 setData(null);
 setError(json.error || json.note || 'فشل تحميل البيانات');
 }
 } catch (e) {
 setData(null);
 setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
 } finally {
 setLoading(false);
 }
 }, [ticker]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 // --- Interpretation styling ---
 const interpConfig = useMemo(() => {
 switch (data?.interpretation) {
 case 'buy_pressure':
 return {
 label: 'ضغط شرائي',
 icon: <TrendingUp className="w-3 h-3" />,
 color: 'text-profit bg-profit/15 border-profit/20 ',
 };
 case 'sell_pressure':
 return {
 label: 'ضغط بيعي',
 icon: <TrendingDown className="w-3 h-3" />,
 color: 'text-loss bg-loss/15 border-loss/20 ',
 };
 default:
 return {
 label: 'متوازن',
 icon: <Scale className="w-3 h-3" />,
 color: 'text-slate-700 bg-slate-500/15 border-slate-500/40 dark:text-slate-300',
 };
 }
 }, [data?.interpretation]);

 // --- Max volume across both sides — used for bar widths ---
 const maxVolume = useMemo(() => {
 if (!data) return 0;
 const all = [...data.bids, ...data.asks].map((l) => l.volume);
 return all.length > 0 ? Math.max(...all) : 0;
 }, [data]);

 // Asks displayed top-down: highest price first → reverse the API ascending array
 const displayAsks = useMemo(() => {
 if (!data) return [];
 return [...data.asks].reverse(); // highest price first (farthest from current)
 }, [data]);
 // Bids already descending by price (closest first)
 const displayBids = useMemo(() => data?.bids ?? [], [data]);

 const isEmpty =
 !loading && !error && data && data.bids.length === 0 && data.asks.length === 0;

 return (
 <Card dir="rtl" className={cn('gap-0 overflow-hidden', compact && 'py-3')}>
 {/* ===== Header ===== */}
 <CardHeader className={cn('pb-2', compact && 'px-3 pt-0')}>
 <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
 <Activity className="w-4 h-4 text-cyan-500" />
 <span>دفتر الأوامر والسيولة</span>
 <span className="text-xs text-muted-foreground font-normal">
 ({ticker.toUpperCase()})
 </span>
 <div className="flex items-center gap-1 mr-auto">
 {data?.current_price ? (
 <Badge variant="outline" className="text-xs font-mono tabular-nums">
 {fmtPrice(data.current_price)} EGP
 </Badge>
 ) : null}
 {data && data.spread > 0 ? (
 <Badge variant="outline" className="text-xs font-mono">
 سبريد {(data.spread ?? 0).toFixed(2)}
 </Badge>
 ) : null}
 {data && (
 <Badge className={cn('text-xs border', interpConfig.color)}>
 {interpConfig.icon}
 {interpConfig.label}
 </Badge>
 )}
 <Button
 size="sm"
 variant="ghost"
 onClick={fetchData}
 disabled={loading}
 className="h-7 w-7 p-0"
 title="تحديث"
 >
 {loading ? (
 <Loader2 className="w-3 h-3 animate-spin" />
 ) : (
 <RefreshCw className="w-3 h-3" />
 )}
 </Button>
 </div>
 </CardTitle>
 </CardHeader>

 <CardContent className={cn(compact && 'px-3 pb-0')}>
 {/* ===== Loading ===== */}
 {loading && !data && (
 <div className="space-y-2 py-3">
 <Skeleton className="h-6 w-full" />
 <Skeleton className="h-32 w-full" />
 <Skeleton className="h-12 w-full" />
 </div>
 )}

 {/* ===== Error ===== */}
 {error && !loading && (
 <div className="flex flex-col items-center gap-2 py-6 text-center">
 <AlertTriangle className="w-6 h-6 text-loss" />
 <p className="text-xs text-muted-foreground">{error}</p>
 <Button size="sm" variant="outline" onClick={fetchData} className="h-7">
 <RefreshCw className="w-3 h-3 ml-1" /> إعادة المحاولة
 </Button>
 </div>
 )}

 {/* ===== Empty state ===== */}
 {isEmpty && (
 <div className="flex flex-col items-center gap-2 py-6 text-center">
 <Layers className="w-6 h-6 text-muted-foreground/60" />
 <p className="text-xs text-muted-foreground">
 {data?.note || 'لا توجد بيانات عمق لهذا السهم'}
 </p>
 </div>
 )}

 {/* ===== DOM Visualization ===== */}
 {data && !isEmpty && !error && (
 <div className="space-y-3">
 {/* Two-column depth grid */}
 <div className="grid grid-cols-2 gap-2">
 {/* ---- Asks (sell side, red) ---- */}
 <div className="space-y-1">
 <div className="flex items-center justify-between text-xs font-semibold text-loss pb-1 border-b border-loss/20">
 <span>طلبات البيع</span>
 <span className="text-muted-foreground">حجم</span>
 </div>
 {displayAsks.length === 0 ? (
 <div className="text-xs text-muted-foreground py-3 text-center">
 لا توجد عروض بيع
 </div>
 ) : (
 displayAsks.map((lvl, i) => {
 const wPct = maxVolume > 0 ? (lvl.volume / maxVolume) * 100 : 0;
 return (
 <div
 key={`ask-${i}`}
 className="relative h-7 rounded overflow-hidden bg-loss/5 border border-loss/10"
 >
 {/* Bar — fills from the inside edge (left in RTL = outer) */}
 <div
 className="absolute inset-y-0 right-0 bg-loss/10 /25 transition-all"
 style={{ width: `${wPct}%` }}
 />
 <div className="relative h-full flex items-center justify-between px-2 text-xs">
 <span className="font-mono font-semibold text-loss tabular-nums">
 {fmtPrice(lvl.price)}
 </span>
 <span className="flex items-center gap-1.5">
 <span className="text-xs text-muted-foreground tabular-nums">
 {lvl.orders} تك
 </span>
 <span className="font-mono font-semibold text-loss tabular-nums">
 {fmtVol(lvl.volume)}
 </span>
 </span>
 </div>
 </div>
 );
 })
 )}
 </div>

 {/* ---- Bids (buy side, green) ---- */}
 <div className="space-y-1">
 <div className="flex items-center justify-between text-xs font-semibold text-profit pb-1 border-b border-profit/20">
 <span>طلبات الشراء</span>
 <span className="text-muted-foreground">حجم</span>
 </div>
 {displayBids.length === 0 ? (
 <div className="text-xs text-muted-foreground py-3 text-center">
 لا توجد عروض شراء
 </div>
 ) : (
 displayBids.map((lvl, i) => {
 const wPct = maxVolume > 0 ? (lvl.volume / maxVolume) * 100 : 0;
 return (
 <div
 key={`bid-${i}`}
 className="relative h-7 rounded overflow-hidden bg-profit/5 border border-profit/10"
 >
 <div
 className="absolute inset-y-0 left-0 bg-profit/10 /25 transition-all"
 style={{ width: `${wPct}%` }}
 />
 <div className="relative h-full flex items-center justify-between px-2 text-xs">
 <span className="font-mono font-semibold text-profit tabular-nums">
 {fmtPrice(lvl.price)}
 </span>
 <span className="flex items-center gap-1.5">
 <span className="text-xs text-muted-foreground tabular-nums">
 {lvl.orders} تك
 </span>
 <span className="font-mono font-semibold text-profit tabular-nums">
 {fmtVol(lvl.volume)}
 </span>
 </span>
 </div>
 </div>
 );
 })
 )}
 </div>
 </div>

 {/* ---- Current price center band ---- */}
 <div className="relative -mx-2 px-2">
 <div className="h-9 rounded-md bg-cyan-500/10 border-y-2 border-cyan-500/40 flex items-center justify-between px-3">
 <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">
 السعر الحالي
 </span>
 <span className="font-mono text-base font-bold text-cyan-800 dark:text-cyan-200 tabular-nums">
 {fmtPrice(data.current_price)}
 </span>
 <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">
 EGP
 </span>
 </div>
 </div>

 {/* ===== Liquidity imbalance bar ===== */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
 <span className="flex items-center gap-1 text-profit ">
 <TrendingUp className="w-3 h-3" />
 سيولة شراء {fmtVol(data.total_bid_volume)}
 </span>
 <span className="flex items-center gap-1 text-loss ">
 سيولة بيع {fmtVol(data.total_ask_volume)}
 <TrendingDown className="w-3 h-3" />
 </span>
 </div>
 <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted flex">
 {/* Bid share on the right (RTL = buy side on right) */}
 <div
 className="bg-profit transition-all"
 style={{
 width: `${(data.total_bid_volume / Math.max(data.total_bid_volume + data.total_ask_volume, 1)) * 100}%`,
 }}
 />
 <div
 className="bg-loss transition-all"
 style={{
 width: `${(data.total_ask_volume / Math.max(data.total_bid_volume + data.total_ask_volume, 1)) * 100}%`,
 }}
 />
 </div>
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">عدم التوازن</span>
 <span
 className={cn(
 'font-mono font-bold tabular-nums',
 data.imbalance > 0.1
 ? 'text-profit '
 : data.imbalance < -0.1
 ? 'text-loss '
 : 'text-muted-foreground'
 )}
 >
 {data.imbalance > 0 ? '+' : ''}
 {fmtPct(data.imbalance)}
 </span>
 </div>
 </div>

 {/* ===== Summary stats grid ===== */}
 <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-border/50">
 <div className="text-center p-1.5 rounded bg-profit/5 border border-profit/15">
 <div className="text-xs text-muted-foreground">إجمالي الشراء</div>
 <div className="text-xs font-bold tabular-nums text-profit ">
 {fmtVol(data.total_bid_volume)}
 </div>
 </div>
 <div className="text-center p-1.5 rounded bg-muted/30">
 <div className="text-xs text-muted-foreground">السبريد</div>
 <div className="text-xs font-bold tabular-nums">
 {data.spread > 0 ? (data.spread ?? 0).toFixed(2) : '—'}
 </div>
 </div>
 <div className="text-center p-1.5 rounded bg-loss/5 border border-loss/15">
 <div className="text-xs text-muted-foreground">إجمالي البيع</div>
 <div className="text-xs font-bold tabular-nums text-loss ">
 {fmtVol(data.total_ask_volume)}
 </div>
 </div>
 </div>

 {/* Source attribution */}
 <div className="text-xs text-muted-foreground/70 text-center pt-1">
 مصدر البيانات: stock_intraday (مُجمّع من تداولات اللحظي)
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

export default MarketDepthLiquidityWidget;
