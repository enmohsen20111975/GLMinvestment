'use client';

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import type { Stock } from '@/types';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { StockDetail } from './StockDetail';
import { ShareButton } from '@/components/share/ShareButton';
import { TreasuryBondsView } from './TreasuryBondsView';
import { cn, safeNum } from '@/lib/utils';
// ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────────────
// قبل كده: overbought/oversold كانوا بـ يتحسبوا client-side بـ RSI thresholds
// 70/30 → نتائج متضاربة مع canonical signal classification.
// الحل: نعرض الـ signal الصريح من الـ DB (ولو NULL → "—").
import { signalAr } from '@/lib/canonical-signal';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { FlashingPriceCell } from '@/components/shared/FlashingPriceCell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import {
 TrendingUp,
 TrendingDown,
 Minus,
 Search,
 ChevronLeft,
 ChevronRight,
 BarChart3,
 Filter,
 Landmark,
 Flame,
 DollarSign,
 AlertTriangle,
 LayoutGrid,
 Shield,
 X,
} from 'lucide-react';
import { StockIconMini } from './StockIcon';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
// P0 PROD CRASH FIX (Task 15): useTranslation hook was used on line 876
// (`const t = useTranslation();`) but the import was MISSING, causing
// `ReferenceError: t is not defined` (minified name of `useTranslation`)
// at runtime → RootErrorBoundary → page dead → users couldn't log in.
import { useTranslation } from '@/lib/i18n-context';
import { StockScreenerAdvanced } from '@/modules/screener/components/StockScreenerAdvanced';

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTORS = [
 'الكل',
 'Financials',
 'Basic Materials',
 'Real Estate',
 'Consumer Goods',
 'Industrials',
 'Food & Beverage',
 'Technology',
 'Consumer Services',
 'Healthcare',
 'Energy',
 'Telecommunications',
];

const INDEX_FILTERS: Record<string, Array<{ key: string; label: string }>> = {
 EGX: [
 { key: 'all', label: 'الكل' },
 { key: 'egx30', label: 'EGX 30' },
 { key: 'egx70', label: 'EGX 70' },
 { key: 'egx100', label: 'EGX 100' },
 ],
 TADAWUL: [
 { key: 'all', label: 'الكل' },
 { key: 'tasi', label: 'تاسي' },
 ],
 KSE: [
 { key: 'all', label: 'الكل' },
 { key: 'bursa', label: 'المؤشر العام' },
 ],
 QSE: [
 { key: 'all', label: 'الكل' },
 { key: 'qeindex', label: 'المؤشر العام' },
 ],
 US: [
 { key: 'all', label: 'الكل' },
 { key: 'sp500', label: 'S&P 500' },
 { key: 'nasdaq', label: 'NASDAQ' },
 { key: 'dow', label: 'Dow Jones' },
 ],
 CRYPTO: [{ key: 'all', label: 'الكل' }],
 GOLD: [{ key: 'all', label: 'الكل' }],
};
const DEFAULT_INDEX_FILTERS = [{ key: 'all', label: 'الكل' }];

// (Task STOCKS-TABLE-V2) Quick filter chips — صف واحد مدمج من الفلاتر الأكثر استخداماً:
// 3 فلاتر مؤشر (all/egx30/egx70) + 3 فلاتر قائمة مسبقة (top_gainers/top_losers/most_active).
// تحل محل الـ 3 مستويات بحث (StockSelector + search + preset buttons) المسبقة.
type QuickFilterKey = 'all' | 'egx30' | 'egx70' | 'top_gainers' | 'top_losers' | 'most_active';
const QUICK_FILTERS: Array<{ key: QuickFilterKey; label: string }> = [
 { key: 'all', label: 'الكل' },
 { key: 'egx30', label: 'EGX30' },
 { key: 'egx70', label: 'EGX70' },
 { key: 'top_gainers', label: 'الأعلى ارتفاعاً' },
 { key: 'top_losers', label: 'الأكثر انخفاضاً' },
 { key: 'most_active', label: 'الأنشط تداولاً' },
];

// ─── Default sort key (مستخدم في initialSort لـ UnifiedTable + في نص النشر) ───
// (Task STOCKS-TABLE-FIX: لغيّنا الـ Sort Select dropdown — UnifiedTable بقت هي المرجع الوحيد للترتيب)
const DEFAULT_SORT_KEY = 'change_1d';
const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

const PRICE_RANGE_OPTIONS = [
 { key: 'all', label: 'كل الأسعار' },
 { key: 'under-10', label: 'أقل من 10' },
 { key: '10-50', label: '10 - 50' },
 { key: '50-100', label: '50 - 100' },
 { key: 'over-100', label: 'أكثر من 100' },
];

const CHANGE_FILTER_OPTIONS = [
 { key: 'all', label: 'الكل' },
 { key: 'gainers', label: 'المرتفعة فقط' },
 { key: 'losers', label: 'المنخفضة فقط' },
 { key: 'unchanged', label: 'الثابتة فقط' },
];

type StockTab = 'stocks' | 'bonds';

const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the clean EGX ticker symbol from a TradingView-merged string.
 * TradingView's scraper concatenates the ticker + company name + trailing "D",
 * e.g. "LUTSLotus For Agricultural...D" → "LUTS", "CPMECatalyst...D" → "CPME".
 *
 * The greedy /^[A-Z]{2,6}/ match grabs "LUTSL" because "Lotus" starts with a
 * capital L. We detect this CamelCase word boundary: if the character right
 * AFTER the matched run is a lowercase letter, the last matched capital is
 * actually the start of the company name → drop it. Repeat until stable.
 */
function formatCleanTicker(rawTicker: string): string {
 if (!rawTicker) return '';
 if (rawTicker.length > 6) {
 const match = rawTicker.match(/^[A-Z]{2,6}/);
 if (match) {
 let clean = match[0];
 // Trim trailing capital that begins a CamelCase word (e.g. "LUTS" + "Lotus")
 while (clean.length > 2 && clean.length < rawTicker.length) {
 const nextChar = rawTicker[clean.length];
 if (nextChar && nextChar === nextChar.toLowerCase() && nextChar !== nextChar.toUpperCase()) {
 // next char is lowercase → last char of `clean` starts a word → drop it
 clean = clean.slice(0, -1);
 } else {
 break;
 }
 }
 return clean;
 }
 }
 return rawTicker;
}

function parseVolStr(vol: unknown): number {
 if (vol == null) return 0;
 if (typeof vol === 'number') return Number.isFinite(vol) ? vol : 0;
 const s = String(vol).trim().replace(/\u202f/g, '').replace(/\s/g, '').toUpperCase();
 if (!s) return 0;
 const mult: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
 const last = s[s.length - 1];
 if (mult[last]) {
 const num = parseFloat(s.slice(0, -1));
 return Number.isFinite(num) ? num * mult[last] : 0;
 }
 const n = Number(s);
 return Number.isFinite(n) ? n : 0;
}

function formatVolume(vol: unknown): string {
 const v = parseVolStr(vol);
 if (v <= 0) return '—';
 if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
 if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
 return v.toString();
}

function formatTurnover(val: number | undefined | null): string {
 if (!val) return '—';
 if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M ج.م';
 if (val >= 1_000) return (val / 1_000).toFixed(0) + 'K ج.م';
 return (val ?? 0).toFixed(0) + ' ج.م';
}

function formatPercent(val: number | null | undefined, decimals = 2): string {
 if (val == null || !Number.isFinite(val)) return '—';
 return `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}%`;
}

function changeColorClass(val: number | null | undefined): string {
 if (val == null || !Number.isFinite(val)) return 'text-muted-foreground';
 if (val > 0) return 'text-profit ';
 if (val < 0) return 'text-loss ';
 return 'text-muted-foreground';
}

const PRESET_OPTIONS = [
 { key: 'all', label: 'كل الأسهم', icon: '📋' },
 { key: 'most_active', label: 'الأكثر نشاطا', icon: null },
 { key: 'top_gainers', label: 'الأكثر ربحا', icon: null },
 { key: 'top_losers', label: 'الأكثر خسارة', icon: '📉' },
 { key: 'undervalued', label: 'الأقل من القيمة العادلة', icon: null },
 { key: 'overvalued', label: 'الأعلى من القيمة العادلة', icon: '⚠️' },
];

// ─── Preset Buttons (top row) ─────────────────────────────────────────────────
// Same presets as PRESET_OPTIONS but rendered as full-width buttons with lucide icons
const PRESET_BUTTONS: Array<{
 key: string;
 label: string;
 icon: React.ComponentType<{ className?: string }>;
 hint: string;
}> = [
 { key: 'most_active', label: 'الأكثر نشاطا', icon: Flame, hint: 'حسب القيمة السوقية المتداولة' },
 { key: 'undervalued', label: 'أقل من القيمة العادلة', icon: DollarSign, hint: 'فرصة صعود > 5%' },
 { key: 'overvalued', label: 'أعلى من القيمة العادلة', icon: AlertTriangle, hint: 'فرصة هبوط > 5%' },
 { key: 'top_gainers', label: 'الأكثر ربحا', icon: TrendingUp, hint: 'أعلى تغير إيجابي' },
 { key: 'top_losers', label: 'الأكثر خسارة', icon: TrendingDown, hint: 'أعلى تغير سلبي' },
 { key: 'top_dividends', label: 'الأكثر توزيعات', icon: DollarSign, hint: 'أعلى عائد توزيعات نقدية' },
 { key: 'lowest_risk', label: 'الأقل مخاطرة', icon: Shield, hint: 'أقل تذبذب + أفضل ملاءة' },
];

