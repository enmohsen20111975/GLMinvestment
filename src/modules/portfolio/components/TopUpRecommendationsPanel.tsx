'use client';

/* ============================================================
 MONEY-TIER2-REBUILD: TopUpRecommendationsPanel
 ============================================================
 بعرض الأسهم الرابحة ≥ 10% مع توقّع "زيادة المركز".

 المصدر: /api/portfolio/holdings (نفس المصدر اللي بيستخدمه
 EnhancedPortfolioView) — بناخد holdings اللي pnl_percent >= 10
 ونعرضها كـ cards مع زر "تفاصيل" لو المستخدم عايز يفتح
 PositionDeepDiveDrawer أو RoboAdvisor.

 الـ Panel متصمم ليكون قابل للدمج كأي panel تاني في الـ portfolio view.
 ============================================================ */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
 TrendingUp,
 Plus,
 Sparkles,
 Loader2,
 RefreshCw,
 ArrowUpRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { UnifiedEmptyState } from '@/components/shared/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Holding {
 ticker: string;
 name: string;
 asset_type: string;
 buy_price: number;
 current_price: number;
 quantity: number;
 invested_amount: number;
 current_value: number;
 pnl_amount: number;
 pnl_percent: number;
 holding_days: number;
 market?: string;
}

interface HoldingsResponse {
 success: boolean;
 holdings?: Holding[];
 summary?: {
 total_invested: number;
 total_current_value: number;
 total_pnl: number;
 total_pnl_pct: number;
 winners: number;
 losers: number;
 };
 error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AR_NUM = new Intl.NumberFormat('ar-EG');
const AR_EGP = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 });

function formatEgp(n: number): string {
 return AR_EGP.format(Math.round(n)) + ' ج.م';
}

function formatPct(n: number): string {
 const sign = n >= 0 ? '+' : '';
 return sign + (n ?? 0).toFixed(1) + '%';
}

function formatHoldingDays(days: number): string {
 if (days <= 0) return 'اليوم';
 if (days < 30) return `${days} يوم`;
 if (days < 365) {
 const months = Math.floor(days / 30);
 return `${months} شهر`;
 }
 const years = Math.floor(days / 365);
 const months = Math.floor((days % 365) / 30);
 return months > 0 ? `${years} سنة و${months} شهر` : `${years} سنة`;
}

/**
 * يصنّف التوقّع حسب شدة الربح:
 * ≥ 30% → "نجم صاعد" (strong buy)
 * ≥ 15% → "فرصة زيادة" (buy)
 * ≥ 10% → "متابعة" (watch)
 */
