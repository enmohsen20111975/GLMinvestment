'use client';

import React, { useState, useEffect, useCallback, memo } from 'react';
import {
 ShieldAlert,
 ShieldCheck,
 TrendingUp,
 AlertTriangle,
 ChevronDown,
 ChevronUp,
 Activity,
 Percent,
 Sliders,
 RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';

export interface MarketRegimeData {
 success: boolean;
 market: string;
 regime: 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE';
 raw_regime?: string;
 confidence?: number;
 reasons?: string[];
 indicators?: {
 index_current?: number;
 index_daily_change_pct?: number;
 breadth_pct?: number;
 breadth_advances?: number;
 breadth_declines?: number;
 breadth_total?: number;
 atr_ratio?: number;
 turnover_ratio?: number;
 loss_streak_days?: number;
 short_term_drawdown_pct?: number;
 index_ticker_used?: string;
 latest_date?: string;
 };
 thresholds?: {
 min_rr?: number;
 min_score?: number;
 position_size_multiplier?: number;
 max_picks_per_day?: number;
 atr_stop_multiplier?: number;
 falling_knife_threshold?: number;
 max_open_positions?: number;
 };
 last_update?: string;
}

interface MarketRegimeBannerProps {
 market?: string;
 className?: string;
 compact?: boolean;
}

export const MarketRegimeBanner = memo(function MarketRegimeBanner({
 market = 'EGX',
 className = '',
 compact = false,
}: MarketRegimeBannerProps) {
 const [data, setData] = useState<MarketRegimeData | null>(null);
 const [loading, setLoading] = useState<boolean>(true);
 const [isExpanded, setIsExpanded] = useState<boolean>(false);

 const fetchRegime = useCallback(async () => {
 try {
 const res = await fetch(`/api/market/regime?market=${encodeURIComponent(market)}`, {
 cache: 'no-store',
 });
 if (!res.ok) return;
 const json: MarketRegimeData = await res.json();
 if (json && json.success) {
 setData(json);
 }
 } catch {
 // Keep existing data gracefully
 } finally {
 setLoading(false);
 }
 }, [market]);

 useEffect(() => {
 fetchRegime();
 }, [fetchRegime]);

 // Auto-poll every 60s when the market is open and tab is visible
 useVisibilityAwarePolling(
 () => fetchRegime(),
 60_000,
 [fetchRegime],
 { market, allowOffMarket: false }
 );

 if (loading && !data) {
 return null;
 }

 if (!data || !data.regime) {
 return null;
 }

 const isDefensive = data.regime === 'DEFENSIVE';
 const isAggressive = data.regime === 'AGGRESSIVE';
 const ind = data.indicators || {};
 const thresh = data.thresholds || {};

 if (compact) {
 return (
 <div
 className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
 isDefensive
 ? 'bg-loss/10 border-loss/20 text-loss '
 : isAggressive
 ? 'bg-primary/10 border-purple-500/30 text-primary '
 : 'bg-profit/10 border-profit/20 text-profit '
 } ${className}`}
 dir="rtl"
 >
 {isDefensive ? (
 <ShieldAlert className="h-3.5 w-3.5 text-loss animate-pulse" />
 ) : isAggressive ? (
 <TrendingUp className="h-3.5 w-3.5 text-primary " />
 ) : (
 <ShieldCheck className="h-3.5 w-3.5 text-profit " />
 )}
 <span>
 حالة السوق:{' '}
 {isDefensive ? 'وضع دفاعي ⚠️' : isAggressive ? 'زخم صاعد 🚀' : 'توازن طبيعي 🟢'}
 </span>
 </div>
 );
 }

 return (
 <div
 className={`rounded-xl border p-3.5 md:p-4 transition-all duration-300 shadow-sm ${
 isDefensive
 ? 'border-loss/20 text-foreground ring-1 ring-loss/20'
 : isAggressive
 ? 'from-purple-950/20 via-indigo-900/10 to-background border-purple-500/40 text-foreground ring-1 ring-purple-500/20'
 : 'to-background border-profit/20 text-foreground'
 } ${className}`}
 dir="rtl"
 >
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
 {/* Title + Main Alert */}
 <div className="flex items-start gap-3">
 <div
 className={`p-2 rounded-lg mt-0.5 flex-shrink-0 ${
 isDefensive
 ? 'bg-loss/20 text-loss ring-1 ring-loss/30 animate-pulse'
 : isAggressive
 ? 'bg-primary/20 text-primary ring-1 ring-purple-500/30'
 : 'bg-profit/20 text-profit ring-1 ring-profit/30'
 }`}
 >
 {isDefensive ? (
 <ShieldAlert className="h-5 w-5" />
 ) : isAggressive ? (
 <TrendingUp className="h-5 w-5" />
 ) : (
 <ShieldCheck className="h-5 w-5" />
 )}
 </div>

 <div className="space-y-1">
 <div className="flex flex-wrap items-center gap-2">
 <h3 className="font-bold text-sm md:text-base leading-tight">
 {isDefensive
 ? 'حالة السوق العام: وضع دفاعي وقائي (Risk-Off)'
 : isAggressive
 ? 'حالة السوق العام: زخم صاعد قوي (Risk-On / Aggressive)'
 : 'حالة السوق العام: توازن واستقرار طبيعي (Normal Regime)'}
 </h3>
 <Badge
 variant="outline"
 className={`text-xs font-bold ${
 isDefensive
 ? 'bg-loss/20 text-loss border-loss/20'
 : isAggressive
 ? 'bg-primary/20 text-primary border-purple-500/40'
 : 'bg-profit/20 text-profit border-profit/20'
 }`}
 >
 {data.regime}
 </Badge>
 {ind.short_term_drawdown_pct != null && ind.short_term_drawdown_pct > 0.02 && (
 <span className="text-xs text-loss font-mono">
 (تراجع المؤشر {(ind.short_term_drawdown_pct * 100).toFixed(1)}%−)
 </span>
 )}
 </div>

 <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
 {isDefensive ? (
 <span>
 ⚠️ <strong>تنبيه هبوط السوق:</strong> المؤشر العام وضغط السيولة يشيران إلى تراجع جماعي.
 يقوم النظام تلقائياً بتفعيل <strong>قواعد الحماية</strong>: خفض حجم الشراء بنسبة <strong>50%</strong>،
 الاحتفاظ بكاش، تشديد وقف الخسارة، وحظر التقاط السكاكين الساقطة.
 </span>
 ) : isAggressive ? (
 <span>
 🚀 اتساع وسيولة إيجابية تفوق المتوسط. ينصح باقتناص اختراقات الأسهم المتجمعة وركوب موجات الصعود بأهداف موسعة.
 </span>
 ) : (
 <span>
 السوق يتحرك في نطاق متوازن. التداول بأحجام طبيعية مع الالتزام بمستويات الدعوم والمقاومات الفردية.
 </span>
 )}
 </p>
 </div>
 </div>

 {/* Action Controls & Metric Badges */}
 <div className="flex items-center gap-2 self-end md:self-center flex-shrink-0">
 <Button
 variant="ghost"
 size="sm"
 className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
 onClick={() => setIsExpanded((prev) => !prev)}
 >
 <Activity className="h-3.5 w-3.5" />
 <span>{isExpanded ? 'إخفاء المؤشرات' : 'مؤشرات السوق'}</span>
 {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
 </Button>

 <Button
 variant="outline"
 size="sm"
 className="h-8 w-8 p-0"
 onClick={() => fetchRegime()}
 title="تحديث حالة السوق"
 >
 <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
 </Button>
 </div>
 </div>

 {/* Defensive Key Guidelines Pills */}
 {isDefensive && (
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-loss/20">
 <div className="flex items-center gap-1.5 text-xs bg-loss/10 /40 rounded-lg p-2 border border-loss/20">
 <Percent className="h-3.5 w-3.5 text-loss " />
 <span className="font-semibold text-loss ">
 حجم الصفقات: {((thresh.position_size_multiplier ?? 0.5) * 100).toFixed(0)}% (نصف الحجم)
 </span>
 </div>

 <div className="flex items-center gap-1.5 text-xs bg-loss/10 /40 rounded-lg p-2 border border-loss/20">
 <Sliders className="h-3.5 w-3.5 text-loss " />
 <span className="font-semibold text-loss ">
 أقصى فرص/يوم: {thresh.max_picks_per_day ?? 2} أسهم فقط
 </span>
 </div>

 <div className="flex items-center gap-1.5 text-xs bg-loss/10 /40 rounded-lg p-2 border border-loss/20">
 <AlertTriangle className="h-3.5 w-3.5 text-loss " />
 <span className="font-semibold text-loss ">
 وقف مشدد: {thresh.atr_stop_multiplier ?? 1.5}× ATR
 </span>
 </div>

 <div className="flex items-center gap-1.5 text-xs bg-loss/10 /40 rounded-lg p-2 border border-loss/20">
 <ShieldAlert className="h-3.5 w-3.5 text-loss " />
 <span className="font-semibold text-loss ">
 أدنى تقييم: {thresh.min_score ?? 75}+ نقطة
 </span>
 </div>
 </div>
 )}

 {/* Expanded Macro Indicators Drawer */}
 {isExpanded && (
 <div className="mt-3 pt-3 border-t border-border/60 text-xs space-y-2.5">
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-muted-foreground">
 <div className="p-2 rounded bg-muted/40">
 <span className="block text-xs">اتساع السوق (الأسهم الصاعدة)</span>
 <span className="font-mono font-bold text-foreground">
 {ind.breadth_pct != null ? `${(ind.breadth_pct * 100).toFixed(1)}%` : 'غير متاح'}
 </span>
 </div>

 <div className="p-2 rounded bg-muted/40">
 <span className="block text-xs">نسبة السيولة vs 10 أيام</span>
 <span className="font-mono font-bold text-foreground">
 {ind.turnover_ratio != null ? `${(ind.turnover_ratio * 100).toFixed(0)}%` : 'غير متاح'}
 </span>
 </div>

 <div className="p-2 rounded bg-muted/40">
 <span className="block text-xs">معدل تقلب وتذبذب السوق (ATR)</span>
 <span className="font-mono font-bold text-foreground">
 {ind.atr_ratio != null ? `${ind.atr_ratio.toFixed(2)}×` : 'غير متاح'}
 </span>
 </div>

 <div className="p-2 rounded bg-muted/40">
 <span className="block text-xs">مؤشر القياس</span>
 <span className="font-mono font-bold text-foreground">
 {ind.index_ticker_used || market} ({ind.index_current ? (ind.index_current ?? 0).toFixed(2) : '-'})
 </span>
 </div>
 </div>

 {Array.isArray(data.reasons) && data.reasons.length > 0 && (
 <div className="bg-muted/30 p-2.5 rounded-lg border border-border/40 text-xs space-y-1">
 <div className="font-semibold text-foreground">أسباب تقييم النظام الحالية:</div>
 <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
 {data.reasons.map((r, i) => (
 <li key={i}>{r}</li>
 ))}
 </ul>
 </div>
 )}
 </div>
 )}
 </div>
 );
});