// Sector → tailwind badge colors (deterministic by sector name hash)
const SECTOR_COLOR_MAP: Record<string, string> = {
 'Financials': 'bg-profit text-profit /30 ',
 'القطاع المالي': 'bg-profit text-profit /30 ',
 'Basic Materials': 'bg-warning text-warning /30 ',
 'الأساسية': 'bg-warning text-warning /30 ',
 'Real Estate': 'bg-primary text-primary /30 ',
 'العقارات': 'bg-primary text-primary /30 ',
 'Consumer Goods': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
 'الاستهلاكية': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
 'Industrials': 'bg-whale text-whale /30 ',
 'الصناعات التحويلية': 'bg-whale text-whale /30 ',
 'Food & Beverage': 'bg-warning text-warning /30 ',
 'الأغذية والمشروبات': 'bg-warning text-warning /30 ',
 'Technology': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
 'التكنولوجيا': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
 'Consumer Services': 'bg-loss text-loss /30 ',
 'الخدمات الاستهلاكية': 'bg-loss text-loss /30 ',
 'Healthcare': 'bg-loss text-loss /30 ',
 'الرعاية الصحية': 'bg-loss text-loss /30 ',
 'Energy': 'bg-warning text-warning /30 ',
 'الطاقة': 'bg-warning text-warning /30 ',
 'Telecommunications': 'bg-whale text-whale /30 ',
 'الاتصالات': 'bg-whale text-whale /30 ',
};

const SECTOR_FALLBACK_COLOR = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';

function getSectorColor(sector: string | undefined | null): string {
 if (!sector) return SECTOR_FALLBACK_COLOR;
 // Exact match first
 if (SECTOR_COLOR_MAP[sector]) return SECTOR_COLOR_MAP[sector];
 // Substring match (Arabic sectors often have suffixes like "القطاع المالي - بنوك")
 for (const key of Object.keys(SECTOR_COLOR_MAP)) {
 if (sector.includes(key) || key.includes(sector)) return SECTOR_COLOR_MAP[key];
 }
 return SECTOR_FALLBACK_COLOR;
}

function formatMarketCap(cap: number): string {
 if (cap >= 1_000_000_000) return (cap / 1_000_000_000).toFixed(1) + 'B';
 if (cap >= 1_000_000) return (cap / 1_000_000).toFixed(1) + 'M';
 return cap.toLocaleString();
}

// ─── Skeleton Components ──────────────────────────────────────────────────────

function TableSkeleton() {
 return (
 <div className="hidden md:block">
 {Array.from({ length: 8 }).map((_, i) => (
 <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0 px-4">
 <Skeleton className="h-5 w-14 flex-shrink-0" />
 <Skeleton className="h-5 w-28 flex-1" />
 <Skeleton className="h-5 w-20 flex-shrink-0" />
 <Skeleton className="h-5 w-16 flex-shrink-0" />
 <Skeleton className="h-5 w-16 flex-shrink-0" />
 <Skeleton className="h-5 w-20 flex-shrink-0" />
 <Skeleton className="h-5 w-16 flex-shrink-0" />
 </div>
 ))}
 </div>
 );
}

function CardGridSkeleton() {
 return (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
 {Array.from({ length: 8 }).map((_, i) => (
 <Skeleton key={i} className="h-52 w-full rounded-xl" />
 ))}
 </div>
 );
}

function SummarySkeleton() {
 return (
 <div className="flex items-center gap-4 flex-wrap">
 {Array.from({ length: 5 }).map((_, i) => (
 <Skeleton key={i} className="h-9 w-28 rounded-lg" />
 ))}
 </div>
 );
}

// ─── Overview Summary Bar ─────────────────────────────────────────────────────
// UI-STABILITY fix (2026-09-28): wrap OverviewSummary in React.memo so it
// doesn't re-render when parent state changes that don't affect its props.
const OverviewSummary = memo(function OverviewSummary({
 total,
 gainers,
 losers,
 unchanged,
 avgChange,
}: {
 total: number;
 gainers: number;
 losers: number;
 unchanged: number;
 avgChange: number;
}) {
 return (
 <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
 <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
 <span className="text-xs font-medium text-muted-foreground">الإجمالي</span>
 <span className="text-sm font-bold">{total}</span>
 </div>
 <div className="flex items-center gap-1.5 bg-profit/10 rounded-lg px-3 py-1.5">
 <TrendingUp className="w-3.5 h-3.5 text-profit " />
 <span className="text-xs font-medium text-profit ">المرتفعة</span>
 <span className="text-sm font-bold text-profit ">{gainers}</span>
 </div>
 <div className="flex items-center gap-1.5 bg-loss/10 rounded-lg px-3 py-1.5">
 <TrendingDown className="w-3.5 h-3.5 text-loss " />
 <span className="text-xs font-medium text-loss ">المنخفضة</span>
 <span className="text-sm font-bold text-loss ">{losers}</span>
 </div>
 <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
 <Minus className="w-3.5 h-3.5 text-muted-foreground" />
 <span className="text-xs font-medium text-muted-foreground">الثابتة</span>
 <span className="text-sm font-bold">{unchanged}</span>
 </div>
 <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
 <span className="text-xs font-medium text-muted-foreground">متوسط التغير</span>
 <span
 className={cn(
 'text-sm font-bold tabular-nums',
 avgChange > 0
 ? 'text-profit '
 : avgChange < 0
 ? 'text-loss '
 : 'text-muted-foreground'
 )}
 >
 {avgChange >= 0 ? '+' : ''}
 {safeNum(avgChange).toFixed(2)}%
 </span>
 </div>
 </div>
 );
});

// ─── Stock Card Component ─────────────────────────────────────────────────────
// UI-STABILITY fix (2026-09-28): wrap StockCard in React.memo so background
// price refreshes don't re-render cards whose `stock` prop hasn't changed.
const StockCard = memo(function StockCard({
 stock,
 onClick,
}: {
 stock: Stock;
 onClick: () => void;
}) {
 const change = stock.price_change || 0;
 const isPositive = change > 0;
 const isNegative = change < 0;
 const isNeutral = change === 0;

 // Mini bar: position of current price between high and low of the day
 const high = safeNum(stock.high_price);
 const low = safeNum(stock.low_price);
 const priceRange = high - low;
 const pricePosition = priceRange > 0 ? ((safeNum(stock.current_price) - low) / priceRange) * 100 : 50;

 return (
 <Card
 className="cursor-pointer group hover:shadow-md transition-all duration-200 hover:border-profit dark:hover:border-profit/50 py-0 gap-0"
 onClick={onClick}
 >
 <CardContent className="p-4">
 {/* Header: Icon + Ticker + Name + Indexes */}
 <div className="flex items-start justify-between gap-2 mb-3">
 <div className="flex items-start gap-3 min-w-0 flex-1">
 {/* Stock Icon */}
 <StockIconMini
 ticker={stock.ticker}
 name={stock.name}
 sector={stock.sector}
 className="flex-shrink-0 mt-0.5"
 />
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 mb-1">
 <span className="font-bold text-base text-profit ">
 {formatCleanTicker(stock.ticker)}
 </span>
 <div className="flex gap-1">
 {stock.egx30_member && (
 <span className="text-xs px-1.5 py-0.5 rounded bg-profit text-profit /30 font-medium">
 30
 </span>
 )}
 {stock.egx70_member && (
 <span className="text-xs px-1.5 py-0.5 rounded bg-warning text-warning /30 font-medium">
 70
 </span>
 )}
 {stock.egx100_member && (
 <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 font-medium">
 100
 </span>
 )}
 </div>
 </div>
 <p className="text-xs text-muted-foreground truncate mb-1" dir="rtl">
 {stock.name_ar}
 </p>
 <Badge variant="secondary" className="text-xs font-normal">
 {stock.sector}
 </Badge>
 </div>
 </div>
 <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
 <ShareButton
 iconOnly
 variant="ghost"
 size="icon"
 stockData={{
 ticker: stock.ticker,
 name: stock.name,
 nameAr: stock.name_ar,
 price: stock.current_price,
 change: stock.price_change ?? undefined,
 sector: stock.sector,
 }}
 />
 <StockPublisher
 data={{
 ticker: stock.ticker,
 nameAr: stock.name_ar,
 nameEn: stock.name,
 sector: stock.sector,
 currentPrice: Number(stock.current_price ?? 0),
 changePct: Number(stock.price_change ?? 0),
 peRatio: Number(stock.pe_ratio ?? 0) || undefined,
 pbRatio: Number(stock.pb_ratio ?? 0) || undefined,
 roe: Number(stock.roe ?? 0) || undefined,
 marketCap: Number(stock.market_cap ?? 0) || undefined,
 rsi: Number(stock.rsi ?? 0) || undefined,
 sma20: Number(stock.ma_50 ?? 0) || undefined,
 sma50: Number(stock.ma_50 ?? 0) || undefined,
 sma200: Number(stock.ma_200 ?? 0) || undefined,
 market: (stock.market as StockPublishData['market']) || 'EGX',
 }}
 variant="icon"
 size="sm"
 />
 </div>
 </div>

 {/* Price + Change — BLUEPRINT Phase 5: FlashingPriceCell */}
 <div className="flex items-end justify-between mb-3">
 <div>
 <FlashingPriceCell price={safeNum(stock.current_price) || null} className="text-2xl font-bold tabular-nums tracking-tight" />
 <p className="text-xs text-muted-foreground">{stock.market === 'CRYPTO' ? 'دولار' : 'جنيه مصري'}</p>
 </div>
 <div
 className={cn(
 'flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-bold tabular-nums',
 isPositive && 'bg-profit/10 text-profit ',
 isNegative && 'bg-loss/10 text-loss ',
 isNeutral && 'bg-muted text-muted-foreground'
 )}
 >
 {isPositive ? (
 <TrendingUp className="w-3.5 h-3.5" />
 ) : isNegative ? (
 <TrendingDown className="w-3.5 h-3.5" />
 ) : (
 <Minus className="w-3.5 h-3.5" />
 )}
 {change >= 0 ? '+' : ''}
 {safeNum(change).toFixed(2)}%
 </div>
 </div>

 <div className="mb-3">
 <MiniSparkline ticker={stock.ticker} height={32} width={160} showArea />
 </div>

 {/* Mini Price Bar */}
 <div className="mb-3">
 <div className="h-1.5 bg-muted rounded-full overflow-hidden relative">
 <div
 className={cn(
 'absolute top-0 h-full rounded-full transition-all',
 isPositive
 ? 'bg-gradient-to-l from-profit to-profit'
 : isNegative
 ? 'bg-gradient-to-l from-loss to-loss'
 : 'bg-muted-foreground/30'
 )}
 style={{ width: `${Math.min(100, Math.max(0, pricePosition))}%` }}
 />
 </div>
 <div className="flex justify-between mt-0.5 text-xs text-muted-foreground tabular-nums">
 <span>{safeNum(low).toFixed(1)}</span>
 <span>{safeNum(high).toFixed(1)}</span>
 </div>
 </div>

 {/* Metrics Row */}
 <div className="grid grid-cols-3 gap-2">
 <div className="bg-muted/40 rounded-lg p-2 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">الحجم</p>
 <p className="text-xs font-semibold tabular-nums">{formatVolume(stock.volume)}</p>
 </div>
 <div className="bg-muted/40 rounded-lg p-2 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">مكرر الربحية</p>
 <p className="text-xs font-semibold tabular-nums">
 {stock.pe_ratio > 0 ? (stock.pe_ratio ?? 0).toFixed(1) : '—'}
 </p>
 </div>
 <div className="bg-muted/40 rounded-lg p-2 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">القيمة السوقية</p>
 <p className="text-xs font-semibold tabular-nums">{formatMarketCap(stock.market_cap)}</p>
 </div>
 </div>
 </CardContent>
 </Card>
 );
});