function classifyRecommendation(pnlPct: number): {
 label: string;
 badgeColor: string;
 icon: 'sparkles' | 'trending' | 'watch';
} {
 if (pnlPct >= 30) {
 return {
 label: 'نجم صاعد',
 badgeColor:
 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 border-profit',
 icon: 'sparkles',
 };
 }
 if (pnlPct >= 15) {
 return {
 label: 'فرصة زيادة',
 badgeColor:
 'bg-whale text-whale/40 border-whale',
 icon: 'trending',
 };
 }
 return {
 label: 'متابعة',
 badgeColor:
 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 border-warning',
 icon: 'watch',
 };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TopUpRecommendationsPanel() {
 const [loading, setLoading] = useState(false);
 const [holdings, setHoldings] = useState<Holding[]>([]);
 const [summary, setSummary] = useState<HoldingsResponse['summary'] | null>(null);
 const [lastFetch, setLastFetch] = useState<string | null>(null);
 const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

 const loadHoldings = useCallback(async () => {
 setLoading(true);
 try {
 const res = await fetch('/api/portfolio/holdings', { cache: 'no-store' });
 const data: HoldingsResponse = await res.json();
 if (data.success && Array.isArray(data.holdings)) {
 setHoldings(data.holdings);
 setSummary(data.summary || null);
 setLastFetch(new Date().toLocaleTimeString('ar-EG'));
 } else {
 toast.error(data.error || 'فشل تحميل المحفظة');
 setHoldings([]);
 }
 } catch {
 toast.error('فشل الاتصال بالخادم');
 setHoldings([]);
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 loadHoldings();
 }, [loadHoldings]);

 // فلترة الأسهم الرابحة >= 10% فقط
 const topUps = holdings
 .filter((h) => h.asset_type === 'stock' && h.pnl_percent >= 10)
 .sort((a, b) => b.pnl_percent - a.pnl_percent);

 // إحصائيات الـ panel
 const totalProfit = topUps.reduce((sum, h) => sum + h.pnl_amount, 0);
 const bestPerformer = topUps[0] || null;
 const avgPct =
 topUps.length > 0
 ? topUps.reduce((s, h) => s + h.pnl_percent, 0) / topUps.length
 : 0;

 return (
 <div className="space-y-4" dir="rtl">
 <Card className="border-border">
 <CardContent className="p-4 space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-2">
 <Sparkles className="h-5 w-5 text-profit" />
 <div>
 <h3 className="font-bold text-base">توقعات زيادة المركز</h3>
 <p className="text-xs text-muted-foreground">
 الأسهم الرابحة ≥ 10% — فرص لتعزيز المكاسب
 </p>
 </div>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={loadHoldings}
 disabled={loading}
 className="h-8 gap-1.5 text-xs"
 >
 {loading ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 <RefreshCw className="h-3.5 w-3.5" />
 )}
 تحديث
 </Button>
 </div>

 {/* Summary Cards */}
 {topUps.length > 0 && (
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
 <div className="p-2 rounded-md bg-profit/20 border border-profit ">
 <div className="text-xs text-muted-foreground">عدد الفرص</div>
 <div className="font-bold text-profit ">
 {AR_NUM.format(topUps.length)}
 </div>
 </div>
 <div className="p-2 rounded-md bg-profit/20 border border-profit ">
 <div className="text-xs text-muted-foreground">إجمالي الربح</div>
 <div className="font-bold text-profit ">
 {formatEgp(totalProfit)}
 </div>
 </div>
 <div className="p-2 rounded-md bg-profit/20 border border-profit ">
 <div className="text-xs text-muted-foreground">متوسط الربح %</div>
 <div className="font-bold text-profit ">
 {formatPct(avgPct)}
 </div>
 </div>
 <div className="p-2 rounded-md bg-profit/20 border border-profit ">
 <div className="text-xs text-muted-foreground">الأفضل أداءً</div>
 <div className="font-bold text-profit truncate">
 {bestPerformer ? bestPerformer.ticker : '—'}
 </div>
 </div>
 </div>
 )}

 {/* Empty state — P0-COMPONENT-UNIFICATION Phase 2.2: UnifiedEmptyState */}
 {!loading && topUps.length === 0 && (
 <UnifiedEmptyState
 variant="empty"
 icon={<Sparkles className="h-8 w-8 opacity-40" />}
 title="مفيش أسهم رابحة ≥ 10% حالياً"
 description="عندما يحقق السهم ربحاً بنسبة 10%+، يظهر هنا كفرصة لزيادة المركز."
 />
 )}

 {/* Loading skeleton */}
 {loading && topUps.length === 0 && (
 <div className="space-y-2">
 {[1, 2, 3].map((i) => (
 <div
 key={i}
 className="h-20 rounded-md bg-muted/40 shimmer"
 style={{ animationDelay: `${i * 100}ms` }}
 />
 ))}
 </div>
 )}

 {/* Holdings list */}
 {topUps.length > 0 && (
 <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
 {topUps.map((h) => {
 const rec = classifyRecommendation(h.pnl_percent);
 const isExpanded = expandedTicker === h.ticker;
 const suggestedTopUpQty = Math.max(
 1,
 Math.floor((h.invested_amount * 0.1) / h.current_price)
 );
 return (
 <div
 key={h.ticker}
 className={cn(
 'rounded-md border bg-card p-3 transition-all',
 isExpanded
 ? 'border-profit shadow-sm'
 : 'border-border hover:border-profit dark:hover:border-profit'
 )}
 >
 {/* Row header */}
 <button
 type="button"
 onClick={() =>
 setExpandedTicker(isExpanded ? null : h.ticker)
 }
 className="w-full flex items-center justify-between gap-2 text-right"
 >
 <div className="flex items-center gap-2 min-w-0">
 <div className="flex items-center justify-center w-9 h-9 rounded-full bg-profit/10 text-profit shrink-0">
 <TrendingUp className="h-4 w-4" />
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-1.5">
 <span className="font-bold text-sm">{h.ticker}</span>
 <Badge
 variant="outline"
 className={cn(
 'text-xs py-0 px-1.5 h-4 border',
 rec.badgeColor
 )}
 >
 {rec.label}
 </Badge>
 </div>
 <div className="text-xs text-muted-foreground truncate">
 {h.name || h.ticker}
 </div>
 </div>
 </div>
 <div className="text-left shrink-0">
 <div className="font-bold text-profit text-sm">
 {formatPct(h.pnl_percent)}
 </div>
 <div className="text-xs text-muted-foreground">
 {formatEgp(h.pnl_amount)}
 </div>
 </div>
 </button>

 {/* Expanded details */}
 {isExpanded && (
 <div className="mt-3 pt-3 border-t border-border space-y-2 animate-in fade-in duration-200">
 <div className="grid grid-cols-3 gap-2 text-xs">
 <div className="p-2 rounded bg-muted/40">
 <div className="text-muted-foreground">سعر الشراء</div>
 <div className="font-bold">
 {AR_EGP.format(h.buy_price)}
 </div>
 </div>
 <div className="p-2 rounded bg-muted/40">
 <div className="text-muted-foreground">السعر الحالي</div>
 <div className="font-bold">
 {AR_EGP.format(h.current_price)}
 </div>
 </div>
 <div className="p-2 rounded bg-muted/40">
 <div className="text-muted-foreground">الكمية</div>
 <div className="font-bold">{AR_NUM.format(h.quantity)}</div>
 </div>
 </div>

 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>
 مدة التداول:{' '}
 <span className="font-medium text-foreground">
 {formatHoldingDays(h.holding_days)}
 </span>
 </span>
 <span>
 قيمة المركز:{' '}
 <span className="font-medium text-foreground">
 {formatEgp(h.current_value)}
 </span>
 </span>
 </div>

 {/* Top-up suggestion */}
 <div className="flex items-start gap-2 p-2 rounded bg-profit/20 border border-profit ">
 <Plus className="h-3.5 w-3.5 text-profit shrink-0 mt-0.5" />
 <div className="text-xs">
 <div className="font-medium text-profit ">
 توقّع: زيادة المركز بـ {AR_NUM.format(suggestedTopUpQty)} سهم
 </div>
 <div className="text-muted-foreground mt-0.5">
 تكلفة تقديرية:{' '}
 {formatEgp(suggestedTopUpQty * h.current_price)} (10% من
 الاستثمار الأصلي)
 </div>
 </div>
 </div>

 {/* CTA */}
 <div className="flex gap-2">
 <Button
 size="sm"
 className="h-8 gap-1.5 text-xs flex-1 bg-profit hover:bg-profit text-white"
 onClick={() => {
 toast.success(
 `تم تسجيل اهتمامك بزيادة مركز ${h.ticker}. تواصل مع الوسيط للتنفيذ.`
 );
 }}
 >
 <ArrowUpRight className="h-3.5 w-3.5" />
 زيادة المركز
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="h-8 text-xs"
 onClick={() =>
 toast.info(
 `افتح صفحة ${h.ticker} لمراجعة التحليل الفني قبل القرار.`
 )
 }
 >
 تحليل أعمق
 </Button>
 </div>
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}

 {/* Footer */}
 {lastFetch && (
 <div className="text-xs text-muted-foreground text-center">
 آخر تحديث: {lastFetch}
 </div>
 )}

 {/* Disclaimer */}
 <div className="text-xs text-muted-foreground text-center leading-relaxed">
 التوقعات لأغراض إعلامية فقط ولا تُعدّ نصحاً استثمارياً. راجع مستشارك المالي قبل أي قرار.
 </div>
 </CardContent>
 </Card>
 </div>
 );
}