// ─── Mobile Row Component ─────────────────────────────────────────────────────
// UI-STABILITY fix (2026-09-28): wrap MobileStockRow in React.memo so it
// doesn't re-render when parent state that doesn't affect its props changes.
const MobileStockRow = memo(function MobileStockRow({
 stock,
 onClick,
}: {
 stock: Stock;
 onClick: () => void;
}) {
 const change = stock.price_change || 0;
 const isPositive = change > 0;
 const isNegative = change < 0;

 return (
 <div
 className="p-4 active:bg-muted/50 cursor-pointer border-b border-border/50 last:border-0"
 onClick={onClick}
 >
 <div className="flex items-center justify-between gap-3">
 {/* Stock Icon */}
 <StockIconMini
 ticker={stock.ticker}
 name={stock.name}
 sector={stock.sector}
 className="flex-shrink-0"
 />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 mb-1">
 <span className="font-bold text-sm text-profit ">
 {formatCleanTicker(stock.ticker)}
 </span>
 <div className="flex gap-1">
 {stock.egx30_member && (
 <span className="text-xs px-1 py-0.5 rounded bg-profit text-profit /30 font-medium">
 30
 </span>
 )}
 {stock.egx70_member && (
 <span className="text-xs px-1 py-0.5 rounded bg-warning text-warning /30 font-medium">
 70
 </span>
 )}
 </div>
 </div>
 <p className="text-xs text-muted-foreground truncate mb-0.5" dir="rtl">
 {stock.name_ar}
 </p>
 <span className="text-xs text-muted-foreground">{stock.sector}</span>
 </div>
 <div className="text-left flex-shrink-0">
 <FlashingPriceCell price={safeNum(stock.current_price) || null} className="font-bold text-sm" />
 <p
 className={cn(
 'text-xs font-medium tabular-nums flex items-center gap-0.5 justify-end',
 isPositive
 ? 'text-profit '
 : isNegative
 ? 'text-loss '
 : 'text-muted-foreground'
 )}
 >
 {isPositive ? (
 <TrendingUp className="w-3 h-3" />
 ) : isNegative ? (
 <TrendingDown className="w-3 h-3" />
 ) : (
 <Minus className="w-3 h-3" />
 )}
 {change >= 0 ? '+' : ''}
 {safeNum(change).toFixed(2)}%
 </p>
 </div>
 <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
 <ShareButton
 iconOnly
 variant="ghost"
 size="icon"
 stockData={{
 ticker: stock.ticker,
 name: stock.name,
 nameAr: stock.name_ar,
 price: stock.current_price,
 change: stock.price_change ?? undefined,
 sector: stock.sector,
 }}
 />
 <StockPublisher
 data={{
 ticker: stock.ticker,
 nameAr: stock.name_ar,
 nameEn: stock.name,
 sector: stock.sector,
 currentPrice: Number(stock.current_price ?? 0),
 changePct: Number(stock.price_change ?? 0),
 peRatio: Number(stock.pe_ratio ?? 0) || undefined,
 pbRatio: Number(stock.pb_ratio ?? 0) || undefined,
 roe: Number(stock.roe ?? 0) || undefined,
 marketCap: Number(stock.market_cap ?? 0) || undefined,
 rsi: Number(stock.rsi ?? 0) || undefined,
 market: (stock.market as StockPublishData['market']) || 'EGX',
 }}
 variant="icon"
 size="sm"
 />
 </div>
 </div>
 </div>
 );
});

// ─── Preset Buttons Row ───────────────────────────────────────────────────────
// UI-STABILITY fix (2026-09-28): wrap PresetButtonsRow in React.memo so it
// doesn't re-render on every parent state change (search, page, sort, etc.).
const PresetButtonsRow = memo(function PresetButtonsRow({
 activePreset,
 onSelect,
}: {
 activePreset: string;
 onSelect: (preset: string) => void;
}) {
 return (
 <Card className="py-0 gap-0">
 <CardContent className="p-3 md:p-4">
 <div className="flex items-center gap-2 mb-2 flex-wrap">
 <LayoutGrid className="w-4 h-4 text-profit " />
 <span className="text-sm font-semibold">القوائم المُسبقة</span>
 <span className="text-xs text-muted-foreground">— اختر قائمة لعرض الأسهم المُصنّفة</span>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
 {/* "All" button — first */}
 <button
 onClick={() => onSelect('all')}
 className={cn(
 'flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border',
 activePreset === 'all'
 ? 'bg-profit text-white border-profit shadow-sm'
 : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
 )}
 aria-pressed={activePreset === 'all'}
 >
 <LayoutGrid className="w-3.5 h-3.5" />
 <span>الكل</span>
 </button>
 {PRESET_BUTTONS.map((p) => {
 const Icon = p.icon;
 const isActive = activePreset === p.key;
 return (
 <button
 key={p.key}
 onClick={() => onSelect(p.key)}
 title={p.hint}
 aria-pressed={isActive}
 className={cn(
 'flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border',
 isActive
 ? 'bg-profit text-white border-profit shadow-sm'
 : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
 )}
 >
 <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-white' : 'text-profit ')} />
 <span className="truncate">{p.label}</span>
 </button>
 );
 })}
 </div>
 </CardContent>
 </Card>
 );
});

// ─── Advanced Filters Component ───────────────────────────────────────────────
// UI-STABILITY fix (2026-09-28): wrap AdvancedFilters in React.memo so it
// doesn't re-render on every parent state change unrelated to its props.
const AdvancedFilters = memo(function AdvancedFilters({
 selectedSectors,
 onToggleSector,
 priceMin,
 priceMax,
 onPriceMinChange,
 onPriceMaxChange,
 changeMin,
 changeMax,
 onChangeMinChange,
 onChangeMaxChange,
 onReset,
 availableSectors,
}: {
 selectedSectors: string[];
 onToggleSector: (sector: string) => void;
 priceMin: string;
 priceMax: string;
 onPriceMinChange: (v: string) => void;
 onPriceMaxChange: (v: string) => void;
 changeMin: string;
 changeMax: string;
 onChangeMinChange: (v: string) => void;
 onChangeMaxChange: (v: string) => void;
 onReset: () => void;
 availableSectors: string[];
}) {
 const hasAdvancedActive =
 selectedSectors.length > 0 ||
 priceMin !== '' ||
 priceMax !== '' ||
 changeMin !== '' ||
 changeMax !== '';

 return (
 <div className="space-y-3 pt-3 border-t border-border/50">
 {/* Sector multi-select chips */}
 <div>
 <p className="text-xs font-medium text-muted-foreground mb-2">القطاع</p>
 <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
 {availableSectors.map((sector) => {
 const isActive = selectedSectors.includes(sector);
 return (
 <button
 key={sector}
 onClick={() => onToggleSector(sector)}
 className={cn(
 'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
 isActive
 ? 'bg-profit text-white border-profit'
 : 'bg-background text-muted-foreground border-border hover:bg-muted'
 )}
 >
 {sector}
 </button>
 );
 })}
 {availableSectors.length === 0 && (
 <span className="text-xs text-muted-foreground">لا توجد قطاعات متاحة</span>
 )}
 </div>
 </div>

 {/* Price range + Change range side by side */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div>
 <p className="text-xs font-medium text-muted-foreground mb-2">نطاق السعر</p>
 <div className="flex items-center gap-2">
 <Input
 type="number"
 inputMode="decimal"
 value={priceMin}
 onChange={(e) => onPriceMinChange(e.target.value)}
 placeholder="أقل"
 className="h-8 text-xs"
 min={0}
 />
 <span className="text-xs text-muted-foreground">←</span>
 <Input
 type="number"
 inputMode="decimal"
 value={priceMax}
 onChange={(e) => onPriceMaxChange(e.target.value)}
 placeholder="أعلى"
 className="h-8 text-xs"
 min={0}
 />
 </div>
 </div>
 <div>
 <p className="text-xs font-medium text-muted-foreground mb-2">نطاق التغير %</p>
 <div className="flex items-center gap-2">
 <Input
 type="number"
 inputMode="decimal"
 value={changeMin}
 onChange={(e) => onChangeMinChange(e.target.value)}
 placeholder="أقل"
 className="h-8 text-xs"
 />
 <span className="text-xs text-muted-foreground">←</span>
 <Input
 type="number"
 inputMode="decimal"
 value={changeMax}
 onChange={(e) => onChangeMaxChange(e.target.value)}
 placeholder="أعلى"
 className="h-8 text-xs"
 />
 </div>
 </div>
 </div>

 {hasAdvancedActive && (
 <div>
 <Button
 variant="ghost"
 size="sm"
 className="h-8 text-xs text-muted-foreground hover:text-foreground"
 onClick={onReset}
 >
 <X className="w-3.5 h-3.5 ml-1" />
 إعادة تعيين الفلاتر المتقدمة
 </Button>
 </div>
 )}
 </div>
 );
});

// ─── Main StocksView Component ────────────────────────────────────────────────

export function StocksView() {
 const {
 selectedTicker,
 currentView,
 stocks,
 isLoading,
 loadStocks,
 loadCryptoList,
 refreshLivePrices,
 loadStockDetail,
 currentMarket,
 } = useAppStore();

 const t = useTranslation();

 // هل السوق الحالي هو البورصة المصرية؟
 const isEGX = currentMarket === 'EGX';
 // هل السوق الحالي هو الكريبتو؟
 const isCrypto = currentMarket === 'CRYPTO';
 const currencyLabel = isCrypto ? '$' : 'ج.م';

 const showDetail = selectedTicker !== null && currentView === 'stock-detail';

 // ── Local filter / sort / view state ──
 const [stockTab, setStockTab] = useState<StockTab>('stocks');
 const [localSearch, setLocalSearch] = useState('');
 const [debouncedSearch, setDebouncedSearch] = useState('');
 const [selectedSector, setSelectedSector] = useState('الكل');
 const [selectedIndex, setSelectedIndex] = useState('all');
 // (Task STOCKS-TABLE-FIX) إلغاء selectedSort — UnifiedTable بقت هي المرجع الوحيد للترتيب
 const [priceRange, setPriceRange] = useState('all');
 const [changeFilter, setChangeFilter] = useState('all');
 const [showFilters, setShowFilters] = useState(false);
 const [page, setPage] = useState(1);
 const [selectedPreset, setSelectedPreset] = useState('all');
 const [presetData, setPresetData] = useState<Array<Record<string, unknown>>>([]);
 const [presetLoading, setPresetLoading] = useState(false);
 const [presetPeriod, setPresetPeriod] = useState('1d');
 const [presetScanDate, setPresetScanDate] = useState<string | null>(null);

 // ── Advanced filter state (STOCKS-SCREEN-020) ──
 const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
 const [priceMin, setPriceMin] = useState('');
 const [priceMax, setPriceMax] = useState('');
 const [changeMin, setChangeMin] = useState('');
 const [changeMax, setChangeMax] = useState('');

 // ── Load stocks on mount + reload when market changes ──
 useEffect(() => {
 if (isCrypto) {
 loadCryptoList();
 } else {
 loadStocks('');
 }
 // Reset EGX-specific filters when switching markets
 setSelectedIndex('all');
 setSelectedSector('الكل');
 setLocalSearch('');
 setDebouncedSearch('');
 setSelectedSectors([]);
 setPriceMin('');
 setPriceMax('');
 setChangeMin('');
 setChangeMax('');
 setSelectedPreset('all');
 setStockTab('stocks');
 setPage(1);
 }, [loadStocks, loadCryptoList, currentMarket]); // eslint-disable-line react-hooks/exhaustive-deps

 // ── Auto-refresh live prices from Python backend every 30 seconds (EGX only) ──
 useEffect(() => {
 if (!isEGX) return;
 const interval = setInterval(() => {
 refreshLivePrices();
 }, 30000); // 30 seconds
 return () => clearInterval(interval);
 }, [refreshLivePrices, isEGX]);

 // ── Crypto auto-refresh: reload full coin list every 60 seconds ──
 useEffect(() => {
 if (!isCrypto) return;
 const interval = setInterval(() => {
 loadCryptoList();
 }, 60000); // 60 seconds
 return () => clearInterval(interval);
 }, [loadCryptoList, isCrypto]);

 // ── Debounced search ──
 useEffect(() => {
 const timer = setTimeout(() => {
 setDebouncedSearch(localSearch);
 }, 300);
 return () => clearTimeout(timer);
 }, [localSearch]);

 // ── Fetch preset data ──
 // Pattern: hits /api/stocks/presets?preset=X&market={currentMarket}&period=Y&limit=50
 // Backend tries persisted `screener_presets` table first, then falls back to on-the-fly.
 useEffect(() => {
 if (selectedPreset === 'all') {
 setPresetData([]);
 setPresetScanDate(null);
 return;
 }
 let cancelled = false;
 setPresetLoading(true);
 const qs = new URLSearchParams({
 preset: selectedPreset,
 period: presetPeriod,
 limit: '50',
 });
 if (currentMarket) qs.set('market', currentMarket);
 fetch(`/api/stocks/presets?${qs.toString()}`)
 .then(r => r.json())
 .then(data => {
 if (cancelled) return;
 if (data.success) {
 setPresetData(data.results || []);
 setPresetScanDate(data.scan_date || null);
 } else {
 setPresetData([]);
 setPresetScanDate(null);
 }
 setPresetLoading(false);
 })
 .catch(() => {
 if (cancelled) return;
 setPresetData([]);
 setPresetScanDate(null);
 setPresetLoading(false);
 });
 return () => { cancelled = true; };
 }, [selectedPreset, presetPeriod, currentMarket]);

 // ── Filtered stocks ──
 const filteredStocks = useMemo(() => {
 // Filter out null/undefined stocks first
 const validStocks = stocks.filter((stock): stock is Stock => stock != null && stock.ticker);

 // Parse advanced filter values once
 const pMin = priceMin !== '' ? Number(priceMin) : null;
 const pMax = priceMax !== '' ? Number(priceMax) : null;
 const cMin = changeMin !== '' ? Number(changeMin) : null;
 const cMax = changeMax !== '' ? Number(changeMax) : null;

 return validStocks.filter((stock) => {
 // Search filter
 if (debouncedSearch) {
 const q = debouncedSearch.toLowerCase();
 const matchesSearch =
 stock.ticker.toLowerCase().includes(q) ||
 stock.name.toLowerCase().includes(q) ||
 stock.name_ar.includes(q);
 if (!matchesSearch) return false;
 }

 // Sector filter (single-select dropdown — kept for backward compat)
 if (selectedSector !== 'الكل' && stock.sector !== selectedSector) {
 return false;
 }

 // Sector filter (multi-select chips — advanced)
 if (selectedSectors.length > 0 && !selectedSectors.includes(stock.sector || '')) {
 return false;
 }

 // Index filter
 if (selectedIndex === 'egx30' && !stock.egx30_member) return false;
 if (selectedIndex === 'egx70' && !stock.egx70_member) return false;
 if (selectedIndex === 'egx100' && !stock.egx100_member) return false;

 // Price range filter (preset buckets)
 const price = safeNum(stock.current_price);
 if (priceRange === 'under-10' && price >= 10) return false;
 if (priceRange === '10-50' && (price < 10 || price > 50)) return false;
 if (priceRange === '50-100' && (price < 50 || price > 100)) return false;
 if (priceRange === 'over-100' && price <= 100) return false;

 // Price range filter (advanced min/max)
 if (pMin !== null && Number.isFinite(pMin) && price < pMin) return false;
 if (pMax !== null && Number.isFinite(pMax) && price > pMax) return false;

 // Change filter (preset buckets)
 const change = stock.price_change ?? 0;
 if (changeFilter === 'gainers' && change <= 0) return false;
 if (changeFilter === 'losers' && change >= 0) return false;
 if (changeFilter === 'unchanged' && change !== 0) return false;

 // Change range filter (advanced min/max)
 if (cMin !== null && Number.isFinite(cMin) && change < cMin) return false;
 if (cMax !== null && Number.isFinite(cMax) && change > cMax) return false;

 return true;
 });
 }, [stocks, debouncedSearch, selectedSector, selectedSectors, selectedIndex, priceRange, changeFilter, priceMin, priceMax, changeMin, changeMax]);

 // ── Sorted stocks (Task STOCKS-TABLE-FIX: أبسطنا المنطق — الترتيب الأساسي بقا في UnifiedTable عبر initialSort) ──
 // هنا بنطبّق بس ترتيب أولوية البحث لما المستخدم يبحث (مثلاً تطابق تام للرمز يطلع الأول).
 // لو مفيش بحث → بنسيب الترتيب لـ UnifiedTable (عبر initialSort = change_1d desc).
 const sortedStocks = useMemo(() => {
 if (!debouncedSearch) return filteredStocks;
 const sorted = [...filteredStocks];
 const q = debouncedSearch.trim().toLowerCase();
 sorted.sort((a, b) => {
 const aTicker = (a.ticker || '').toLowerCase();
 const bTicker = (b.ticker || '').toLowerCase();
 const aName = (a.name || '').toLowerCase();
 const bName = (b.name || '').toLowerCase();
 const aNameAr = a.name_ar || '';
 const bNameAr = b.name_ar || '';

 // 1. Exact ticker match (highest priority)
 if (aTicker === q && bTicker !== q) return -1;
 if (bTicker === q && aTicker !== q) return 1;

 // 2. Ticker starts with query
 const aStartsTicker = aTicker.startsWith(q);
 const bStartsTicker = bTicker.startsWith(q);
 if (aStartsTicker && !bStartsTicker) return -1;
 if (!aStartsTicker && bStartsTicker) return 1;

 // 3. Ticker contains query
 const aInTicker = aTicker.includes(q);
 const bInTicker = bTicker.includes(q);
 if (aInTicker && !bInTicker) return -1;
 if (!aInTicker && bInTicker) return 1;

 // 4. Name starts with query
 const aStartsName = aName.startsWith(q) || aNameAr.startsWith(q);
 const bStartsName = bName.startsWith(q) || bNameAr.startsWith(q);
 if (aStartsName && !bStartsName) return -1;
 if (!aStartsName && bStartsName) return 1;

 return 0;
 });
 return sorted;
 }, [filteredStocks, debouncedSearch]);

 const isPresetMode = selectedPreset !== 'all';
 const presetDisplayData = useMemo(() => {
 if (!isPresetMode) return [];
 return presetData;
 }, [isPresetMode, presetData]);

 // ── Summary stats (from filtered stocks) ──
 const summaryStats = useMemo(() => {
 const total = filteredStocks.length;
 let gainers = 0;
 let losers = 0;
 let unchanged = 0;
 let changeSum = 0;
 let changeCount = 0;

 for (const stock of filteredStocks) {
 const change = stock.price_change ?? 0;
 if (change > 0) gainers++;
 else if (change < 0) losers++;
 else unchanged++;
 if (stock.price_change !== null) {
 changeSum += change;
 changeCount++;
 }
 }

 const avgChange = changeCount > 0 ? changeSum / changeCount : 0;

 return { total, gainers, losers, unchanged, avgChange };
 }, [filteredStocks]);

 // ── Apply filters to preset data too (not just normal mode) ──
 const filteredPresetData = useMemo(() => {
 if (!isPresetMode || presetDisplayData.length === 0) return [];

 const pMin = priceMin !== '' ? Number(priceMin) : null;
 const pMax = priceMax !== '' ? Number(priceMax) : null;
 const cMin = changeMin !== '' ? Number(changeMin) : null;
 const cMax = changeMax !== '' ? Number(changeMax) : null;

 return presetDisplayData.filter((stock: Record<string, unknown>) => {
 // Search filter
 if (debouncedSearch) {
 const q = debouncedSearch.toLowerCase();
 const ticker = (stock.ticker || '').toLowerCase();
 const name = (stock.name || '').toLowerCase();
 const name_ar = stock.name_ar || '';
 if (!ticker.includes(q) && !name.includes(q) && !name_ar.includes(q)) return false;
 }
 // Sector filter (single)
 if (selectedSector !== 'الكل' && stock.sector !== selectedSector) return false;
 // Sector filter (multi)
 if (selectedSectors.length > 0 && !selectedSectors.includes(stock.sector || '')) return false;
 // Index filter
 if (selectedIndex === 'egx30' && !stock.egx30_member) return false;
 if (selectedIndex === 'egx70' && !stock.egx70_member) return false;
 if (selectedIndex === 'egx100' && !stock.egx100_member) return false;
 // Price range
 const price = Number(stock.current_price || stock.price || 0);
 if (priceRange === 'under-10' && price >= 10) return false;
 if (priceRange === '10-50' && (price < 10 || price > 50)) return false;
 if (priceRange === '50-100' && (price < 50 || price > 100)) return false;
 if (priceRange === 'over-100' && price <= 100) return false;
 if (pMin !== null && Number.isFinite(pMin) && price < pMin) return false;
 if (pMax !== null && Number.isFinite(pMax) && price > pMax) return false;
 // Change filter
 const change = Number(stock.change_1d ?? stock.price_change ?? stock.change ?? 0);
 if (changeFilter === 'gainers' && change <= 0) return false;
 if (changeFilter === 'losers' && change >= 0) return false;
 if (changeFilter === 'unchanged' && change !== 0) return false;
 if (cMin !== null && Number.isFinite(cMin) && change < cMin) return false;
 if (cMax !== null && Number.isFinite(cMax) && change > cMax) return false;
 return true;
 });
 }, [isPresetMode, presetDisplayData, debouncedSearch, selectedSector, selectedSectors, selectedIndex, priceRange, priceMin, priceMax, changeMin, changeMax, changeFilter]);

 // ── Pagination ──
 const baseData = isPresetMode ? filteredPresetData : sortedStocks;
 const totalPages = Math.max(1, Math.ceil(baseData.length / PAGE_SIZE));
 const safePage = Math.min(page, totalPages);
 const paginatedStocks = baseData.slice(
 (safePage - 1) * PAGE_SIZE,
 safePage * PAGE_SIZE
 );

 // ── Handlers ──
 const handleRowClick = useCallback(
 (ticker: string) => {
 loadStockDetail(ticker);
 },
 [loadStockDetail]
 );

 const resetPage = useCallback(() => setPage(1), []);

 // ── UnifiedTable columns (desktop) ──
 type DesktopRow = Record<string, unknown>;
 const stocksColumns: Column<DesktopRow>[] = useMemo(() => {
 const cols: Column<DesktopRow>[] = [
 {
 key: 'icon',
 header: '',
 align: 'right',
 width: 'w-12',
 render: (row) => (
 <StockIconMini
 ticker={String(row.ticker ?? '')}
 name={String(row.name ?? '')}
 sector={String(row.sector ?? '')}
 />
 ),
 },
 {
 key: 'ticker',
 header: t('stocks.columns.ticker'),
 align: 'right',
 sortable: true,
 filterable: true,
 render: (row) => (
 <div className="flex items-center gap-1">
 <span className="font-bold text-sm text-profit ">
 {formatCleanTicker(String(row.ticker ?? ''))}
 </span>
 {row.egx30_member && (
 <span className="text-xs px-1 py-0.5 rounded bg-profit text-profit /30 font-medium">
 30
 </span>
 )}
 {row.egx70_member && (
 <span className="text-xs px-1 py-0.5 rounded bg-warning text-warning /30 font-medium">
 70
 </span>
 )}
 </div>
 ),
 },
 {
 key: 'name_ar',
 header: t('stocks.columns.name'),
 align: 'right',
 sortable: true,
 filterable: true,
 // (Task STOCKS-TABLE-V2) fallback للـ name الإنجليزي لو name_ar فاضي،
 // + max-w أكبر (180px بدل 160px) + title للـ tooltip على الـ truncate.
 render: (row) => {
 const name = (row.name_ar as string | null | undefined) || (row.name as string | null | undefined) || '';
 return (
 <div className="max-w-[180px] truncate text-sm" dir="rtl" title={name || undefined}>
 {name || '—'}
 </div>
 );
 },
 },
 ];

 if (!isCrypto) {
 cols.push({
 key: 'sector',
 header: t('stocks.columns.sector'),
 align: 'right',
 sortable: true,
 filterable: true,
 // (Task STOCKS-TABLE-V2) متاح افتراضياً (كان مخفي في الـ fix السابق).
 render: (row) => (
 <span
 className={cn(
 'inline-block text-xs px-2 py-0.5 rounded font-medium max-w-[120px] truncate',
 getSectorColor(row.sector as string | undefined),
 )}
 title={row.sector as string | undefined}
 >
 {(row.sector as string) || '—'}
 </span>
 ),
 });
 }

 cols.push(
 {
 key: 'current_price',
 header: t('stocks.columns.price', { currency: currencyLabel }),
 align: 'left',
 sortable: true,
 filterable: true,
 render: (row) => (
 <span className="font-semibold text-sm tabular-nums">
 {safeNum(row.current_price as number).toFixed(2)}
 </span>
 ),
 },
 {
 key: 'change_1d',
 header: t('stocks.columns.dayPct'),
 align: 'left',
 sortable: true,
 filterable: true,
 render: (row) => {
 const change = row.change_1d != null ? row.change_1d : (row.price_change ?? 0);
 const isPositive = Number(change) > 0;
 const isNegative = Number(change) < 0;
 return (
 <div
 className={cn(
 'flex items-center gap-1 justify-end text-sm font-medium tabular-nums',
 isPositive
 ? 'text-profit '
 : isNegative
 ? 'text-loss '
 : 'text-muted-foreground'
 )}
 >
 {isPositive ? (
 <TrendingUp className="w-3.5 h-3.5" />
 ) : isNegative ? (
 <TrendingDown className="w-3.5 h-3.5" />
 ) : (
 <Minus className="w-3.5 h-3.5" />
 )}
 {formatPercent(change)}
 </div>
 );
 },
 },
 // (Task STOCKS-TABLE-V2) عمود جديد: أعلى/أدنى سعر للجلسة بصيغة "256.40 / 234.02"
 {
 key: 'high_low',
 header: t('stocks.columns.highLow'),
 align: 'left',
 sortable: false,
 render: (row) => {
 const high = safeNum(row.high_price as number);
 const low = safeNum(row.low_price as number);
 if (high <= 0 && low <= 0) return <span className="text-muted-foreground">—</span>;
 return (
 <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
 <span className="text-profit font-medium">{(high ?? 0).toFixed(2)}</span>
 <span className="mx-1 text-muted-foreground/60">/</span>
 <span className="text-loss font-medium">{(low ?? 0).toFixed(2)}</span>
 </span>
 );
 },
 },
 {
 key: 'sparkline',
 header: t('stocks.columns.chart7d'),
 align: 'center',
 width: 'w-32',
 render: (row) => (
 <div className="w-32 mx-auto" dir="ltr">
 <MiniSparkline
 ticker={String(row.ticker ?? '')}
 days={7}
 height={28}
 width={120}
 showArea
 />
 </div>
 ),
 },
 {
 key: 'change_1w',
 header: t('stocks.columns.weekPct'),
 align: 'left',
 sortable: true,
 filterable: true,
 // (Task STOCKS-TABLE-V2) متاح افتراضياً (كان مخفي في الـ fix السابق).
 render: (row) => {
 const change1w = row.change_1w ?? null;
 return (
 <span className={cn('text-xs tabular-nums font-medium', changeColorClass(change1w))}>
 {formatPercent(change1w)}
 </span>
 );
 },
 },
 );

 if (!isCrypto) {
 cols.push({
 key: 'change_1m',
 header: t('stocks.columns.monthPct'),
 align: 'left',
 sortable: true,
 filterable: true,
 hidden: true, // (Task STOCKS-TABLE-FIX) مخفي افتراضياً
 render: (row) => {
 const change1m = row.change_1m ?? null;
 return (
 <span className={cn('text-xs tabular-nums font-medium', changeColorClass(change1m))}>
 {formatPercent(change1m)}
 </span>
 );
 },
 });
 }

 cols.push({
 key: 'volume_int',
 header: t('stocks.columns.volumeToday'),
 align: 'left',
 sortable: true,
 filterable: true,
 render: (row) => {
 const volToday = row.volume_int ?? (row.volume ?? 0);
 return (
 <span className="text-xs text-muted-foreground tabular-nums">
 {formatVolume(volToday)}
 </span>
 );
 },
 });

 // (Task STOCKS-TABLE-V2) عمود جديد: قيمة التداول (turnover) — متاح عبر columnToggle.
 // مش ظاهر افتراضياً لأن turnover_egp ممكن يكون null لكتير من الأسهم.
 if (!isCrypto) {
 cols.push({
 key: 'turnover',
 header: t('stocks.columns.turnover'),
 align: 'left',
 sortable: true,
 filterable: true,
 hidden: true,
 render: (row) => (
 <span className="text-xs text-muted-foreground tabular-nums">
 {formatTurnover((row.turnover_egp as number | null | undefined) ?? (row.value_traded as number | null | undefined) ?? null)}
 </span>
 ),
 });
 }

 if (!isCrypto) {
 cols.push(
 {
 key: 'volume_week',
 header: t('stocks.columns.volumeWeek'),
 align: 'left',
 sortable: true,
 filterable: true,
 hidden: true, // (Task STOCKS-TABLE-FIX) مخفي افتراضياً
 render: (row) => {
 const volWeek = row.volume_week ?? null;
 return (
 <span className="text-xs text-muted-foreground tabular-nums">
 {formatVolume(volWeek)}
 </span>
 );
 },
 },
 {
 key: 'fair_value',
 header: t('stocks.columns.fairValue'),
 align: 'left',
 sortable: true,
 filterable: true,
 // (Task STOCKS-TABLE-V2) متاح افتراضياً (كان مخفي في الـ fix السابق).
 render: (row) => {
 const fairValue = row.fair_value ?? null;
 const currentPrice = Number(row.current_price ?? 0);
 return (
 <span
 className={cn(
 'text-xs tabular-nums font-medium',
 fairValue != null && currentPrice && fairValue > currentPrice
 ? 'text-profit '
 : fairValue != null && currentPrice && fairValue < currentPrice
 ? 'text-loss '
 : 'text-muted-foreground',
 )}
 >
 {fairValue != null ? safeNum(fairValue).toFixed(2) : '—'}
 </span>
 );
 },
 },
 {
 key: 'upside_percent',
 header: t('stocks.columns.opportunityPct'),
 align: 'left',
 sortable: true,
 filterable: true,
 // (Task STOCKS-TABLE-V2) متاح افتراضياً (كان مخفي في الـ fix السابق).
 render: (row) => {
 const upside = row.upside_percent ?? null;
 return (
 <span
 className={cn(
 'text-xs tabular-nums font-medium',
 upside != null && upside > 5 ? 'text-profit ' :
 upside != null && upside < -5 ? 'text-loss ' :
 'text-muted-foreground',
 )}
 >
 {upside != null ? formatPercent(upside, 1) : '—'}
 </span>
 );
 },
 },
 {
 key: 'pe_ratio',
 header: t('stocks.columns.pe'),
 align: 'left',
 sortable: true,
 filterable: true,
 hidden: true, // (Task STOCKS-TABLE-FIX) مخفي افتراضياً
 render: (row) => {
 const peRatio = row.pe_ratio ?? null;
 return (
 <span className="text-xs tabular-nums">
 {peRatio != null && peRatio > 0 ? peRatio.toFixed(1) : '—'}
 </span>
 );
 },
 },
 );
 }

 cols.push(
 // (Task STOCKS-TABLE-V2) عمود جديد: إشارة فنية ملوّنة بناءً على RSI + تقاطع MA.
 // مش ظاهر افتراضياً لأنه يحتاج بيانات indicators مش متوفرة دايماً.
 {
 key: 'technical_signal',
 header: t('stocks.columns.signal'),
 align: 'center',
 sortable: true,
 filterable: false,
 hidden: true,
 render: (row) => {
 // defensive: نقرأ signal مباشرة لو موجود، وإلا نحسب من RSI + MA.
 const signalRaw = (row.signal as string | null | undefined) ?? (row.technical_signal as string | null | undefined);
 if (signalRaw) {
 const s = String(signalRaw).toLowerCase();
 const isBuy = s.includes('buy') || s.includes('strong') || s.includes('bull');
 const isSell = s.includes('sell') || s.includes('bear') || s.includes('avoid');
 const label = isBuy ? t('stocks.signal.buy') : isSell ? t('stocks.signal.sell') : t('stocks.signal.hold');
 const cls = isBuy
 ? 'bg-profit text-profit /30 '
 : isSell
 ? 'bg-loss text-loss /30 '
 : 'bg-warning text-warning /30 ';
 return (
 <span className={cn('inline-block text-xs px-2 py-0.5 rounded font-bold', cls)}>
 {label}
 </span>
 );
 }
 // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────
 // قبل كده: كان فيه client-side fallback بـ RSI thresholds 70/30 + MA50/MA200
 // → نتائج متضاربة مع canonical signal classification.
 // الحل: لو signal من DB موجود → نعرضه. لو NULL → "—" (لا fabrication).
 return <span className="text-muted-foreground">—</span>;
 },
 },
 {
 key: 'market_cap',
 header: t('stocks.columns.marketCap'),
 align: 'right',
 sortable: true,
 filterable: true,
 hidden: true, // (Task STOCKS-TABLE-FIX) مخفي افتراضياً
 render: (row) => (
 <span className="text-xs text-muted-foreground tabular-nums">
 {formatMarketCap(safeNum(row.market_cap as number))}
 </span>
 ),
 },
 {
 key: 'share',
 header: '',
 align: 'center',
 width: 'w-10',
 render: (row) => {
 const change = row.change_1d != null ? row.change_1d : (row.price_change ?? 0);
 return (
 <div onClick={(e) => e.stopPropagation()}>
 <ShareButton
 iconOnly
 variant="ghost"
 size="icon"
 stockData={{
 ticker: String(row.ticker ?? ''),
 name: String(row.name ?? ''),
 nameAr: String(row.name_ar ?? ''),
 price: Number(row.current_price ?? 0),
 change,
 sector: String(row.sector ?? ''),
 }}
 />
 </div>
 );
 },
 },
 );

 return cols;
 }, [isCrypto, currencyLabel]);

 const handleSectorChange = useCallback((value: string) => {
 setSelectedSector(value);
 setPage(1);
 }, []);

 const handleIndexChange = useCallback((key: string) => {
 setSelectedIndex(key);
 setPage(1);
 }, []);

 const handleSearchChange = useCallback((value: string) => {
 setLocalSearch(value);
 setPage(1);
 }, []);

 const handleClearSearch = useCallback(() => {
 setLocalSearch('');
 setDebouncedSearch('');
 setPage(1);
 }, []);

 const handlePriceRangeChange = useCallback((value: string) => {
 setPriceRange(value);
 setPage(1);
 }, []);

 const handleChangeFilterChange = useCallback((value: string) => {
 setChangeFilter(value);
 setPage(1);
 }, []);

 const handleResetFilters = useCallback(() => {
 setLocalSearch('');
 setDebouncedSearch('');
 setSelectedSector('الكل');
 setSelectedSectors([]);
 setSelectedIndex('all');
 setPriceRange('all');
 setChangeFilter('all');
 setPriceMin('');
 setPriceMax('');
 setChangeMin('');
 setChangeMax('');
 setPage(1);
 }, []);

 const handleToggleSector = useCallback((sector: string) => {
 setSelectedSectors((prev) =>
 prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
 );
 setPage(1);
 }, []);

 const handleResetAdvanced = useCallback(() => {
 setSelectedSectors([]);
 setPriceMin('');
 setPriceMax('');
 setChangeMin('');
 setChangeMax('');
 setPage(1);
 }, []);

 const handlePresetSelect = useCallback((preset: string) => {
 setSelectedPreset(preset);
 setPresetPeriod('1d');
 setPage(1);
 }, []);

 // (Task STOCKS-TABLE-V2) Quick filter chips handler — يوحّد فلاتر المؤشر (index)
 // والقوائم المسبقة (preset) في chip واحد. لو اخترت chip مؤشر → نمسح الـ preset،
 // لو اخترت chip preset → نمسح الـ index، عشان يبقوا mutually exclusive.
 const handleQuickFilter = useCallback((key: QuickFilterKey) => {
 setPage(1);
 if (key === 'all') {
 setSelectedIndex('all');
 setSelectedPreset('all');
 } else if (key === 'egx30' || key === 'egx70') {
 setSelectedIndex(key);
 setSelectedPreset('all');
 } else {
 // preset chips: top_gainers | top_losers | most_active
 setSelectedPreset(key);
 setSelectedIndex('all');
 setPresetPeriod('1d');
 }
 }, []);

 // (Task STOCKS-TABLE-V2) الـ chip النشط حالياً (لو preset شغال → أولى، غير كده index).
 const activeQuickFilter: QuickFilterKey = useMemo(() => {
 if (selectedPreset === 'top_gainers') return 'top_gainers';
 if (selectedPreset === 'top_losers') return 'top_losers';
 if (selectedPreset === 'most_active') return 'most_active';
 if (selectedIndex === 'egx30') return 'egx30';
 if (selectedIndex === 'egx70') return 'egx70';
 return 'all';
 }, [selectedPreset, selectedIndex]);

 const isInitialLoading = isLoading && stocks.length === 0;

 const hasActiveFilters =
 selectedSector !== 'الكل' ||
 selectedSectors.length > 0 ||
 selectedIndex !== 'all' ||
 priceRange !== 'all' ||
 changeFilter !== 'all' ||
 priceMin !== '' ||
 priceMax !== '' ||
 changeMin !== '' ||
 changeMax !== '' ||
 localSearch.length > 0;

 // ── Available sectors (computed from loaded stocks) ──
 const availableSectors = useMemo(() => {
 const set = new Set<string>();
 for (const s of stocks) {
 if (s && s.sector) set.add(s.sector);
 }
 return Array.from(set).sort((a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ar'));
 }, [stocks]);

 // ── Detail View ──
 if (showDetail) {
 return (
 <div className="flex flex-col min-h-screen">
 <Header
 title={t('stocks.detail.title')}
 />
 <main className="flex-1 p-3 md:p-6 max-w-7xl mx-auto w-full">
 <StockDetail />
 </main>
 </div>
 );
 }

 // ── Stocks List / Card View ──
 // UNIFIED-MARKET-VIEW (Task 3): page title + subtitle بيتحدّدوا حسب currentMarket
 const pageTitle = isCrypto ? t('stocks.title.crypto') : t('stocks.title.stocks');
 const pageSubtitle = isCrypto
 ? t('stocks.subtitle.crypto')
 : t('stocks.subtitle.stocks', { market: MARKET_NAMES_AR[currentMarket] || t('markets.egypt') });

 return (
 <div className="flex flex-col min-h-screen" dir="rtl">
 <Header
 title={pageTitle}
 subtitle={pageSubtitle}
 />
 <main className="flex-1 p-3 md:p-6 max-w-7xl mx-auto w-full space-y-3 md:space-y-4">
 {/* ── Tabs ── */}
 <div className="flex gap-2">
 <button
 onClick={() => setStockTab('stocks')}
 className={cn(
 'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border',
 stockTab === 'stocks'
 ? 'bg-profit text-white border-profit shadow-sm'
 : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
 )}
 >
 <BarChart3 className="w-4 h-4" />
 {isCrypto ? t('stocks.tabs.crypto') : t('stocks.tabs.stocks')}
 </button>
 {currentMarket !== 'CRYPTO' && (
 <button
 onClick={() => setStockTab('bonds')}
 className={cn(
 'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border',
 stockTab === 'bonds'
 ? 'bg-profit text-white border-profit shadow-sm'
 : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
 )}
 >
 <Landmark className="w-4 h-4" />
 {t('stocks.tabs.bonds')}
 </button>
 )}
 {/* RESTRUCT-A-P2: filters tab merged from top-level #stock-filters */}
 <button
 onClick={() => setStockTab('filters')}
 className={cn(
 'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border',
 stockTab === 'filters'
 ? 'bg-profit text-white border-profit shadow-sm'
 : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
 )}
 >
 <Filter className="w-4 h-4" />
 الفلاتر
 </button>
 </div>

 {/* ── Bonds View ── */}
 {/* UI-STABILITY fix (2026-09-28): stable key on conditional section */}
 {stockTab === 'bonds' && <TreasuryBondsView key="stocks-bonds-view" />}

 {/* RESTRUCT-A-P2: Filters merged from #stock-filters top-level */}
 {stockTab === 'filters' && <StockScreenerAdvanced key="stocks-filters-view" />}

 {/* ── Stocks View ── */}
 {/* UI-STABILITY fix (2026-09-28): stable key on conditional fragment wrapper */}
 {stockTab === 'stocks' && (
 <React.Fragment key="stocks-stocks-view">
 {/* ── Preset Buttons Row (STOCKS-SCREEN-020) — EGX only; /api/stocks/presets doesn't serve crypto ── */}
 {!isCrypto && (
 <PresetButtonsRow
 activePreset={selectedPreset}
 onSelect={handlePresetSelect}
 />
 )}

 {/* ── Search + Quick Filters + Advanced Filter Toggle ── */}
 {/* (Task STOCKS-TABLE-V2) دمج الـ search + الـ quick filter chips في كارت واحد،
 وإلغاء الـ StockSelector المكرر (كان بيعمل مستوى بحث تالت فوق الـ search العادي). */}
 <Card className="py-0 gap-0">
 <CardContent className="p-4 space-y-3">
 {/* Row 1: Search + Advanced Filter Toggle (less prominent) + Publish */}
 <div className="flex items-center gap-2 flex-wrap">
 {/* Search — ده الـ search الوحيد في الشاشة */}
 <div className="relative flex-1 min-w-[140px] sm:min-w-[200px]">
 <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
 <Input
 value={localSearch}
 onChange={(e) => handleSearchChange(e.target.value)}
 placeholder={t('stocks.search.placeholder')}
 className="pr-10 h-9"
 dir="rtl"
 />
 {localSearch && (
 <Button
 variant="ghost"
 size="icon"
 className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6"
 onClick={handleClearSearch}
 >
 ×
 </Button>
 )}
 </div>

 {/* (Task STOCKS-TABLE-V2) Advanced Filter Toggle — variant=ghost بدل outline/default عشان يبقى أقل بروزاً. */}
 <Button
 variant="ghost"
 size="sm"
 className={cn(
 'h-9 gap-1.5 text-xs',
 showFilters && 'bg-muted text-foreground',
 )}
 onClick={() => setShowFilters((prev) => !prev)}
 title={t('stocks.filterButton.title')}
 >
 <Filter className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('stocks.filterButton.label')}</span>
 {hasActiveFilters && (
 <span className="h-2 w-2 rounded-full bg-warning" />
 )}
 </Button>

 {/* Publish Button */}
 <UnifiedPublishButton
 variant="outline"
 size="sm"
 className="h-9 text-xs"
 title={`قائمة الأسهم — ${MARKET_NAMES_AR[currentMarket] || currentMarket}`}
 content={`قائمة الأسهم — ${MARKET_NAMES_AR[currentMarket] || currentMarket}\nعدد الأسهم المعروضة: ${baseData.length}\nالفرز الافتراضي: ${DEFAULT_SORT_KEY} ${DEFAULT_SORT_DIR}\n\n${baseData.slice(0, 15).map((s, i) => `${i + 1}. ${s.ticker} — ${safeNum(s.last_price ?? s.close).toFixed(2)} (${safeNum(s.change_pct ?? s.change_percent).toFixed(2)}%)`).join('\n')}`}
 filename={`stocks-${currentMarket}-${Date.now()}`}
 hashtags={['أسهم', currentMarket, 'بورصة']}
 triggerLabel="نشر"
 />
 </div>

 {/* Row 2: Quick Filter Chips (always visible) —Task STOCKS-TABLE-V2 */}
 <div className="flex flex-wrap gap-1.5 items-center">
 {QUICK_FILTERS.map((chip) => {
 const isActive = activeQuickFilter === chip.key;
 return (
 <button
 key={chip.key}
 onClick={() => handleQuickFilter(chip.key)}
 className={cn(
 'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
 isActive
 ? 'bg-profit text-white border-profit'
 : 'bg-background text-muted-foreground border-border hover:bg-muted',
 )}
 >
 {chip.label}
 </button>
 );
 })}
 </div>

 {/* Row 3: Advanced Filters (collapsible) */}
 {showFilters && (
 <div className="space-y-3 pt-3 border-t border-border/50">
 {/* Row 2a: Quick filters (preset select, period, sector dropdown, index chips, price/change buckets) */}
 <div className="flex flex-wrap gap-2 items-center">
 {/* Preset Selector (also accessible via top preset buttons) */}
 <Select value={selectedPreset} onValueChange={(v) => { setSelectedPreset(v); setPage(1); }}>
 <SelectTrigger className="w-auto min-w-[140px] sm:min-w-[170px] h-8 text-xs" size="sm">
 <SelectValue placeholder="قائمة مسبقة" />
 </SelectTrigger>
 <SelectContent>
 {PRESET_OPTIONS.map(opt => (
 <SelectItem key={opt.key} value={opt.key} className="text-xs">
 <span className="ml-1">{opt.icon}</span> {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>

 {/* Period Selector for gainers/losers */}
 {(selectedPreset === 'top_gainers' || selectedPreset === 'top_losers') && (
 <div className="flex gap-1">
 {[
 { key: '1d', label: t('stocks.period.day') },
 { key: '1w', label: t('stocks.period.week') },
 { key: '1m', label: t('stocks.period.month') },
 ].map(p => (
 <button
 key={p.key}
 onClick={() => setPresetPeriod(p.key)}
 className={cn(
 'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
 presetPeriod === p.key
 ? 'bg-profit text-white border-profit'
 : 'bg-background text-muted-foreground border-border hover:bg-muted'
 )}
 >
 {p.label}
 </button>
 ))}
 </div>
 )}

 {/* Sector (single-select — kept for quick filter) — hidden for crypto (single sector) */}
 {/* UNIFIED-MARKET-VIEW (Task 3): for EGX use the curated SECTORS list (English names that
 match EGX data); for TADAWUL/KSE/QSE use `availableSectors` computed from loaded
 stocks so the dropdown is always accurate for the active market. */}
 {!isCrypto && (
 <Select value={selectedSector} onValueChange={handleSectorChange}>
 <SelectTrigger className="w-auto min-w-[110px] sm:min-w-[130px] h-8 text-xs" size="sm">
 <SelectValue placeholder={t('stocks.filters.sector')} />
 </SelectTrigger>
 <SelectContent>
 {(isEGX
 ? SECTORS
 : ['الكل', ...availableSectors]
 ).map((sector) => (
 <SelectItem key={sector} value={sector} className="text-xs">
 {sector}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 )}

 {/* Index Chips - تظهر فقط للبورصة المصرية */}
 {currentMarket !== 'CRYPTO' && (
 <div className="flex gap-1.5 flex-wrap">
 {(INDEX_FILTERS[currentMarket] || DEFAULT_INDEX_FILTERS).map((filter) => (
 <button
 key={filter.key}
 onClick={() => handleIndexChange(filter.key)}
 className={cn(
 'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
 selectedIndex === filter.key
 ? 'bg-profit text-white border-profit'
 : 'bg-background text-muted-foreground border-border hover:bg-muted'
 )}
 >
 {filter.label}
 </button>
 ))}
 </div>
 )}

 {/* Price Range */}
 <Select value={priceRange} onValueChange={handlePriceRangeChange}>
 <SelectTrigger className="w-auto min-w-[110px] sm:min-w-[130px] h-8 text-xs" size="sm">
 <SelectValue placeholder={t('stocks.filters.priceRange')} />
 </SelectTrigger>
 <SelectContent>
 {PRICE_RANGE_OPTIONS.map((opt) => (
 <SelectItem key={opt.key} value={opt.key} className="text-xs">
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>

 {/* Change Filter */}
 <Select value={changeFilter} onValueChange={handleChangeFilterChange}>
 <SelectTrigger className="w-auto min-w-[110px] sm:min-w-[130px] h-8 text-xs" size="sm">
 <SelectValue placeholder={t('stocks.filters.changeRange')} />
 </SelectTrigger>
 <SelectContent>
 {CHANGE_FILTER_OPTIONS.map((opt) => (
 <SelectItem key={opt.key} value={opt.key} className="text-xs">
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>

 {/* Reset */}
 {hasActiveFilters && (
 <Button
 variant="ghost"
 size="sm"
 className="h-8 text-xs text-muted-foreground hover:text-foreground"
 onClick={handleResetFilters}
 >
 {t('stocks.filters.reset')}
 </Button>
 )}
 </div>

 {/* Row 2b: Advanced filters (sector multi-select, price min/max, change min/max) */}
 <AdvancedFilters
 selectedSectors={selectedSectors}
 onToggleSector={handleToggleSector}
 priceMin={priceMin}
 priceMax={priceMax}
 onPriceMinChange={setPriceMin}
 onPriceMaxChange={setPriceMax}
 changeMin={changeMin}
 changeMax={changeMax}
 onChangeMinChange={setChangeMin}
 onChangeMaxChange={setChangeMax}
 onReset={handleResetAdvanced}
 availableSectors={availableSectors}
 />
 </div>
 )}
 </CardContent>
 </Card>

 {/* ── Overview Summary Bar ── */}
 {isInitialLoading ? (
 <SummarySkeleton />
 ) : isPresetMode ? (
 <div className="flex items-center gap-2 flex-wrap">
 <div className="flex items-center gap-1.5 bg-profit/10 rounded-lg px-3 py-1.5">
 <span className="text-sm font-bold">
 {PRESET_OPTIONS.find(p => p.key === selectedPreset)?.icon} {' '}
 {PRESET_OPTIONS.find(p => p.key === selectedPreset)?.label}
 </span>
 </div>
 <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
 <span className="text-xs font-medium text-muted-foreground">{t('stocks.footer.count')}</span>
 <span className="text-sm font-bold">{presetData.length}</span>
 </div>
 {presetScanDate && (
 <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
 <span className="text-xs font-medium text-muted-foreground">{t('stocks.footer.lastUpdate')}</span>
 <span className="text-xs tabular-nums">{new Date(presetScanDate).toLocaleString('ar-EG')}</span>
 </div>
 )}
 {presetLoading && (
 <div className="flex items-center gap-1.5 bg-warning/10 rounded-lg px-3 py-1.5">
 <span className="text-xs text-warning animate-pulse">{t('stocks.footer.loading')}</span>
 </div>
 )}
 </div>
 ) : (
 <OverviewSummary
 total={summaryStats.total}
 gainers={summaryStats.gainers}
 losers={summaryStats.losers}
 unchanged={summaryStats.unchanged}
 avgChange={summaryStats.avgChange}
 />
 )}

 {/* ── Stock Content ── */}
 {isInitialLoading ? (
 <Card className="py-0 overflow-hidden">
 <CardContent className="p-4">
 <TableSkeleton />
 </CardContent>
 </Card>
 ) : paginatedStocks.length === 0 ? (
 <Card className="py-0 overflow-hidden">
 <CardContent className="p-12 text-center">
 <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
 <p className="text-muted-foreground text-sm">
 {isPresetMode
 ? t('stocks.empty.presetMissing')
 : t('stocks.empty.noMatches')}
 </p>
 {hasActiveFilters && (
 <Button
 variant="outline"
 size="sm"
 className="mt-3 text-xs"
 onClick={handleResetFilters}
 >
 {t('stocks.empty.resetFilters')}
 </Button>
 )}
 {isPresetMode && (
 <Button
 variant="outline"
 size="sm"
 className="mt-3 text-xs"
 onClick={() => setSelectedPreset('all')}
 >
 {t('stocks.empty.showAll')}
 </Button>
 )}
 </CardContent>
 </Card>
 ) : (
 /* ── Table View ── */
 <Card className="py-0 overflow-hidden">
 <>
 {/* Desktop Table */}
 <div className="hidden md:block">
 <UnifiedTable<Record<string, unknown>>
 columns={stocksColumns}
 /* (Task STOCKS-TABLE-FIX) نمرّر الـ dataset كامل بدل صفحة واحدة،
 عشان الترتيب عبر ضغط الأعمدة يطبّق على كل الأسهم مش بس الصفحة الحالية.
 الـ scroll بيتحكم فيه maxHeight. */
 data={baseData as unknown as Record<string, unknown>[]}
 keyField="ticker"
 onRowClick={(row) => handleRowClick(String(row.ticker))}
 stickyHeader
 dense={false}
 maxHeight="max-h-[70vh]"
 emptyTextAr={t('stocks.empty.noMatches')}
 filterable
 columnToggle
 initialSort={{ key: DEFAULT_SORT_KEY, dir: DEFAULT_SORT_DIR }}
 />
 </div>

 {/* Mobile List — compact view (ticker, name, price, change %, fair_value, upside) */}
 <div className="md:hidden divide-y divide-border/50">
 {paginatedStocks.map((item) => {
 const change = item.change_1d != null ? item.change_1d : (item.price_change ?? 0);
 const change1w = item.change_1w ?? null;
 const fairValue = item.fair_value ?? null;
 const upside = item.upside_percent ?? null;
 const isPositive = Number(change) > 0;
 const isNegative = Number(change) < 0;
 return (
 <div
 key={item.ticker}
 className="p-4 active:bg-muted/50 cursor-pointer"
 onClick={() => handleRowClick(item.ticker)}
 >
 <div className="flex items-center justify-between gap-3">
 <StockIconMini
 ticker={item.ticker}
 name={item.name}
 sector={item.sector}
 className="flex-shrink-0"
 />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 mb-1 flex-wrap">
 <span className="font-bold text-sm text-profit ">
 {item.ticker}
 </span>
 {(item as Stock).egx30_member && (
 <span className="text-xs px-1 py-0.5 rounded bg-profit text-profit /30 font-medium">
 30
 </span>
 )}
 {(item as Stock).egx70_member && (
 <span className="text-xs px-1 py-0.5 rounded bg-warning text-warning /30 font-medium">
 70
 </span>
 )}
 </div>
 <p className="text-xs text-muted-foreground truncate mb-0.5" dir="rtl">
 {item.name_ar}
 </p>
 <span className={cn(
 'inline-block text-xs px-1.5 py-0.5 rounded font-medium',
 getSectorColor(item.sector)
 )}>
 {item.sector || '—'}
 </span>
 </div>
 <div className="text-left flex-shrink-0">
 <p className="font-bold text-sm tabular-nums">
 {safeNum(item.current_price).toFixed(2)}
 </p>
 <p
 className={cn(
 'text-xs font-medium tabular-nums flex items-center gap-0.5 justify-end',
 isPositive
 ? 'text-profit '
 : isNegative
 ? 'text-loss '
 : 'text-muted-foreground'
 )}
 >
 {isPositive ? (
 <TrendingUp className="w-3 h-3" />
 ) : isNegative ? (
 <TrendingDown className="w-3 h-3" />
 ) : (
 <Minus className="w-3 h-3" />
 )}
 {formatPercent(change)}
 </p>
 </div>
 </div>
 <div className="mt-2">
 <MiniSparkline ticker={item.ticker} height={24} width={120} showArea />
 </div>
 {/* Secondary row: 1w change + fair_value + upside */}
 <div className="grid grid-cols-3 gap-2 mt-2">
 <div className="bg-muted/40 rounded-lg p-1.5 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">{t('stocks.mobile.week')}</p>
 <p className={cn('text-xs font-semibold tabular-nums', changeColorClass(change1w))}>
 {formatPercent(change1w)}
 </p>
 </div>
 <div className="bg-muted/40 rounded-lg p-1.5 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">{t('stocks.mobile.fairValue')}</p>
 <p className={cn(
 'text-xs font-semibold tabular-nums',
 fairValue != null && item.current_price && fairValue > Number(item.current_price)
 ? 'text-profit '
 : fairValue != null && item.current_price && fairValue < Number(item.current_price)
 ? 'text-loss '
 : 'text-muted-foreground'
 )}>
 {fairValue != null ? safeNum(fairValue).toFixed(1) : '—'}
 </p>
 </div>
 <div className="bg-muted/40 rounded-lg p-1.5 text-center">
 <p className="text-xs text-muted-foreground mb-0.5">{t('stocks.mobile.opportunity')}</p>
 <p className={cn(
 'text-xs font-semibold tabular-nums',
 upside != null && upside > 5 ? 'text-profit ' :
 upside != null && upside < -5 ? 'text-loss ' :
 'text-muted-foreground'
 )}>
 {upside != null ? formatPercent(upside, 1) : '—'}
 </p>
 </div>
 </div>
 </div>
 );
 })}
 </div>

 {/* Pagination — mobile only (Task STOCKS-TABLE-FIX: desktop بيعتمد على scroll داخل UnifiedTable) */}
 {totalPages > 1 && (
 <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30 md:hidden">
 <span className="text-xs text-muted-foreground">
 {t('stocks.pagination.page', { current: safePage, total: totalPages })}
 </span>
 <div className="flex items-center gap-2">
 <Button
 variant="outline"
 size="sm"
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 disabled={safePage === 1}
 className="h-8 px-3"
 >
 <ChevronRight className="w-4 h-4" />
 </Button>
 <div className="flex gap-1">
 {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
 let pageNum: number;
 if (totalPages <= 5) {
 pageNum = i + 1;
 } else if (safePage <= 3) {
 pageNum = i + 1;
 } else if (safePage >= totalPages - 2) {
 pageNum = totalPages - 4 + i;
 } else {
 pageNum = safePage - 2 + i;
 }
 return (
 <Button
 key={pageNum}
 variant={safePage === pageNum ? 'default' : 'outline'}
 size="sm"
 onClick={() => setPage(pageNum)}
 className={cn(
 'h-8 w-8 p-0 text-xs',
 safePage === pageNum && 'bg-profit hover:bg-profit'
 )}
 >
 {pageNum}
 </Button>
 );
 })}
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
 disabled={safePage === totalPages}
 className="h-8 px-3"
 >
 <ChevronLeft className="w-4 h-4" />
 </Button>
 </div>
 </div>
 )}
 </>
 </Card>
 )}
 </React.Fragment>
 )}
 </main>
 </div>
 );
}
