'use client';

/**
 * LiveMonitor — لوحة المراقبة الحية لسوق EGX
 * ====================================================
 * - يجلب البيانات من /api/live-monitor كل 10 ثوانٍ
 * - يعرض حالة السوق + EGX30 + صحة النظام + المحفظة المباشرة + المتحركات
 * - زر يدوي لتحديث الأسعار فوراً (POST /api/live-monitor/trigger)
 * - ساعة القاهرة حية (تتحدّث كل ثانية)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
 Activity,
 AlertCircle,
 ArrowDownRight,
 ArrowUpRight,
 BarChart3,
 CalendarDays,
 Clock,
 Database,
 Loader2,
 Radio,
 RefreshCw,
 Server,
 TrendingDown,
 TrendingUp,
 Wallet,
 XCircle,
 Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
 Card,
 CardContent,
 CardDescription,
 CardHeader,
 CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { getEGXMarketStatus } from '@/lib/market-hours';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { useAppStore } from '@/lib/store';

// ============================================================
// Types
// ============================================================

interface StockMover {
 ticker: string;
 name: string;
 current_price: number;
 change_percent: number;
 volume: number;
 updated_at: string;
}

interface PortfolioItem {
 id: number;
 type: 'stock' | 'gold' | 'bank' | 'cash' | 'crypto' | string;
 name: string;
 stock_ticker: string | null;
 quantity: number | null;
 avg_buy_price: number | null;
 total_invested: number;
 current_value: number;
 gain_loss: number;
 gain_loss_pct: number;
 live_price: number | null;
 change_percent: number | null;
 price_updated: string | null;
 pa_updated: string | null;
}

interface LiveMonitorData {
 success: boolean;
 data: {
 cairo_time: string;
 cairo_time_iso: string;
 weekday_name: string;
 is_trading_day: boolean;
 is_trading_hours: boolean;
 market_status: 'OPEN' | 'POST_MARKET' | 'CLOSED';
 stocks: {
 total: number;
 updated_last_10min: number;
 latest_update: string;
 };
 egx30: {
 price: number;
 change_percent: number;
 name: string;
 updated_at: string;
 } | null;
 gainers: StockMover[];
 losers: StockMover[];
 portfolio: {
 items: PortfolioItem[];
 total_invested: number;
 total_current_value: number;
 total_gain_loss: number;
 total_gain_loss_pct: number;
 items_count: number;
 };
 scheduler: {
 running: boolean;
 cairo_time: string;
 market_open: boolean;
 post_market: boolean;
 is_friday: boolean;
 trading_paused: boolean;
 last_runs: Record<string, string | null>;
 engines_loaded: Record<string, boolean>;
 regime: {
 stage: number;
 stage_name: string;
 price: number;
 sma200: number;
 confidence: number;
 position_modifier: number;
 trading_allowed: boolean;
 date: string;
 } | null;
 };
 data_sources?: {
 intraday_primary: string;
 intraday_note: string;
 stock_universe: string;
 stock_universe_note: string;
 end_of_day: string;
 end_of_day_note: string;
 };
 };
}

type MarketData = LiveMonitorData['data'];

// ============================================================
// Constants & Helpers
// ============================================================

const REFRESH_INTERVAL = 10; // seconds

const ARABIC_WEEKDAYS: Record<string, string> = {
 Sunday: 'الأحد',
 Monday: 'الإثنين',
 Tuesday: 'الثلاثاء',
 Wednesday: 'الأربعاء',
 Thursday: 'الخميس',
 Friday: 'الجمعة',
 Saturday: 'السبت',
};

const numberFmt2 = new Intl.NumberFormat('en-US', {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
});
const intFmt = new Intl.NumberFormat('en-US');

function formatNumber(value: number | null | undefined, decimals = 2): string {
 if (value === null || value === undefined || Number.isNaN(value)) return '—';
 if (decimals === 0) return intFmt.format(Math.round(value));
 return numberFmt2.format(value);
}

function formatCurrency(value: number | null | undefined): string {
 if (value === null || value === undefined || Number.isNaN(value)) return '—';
 return `${formatNumber(value)} ج.م`;
}

function formatPercent(value: number | null | undefined): string {
 if (value === null || value === undefined || Number.isNaN(value)) return '—';
 const sign = value > 0 ? '+' : '';
 return `${sign}${formatNumber(value)}%`;
}

function getArabicWeekday(englishName: string): string {
 return ARABIC_WEEKDAYS[englishName] ?? englishName;
}

/** Live Cairo clock string (HH:MM:SS, 24h). Computed client-side from Intl. */
function getCairoClockString(): string {
 try {
 return new Intl.DateTimeFormat('en-GB', {
 timeZone: 'Africa/Cairo',
 hour: '2-digit',
 minute: '2-digit',
 second: '2-digit',
 hour12: false,
 }).format(new Date());
 } catch {
 return new Date().toLocaleTimeString('en-GB', { hour12: false });
 }
}

/** Cairo date in Arabic (e.g. "12 يوليو 2026"). */
function getCairoDateString(): string {
 try {
 return new Intl.DateTimeFormat('ar-EG', {
 timeZone: 'Africa/Cairo',
 day: 'numeric',
 month: 'long',
 year: 'numeric',
 }).format(new Date());
 } catch {
 return new Date().toDateString();
 }
}

/** Arabic relative-time helper: "منذ X ثانية/دقيقة/ساعة". */
function relativeTime(dateString: string | null | undefined): string {
 if (!dateString) return '—';
 const date = new Date(dateString);
 if (Number.isNaN(date.getTime())) return '—';
 const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
 if (diffSec < 0) return 'الآن';
 if (diffSec < 60) return `منذ ${diffSec} ثانية`;
 const diffMin = Math.floor(diffSec / 60);
 if (diffMin < 60) {
 if (diffMin === 1) return 'منذ دقيقة';
 if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
 return `منذ ${diffMin} دقيقة`;
 }
 const diffHr = Math.floor(diffMin / 60);
 if (diffHr < 24) {
 if (diffHr === 1) return 'منذ ساعة';
 if (diffHr <= 10) return `منذ ${diffHr} ساعات`;
 return `منذ ${diffHr} ساعة`;
 }
 const diffDay = Math.floor(diffHr / 24);
 if (diffDay === 1) return 'منذ يوم';
 if (diffDay <= 10) return `منذ ${diffDay} أيام`;
 return `منذ ${diffDay} يوم`;
}

/** Returns true if `dateString` is within `thresholdMs` of now. */
function isRecentlyUpdated(
 dateString: string | null | undefined,
 thresholdMs = 2 * 60 * 1000,
): boolean {
 if (!dateString) return false;
 const date = new Date(dateString);
 if (Number.isNaN(date.getTime())) return false;
 return Date.now() - date.getTime() < thresholdMs;
}

// ============================================================
// Sub-components
// ============================================================

interface StatusConfig {
 label: string;
 color: string;
 chipBg: string;
 icon: React.ComponentType<{ className?: string }>;
}

function getMarketStatusConfig(status: MarketData['market_status']): StatusConfig {
 switch (status) {
 case 'OPEN':
 return {
 label: 'السوق مفتوح',
 color: 'text-profit ',
 chipBg:
 'bg-profit border-profit /50 ',
 icon: Activity,
 };
 case 'POST_MARKET':
 return {
 label: 'ما بعد الجلسة',
 color: 'text-warning ',
 chipBg:
 'bg-warning border-warning /50 ',
 icon: Clock,
 };
 case 'CLOSED':
 default:
 return {
 label: 'السوق مغلق',
 color: 'text-loss ',
 chipBg:
 'bg-loss border-loss /50 ',
 icon: XCircle,
 };
 }
}

function PulsingDot({ color = 'emerald' }: { color?: 'emerald' | 'amber' | 'rose' }) {
 const palette: Record<string, string> = {
 emerald: 'bg-profit',
 amber: 'bg-warning',
 rose: 'bg-loss',
 };
 return (
 <span className="relative flex h-2.5 w-2.5">
 <span
 className={cn(
 'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
 palette[color],
 )}
 />
 <span
 className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', palette[color])}
 />
 </span>
 );
}

// ------------------------------------------------------------
// 1. Market Status Banner
// ------------------------------------------------------------

function MarketStatusBanner({
 data,
 clockStr,
 dateStr,
}: {
 data: MarketData;
 clockStr: string;
 dateStr: string;
}) {
 const statusConfig = getMarketStatusConfig(data.market_status);
 const isOpen = data.market_status === 'OPEN';
 const StatusIcon = statusConfig.icon;

 const egx = data.egx30;
 const egxUp = (egx?.change_percent ?? 0) >= 0;
 const regime = data.scheduler?.regime;

 return (
 <div
 className={cn(
 'relative overflow-hidden rounded-2xl border p-4 sm:p-6 shadow-sm',
 'border-slate-200 dark:border-slate-800',
 'bg-gradient-to-l from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950',
 )}
 >
 {/* Decorative grid pattern */}
 <div
 className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
 style={{
 backgroundImage:
 'linear-gradient(rgba(0,0,0,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.5) 1px, transparent 1px)',
 backgroundSize: '32px 32px',
 }}
 />

 <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
 {/* Right (RTL start): Live indicator + clock */}
 <div className="flex flex-col gap-2">
 <div className="flex items-center gap-2 flex-wrap">
 {isOpen && <PulsingDot color="emerald" />}
 <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
 Live Monitor
 </span>
 {(() => {
 const egxStatus = getEGXMarketStatus();
 return (
 <Badge
 variant="outline"
 className={cn(
 "gap-1 text-xs px-2 py-0.5 font-medium mr-2",
 egxStatus.isOpen
 ? "bg-profit/10 text-profit border-profit/30 "
 : "bg-warning/10 text-warning border-warning/30 "
 )}
 >
 <Clock className="w-3 h-3" />
 {egxStatus.isOpen ? '🟢 الجلسة حية' : `🔴 ${egxStatus.reason}`}
 </Badge>
 );
 })()}
 </div>

 <div className="flex items-baseline gap-2">
 <div
 className="font-mono text-3xl font-bold tabular-nums text-slate-900 sm:text-4xl"
 dir="ltr"
 >
 {clockStr}
 </div>
 <span className="text-xs text-slate-500 dark:text-slate-400">
 (القاهرة)
 </span>
 </div>

 <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
 <CalendarDays className="h-4 w-4 text-slate-400" />
 <span className="font-medium">
 {getArabicWeekday(data.weekday_name)}
 </span>
 <span className="text-slate-300 dark:text-slate-600">•</span>
 <span>{dateStr}</span>
 </div>
 </div>

 {/* Center: EGX30 index */}
 {egx && (
 <div className="flex flex-col items-center gap-1 lg:px-8 lg:border-x lg:border-slate-200 dark:lg:border-slate-800">
 <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
 <BarChart3 className="h-3.5 w-3.5" />
 {egx.name || 'EGX 30'}
 </div>
 <div className="font-mono text-3xl font-bold tabular-nums text-slate-900 sm:text-4xl">
 {formatNumber(egx.price)}
 </div>
 <div
 className={cn(
 'flex items-center gap-1 text-sm font-bold tabular-nums transition-colors',
 egxUp
 ? 'text-profit '
 : 'text-loss ',
 )}
 dir="ltr"
 >
 {egxUp ? (
 <TrendingUp className="h-4 w-4" />
 ) : (
 <TrendingDown className="h-4 w-4" />
 )}
 {formatPercent(egx.change_percent)}
 </div>
 </div>
 )}

 {/* Left (RTL end): status badge + regime */}
 <div className="flex flex-col items-start gap-2 lg:items-end">
 <div
 className={cn(
 'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold',
 statusConfig.chipBg,
 statusConfig.color,
 )}
 >
 {isOpen && <StatusIcon className="h-3.5 w-3.5 animate-pulse" />}
 {!isOpen && <StatusIcon className="h-3.5 w-3.5" />}
 {statusConfig.label}
 </div>
 {regime && (
 <div className="text-xs text-slate-500 dark:text-slate-400 lg:text-right">
 مرحلة السوق:{' '}
 <span className="font-semibold text-slate-700 dark:text-slate-200">
 {regime.stage_name}
 </span>{' '}
 <span className="text-slate-400">#{regime.stage}</span>
 </div>
 )}
 </div>
 </div>
 </div>
 );
}

// ------------------------------------------------------------
// 2. System Health Cards
// ------------------------------------------------------------

function SystemHealthCards({ data }: { data: MarketData }) {
 const { stocks, scheduler } = data;
 const intradayLast =
 (scheduler.last_runs?.intraday_prices as string | null | undefined) ?? null;
 const regime = scheduler.regime;

 const cards: Array<{
 title: string;
 icon: React.ComponentType<{ className?: string }>;
 accentClass: string;
 main: React.ReactNode;
 subtitle: React.ReactNode;
 }> = [
 {
 title: 'الأسعار المحدثة',
 icon: Zap,
 accentClass: 'text-profit ',
 main: (
 <div className="flex items-baseline gap-1.5">
 <span className="text-2xl font-bold tabular-nums text-slate-900 ">
 {stocks.updated_last_10min}
 </span>
 <span className="text-sm text-slate-400">/ {stocks.total}</span>
 </div>
 ),
 subtitle: `آخر تحديث: ${relativeTime(stocks.latest_update)}`,
 },
 {
 title: 'حالة المجدول',
 icon: Server,
 accentClass: scheduler.market_open
 ? 'text-profit '
 : 'text-slate-500 dark:text-slate-400',
 main: (
 <div className="flex items-center gap-2">
 <span
 className={cn(
 'text-2xl font-bold transition-colors',
 scheduler.market_open
 ? 'text-profit '
 : 'text-slate-500 dark:text-slate-400',
 )}
 >
 {scheduler.market_open ? 'يعمل ✓' : 'متوقف'}
 </span>
 {scheduler.running && scheduler.market_open && <PulsingDot color="emerald" />}
 </div>
 ),
 subtitle: `scheduler.running: ${scheduler.running ? 'true' : 'false'}`,
 },
 {
 title: 'آخر تحديث للأسعار',
 icon: Clock,
 accentClass: 'text-warning ',
 main: (
 <span className="text-2xl font-bold tabular-nums text-slate-900 ">
 {relativeTime(intradayLast)}
 </span>
 ),
 subtitle: intradayLast
 ? new Date(intradayLast).toLocaleString('ar-EG', {
 hour: '2-digit',
 minute: '2-digit',
 day: 'numeric',
 month: 'numeric',
 })
 : 'بانتظار البيانات',
 },
 {
 title: 'مرحلة السوق',
 icon: Activity,
 accentClass: regime?.trading_allowed
 ? 'text-profit '
 : 'text-loss ',
 main: (
 <div className="flex items-baseline gap-1.5">
 <span className="text-2xl font-bold text-slate-900 ">
 {regime?.stage_name ?? '—'}
 </span>
 {regime && (
 <span className="text-xs text-slate-400">#{regime.stage}</span>
 )}
 </div>
 ),
 subtitle: regime ? `الثقة: ${formatNumber(regime.confidence)}%` : 'غير متاح',
 },
 ];

 return (
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
 {cards.map((card, i) => {
 const Icon = card.icon;
 return (
 <Card
 key={i}
 className="relative overflow-hidden border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
 >
 <CardContent className="p-4">
 <div className="mb-3 flex items-center justify-between">
 <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
 {card.title}
 </span>
 <Icon className={cn('h-4 w-4', card.accentClass)} />
 </div>
 <div className="mb-1">{card.main}</div>
 <p className="truncate text-xs text-slate-500 dark:text-slate-500">
 {card.subtitle}
 </p>
 </CardContent>
 </Card>
 );
 })}
 </div>
 );
}

// ------------------------------------------------------------
// 3. Portfolio Live Monitor
// ------------------------------------------------------------

const TYPE_BADGE: Record<
 string,
 { label: string; cls: string }
> = {
 stock: {
 label: 'سهم',
 cls: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900',
 },
 gold: {
 label: 'ذهب',
 cls: 'bg-warning text-warning border-warning /50 ',
 },
 bank: {
 label: 'بنك',
 cls: 'bg-profit text-profit border-profit /50 ',
 },
 cash: {
 label: 'نقد',
 cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700',
 },
 crypto: {
 label: 'كريبتو',
 cls: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900',
 },
};

function TypeBadge({ type }: { type: string }) {
 const cfg = TYPE_BADGE[type] ?? {
 label: type,
 cls: TYPE_BADGE.cash.cls,
 };
 return (
 <span
 className={cn(
 'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium',
 cfg.cls,
 )}
 >
 {cfg.label}
 </span>
 );
}

function PortfolioMonitor({ data }: { data: MarketData }) {
 const { portfolio } = data;
 const isPositive = portfolio.total_gain_loss >= 0;
 const totalColor = isPositive
 ? 'text-profit '
 : 'text-loss ';
 const totalBorder = isPositive
 ? 'border-profit bg-profit /30'
 : 'border-loss bg-loss /30';

 // ── UnifiedTable columns for portfolio items ──
 const portfolioColumns: Column<PortfolioItem>[] = [
 {
 key: 'type',
 header: 'النوع',
 align: 'right',
 render: (item) => <TypeBadge type={item.type} />,
 },
 {
 key: 'name',
 header: 'الاسم/الرمز',
 align: 'right',
 sortable: true,
 render: (item) => (
 <div className="flex flex-col">
 <span className="text-sm font-medium text-slate-900 ">
 {item.name}
 </span>
 {item.stock_ticker && (
 <span className="font-mono text-xs text-slate-500">
 {item.stock_ticker}
 </span>
 )}
 </div>
 ),
 },
 {
 key: 'quantity',
 header: 'الكمية',
 align: 'center',
 sortable: true,
 render: (item) => (
 <span className="text-center text-xs tabular-nums inline-block w-full">
 {item.quantity != null ? intFmt.format(item.quantity) : '—'}
 </span>
 ),
 },
 {
 key: 'avg_buy_price',
 header: 'سعر الشراء',
 align: 'center',
 sortable: true,
 render: (item) => (
 <span className="text-center text-xs tabular-nums inline-block w-full" dir="ltr">
 {item.avg_buy_price != null ? formatNumber(item.avg_buy_price) : '—'}
 </span>
 ),
 },
 {
 key: 'live_price',
 header: 'السعر الحي',
 align: 'center',
 sortable: true,
 render: (item) => {
 const recent = isRecentlyUpdated(item.price_updated);
 return (
 <span className="text-center text-xs tabular-nums inline-block w-full" dir="ltr">
 {item.live_price != null ? (
 <span
 className={cn(
 'font-medium transition-colors',
 recent && 'text-profit ',
 )}
 >
 {formatNumber(item.live_price)}
 {recent && (
 <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-profit align-middle" />
 )}
 </span>
 ) : (
 '—'
 )}
 </span>
 );
 },
 },
 {
 key: 'current_value',
 header: 'القيمة الحالية',
 align: 'center',
 sortable: true,
 render: (item) => (
 <span className="text-center text-xs tabular-nums inline-block w-full" dir="ltr">
 {formatNumber(item.current_value)}
 </span>
 ),
 },
 {
 key: 'gain_loss',
 header: 'الربح/الخسارة',
 align: 'center',
 sortable: true,
 render: (item) => {
 const positive = item.gain_loss >= 0;
 const gainColor = positive
 ? 'text-profit '
 : 'text-loss ';
 return (
 <span
 className={cn(
 'text-center text-xs font-semibold tabular-nums inline-block w-full',
 gainColor,
 )}
 dir="ltr"
 >
 {positive ? '+' : ''}
 {formatNumber(item.gain_loss)}
 </span>
 );
 },
 },
 {
 key: 'gain_loss_pct',
 header: '%',
 align: 'center',
 sortable: true,
 render: (item) => {
 const positive = item.gain_loss >= 0;
 const gainColor = positive
 ? 'text-profit '
 : 'text-loss ';
 return (
 <span
 className={cn(
 'text-center text-xs font-semibold tabular-nums inline-block w-full',
 gainColor,
 )}
 dir="ltr"
 >
 {formatPercent(item.gain_loss_pct)}
 </span>
 );
 },
 },
 ];

 return (
 <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-profit /50">
 <Wallet className="h-4 w-4 text-profit " />
 </div>
 <div>
 <CardTitle className="text-base">مراقبة المحفظة المباشرة</CardTitle>
 <CardDescription className="text-xs">
 {portfolio.items_count} عنصر
 </CardDescription>
 </div>
 </div>
 <Badge
 variant="outline"
 className="gap-1 border-profit text-xs text-profit "
 >
 <Radio className="h-3 w-3 animate-pulse text-profit" />
 مباشر
 </Badge>
 </div>
 </CardHeader>
 <CardContent>
 {/* Summary row */}
 <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
 <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
 <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
 إجمالي المستثمر
 </p>
 <p className="text-lg font-bold tabular-nums text-slate-900 ">
 {formatCurrency(portfolio.total_invested)}
 </p>
 </div>
 <div
 className={cn(
 'rounded-lg border p-3 transition-colors',
 totalBorder,
 )}
 >
 <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
 القيمة الحالية
 </p>
 <p className={cn('text-lg font-bold tabular-nums', totalColor)}>
 {formatCurrency(portfolio.total_current_value)}
 </p>
 </div>
 <div
 className={cn(
 'rounded-lg border p-3 transition-colors',
 totalBorder,
 )}
 >
 <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
 الربح/الخسارة
 </p>
 <div className="flex items-baseline gap-2">
 <p className={cn('text-lg font-bold tabular-nums', totalColor)}>
 {isPositive ? '+' : ''}
 {formatNumber(portfolio.total_gain_loss)}
 </p>
 <span className={cn('text-xs font-semibold', totalColor)}>
 ({formatPercent(portfolio.total_gain_loss_pct)})
 </span>
 </div>
 </div>
 </div>

 {/* Items table — UnifiedTable (Rule 52) */}
 <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
 <UnifiedTable<PortfolioItem>
 columns={portfolioColumns}
 data={portfolio.items}
 keyField="id"
 dense
 emptyTextAr="المحفظة فارغة — أضف أسهماً لمتابعة أدائها مباشرةً"
 rowClassName={(item) => {
 const recent = isRecentlyUpdated(item.price_updated);
 return recent
 ? 'bg-profit/40 /20 border-s-2 border-s-emerald-500'
 : undefined;
 }}
 />
 </div>
 </CardContent>
 </Card>
 );
}

// ------------------------------------------------------------
// 4. Market Movers
// ------------------------------------------------------------

function MoverRow({
 stock,
 index,
 type,
}: {
 stock: StockMover;
 index: number;
 type: 'gainer' | 'loser';
}) {
 const isGainer = type === 'gainer';
 const up = stock.change_percent >= 0;
 const accentColor = isGainer
 ? 'text-profit '
 : 'text-loss ';
 const numBg = isGainer
 ? 'bg-profit text-profit /50 '
 : 'bg-loss text-loss /50 ';

 return (
 <div className="-mx-2 flex items-center justify-between rounded px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
 <div className="flex min-w-0 items-center gap-2">
 <span
 className={cn(
 'flex h-6 w-6 items-center justify-center rounded text-xs font-bold',
 numBg,
 )}
 >
 {index + 1}
 </span>
 <div className="min-w-0">
 <div className="font-mono text-xs font-bold text-slate-900 ">
 {stock.ticker}
 </div>
 <div className="max-w-[140px] truncate text-xs text-slate-500">
 {stock.name}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-3" dir="ltr">
 <span className="text-xs font-semibold tabular-nums text-slate-900 ">
 {formatNumber(stock.current_price)}
 </span>
 <span
 className={cn(
 'inline-flex w-16 items-center justify-end gap-0.5 text-xs font-bold tabular-nums',
 accentColor,
 )}
 >
 {up ? (
 <ArrowUpRight className="h-3 w-3" />
 ) : (
 <ArrowDownRight className="h-3 w-3" />
 )}
 {formatPercent(stock.change_percent)}
 </span>
 </div>
 </div>
 );
}

function MoversCard({
 title,
 type,
 stocks,
}: {
 title: string;
 type: 'gainer' | 'loser';
 stocks: StockMover[];
}) {
 const isGainer = type === 'gainer';
 return (
 <Card
 className={cn(
 'overflow-hidden border shadow-sm',
 isGainer
 ? 'border-profit /50'
 : 'border-loss /50',
 )}
 >
 <CardHeader className="pb-2">
 <div className="flex items-center gap-2">
 <div
 className={cn(
 'flex h-7 w-7 items-center justify-center rounded-lg',
 isGainer
 ? 'bg-profit /50'
 : 'bg-loss /50',
 )}
 >
 {isGainer ? (
 <TrendingUp className="h-3.5 w-3.5 text-profit " />
 ) : (
 <TrendingDown className="h-3.5 w-3.5 text-loss " />
 )}
 </div>
 <CardTitle
 className={cn(
 'text-sm',
 isGainer
 ? 'text-profit '
 : 'text-loss ',
 )}
 >
 {title}
 </CardTitle>
 </div>
 </CardHeader>
 <CardContent className="pt-0">
 {stocks.length === 0 ? (
 <div className="py-8 text-center text-sm text-muted-foreground">
 بانتظار بيانات السوق المباشر
 <span className="block text-xs mt-1">تظهر تلقائياً عند بدء التداول</span>
 </div>
 ) : (
 <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
 {stocks.slice(0, 8).map((stock, i) => (
 <MoverRow
 key={`${stock.ticker}-${i}`}
 stock={stock}
 index={i}
 type={type}
 />
 ))}
 </div>
 )}
 </CardContent>
 </Card>
 );
}

function MarketMovers({ data }: { data: MarketData }) {
 return (
 <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
 <MoversCard title="أعلى الرابحين" type="gainer" stocks={data.gainers} />
 <MoversCard title="أعلى الخاسرين" type="loser" stocks={data.losers} />
 </div>
 );
}

// ------------------------------------------------------------
// Loading & Error states
// ------------------------------------------------------------

function LiveMonitorSkeleton() {
 return (
 <div className="space-y-4">
 <Skeleton className="h-32 w-full rounded-2xl" />
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
 {Array.from({ length: 4 }).map((_, i) => (
 <Skeleton key={i} className="h-24 rounded-xl" />
 ))}
 </div>
 <Skeleton className="h-96 rounded-xl" />
 <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
 <Skeleton className="h-80 rounded-xl" />
 <Skeleton className="h-80 rounded-xl" />
 </div>
 </div>
 );
}

function ErrorState({
 error,
 onRetry,
}: {
 error: string;
 onRetry: () => void;
}) {
 return (
 <Card className="border-loss bg-loss/50 /50 /20">
 <CardContent className="flex flex-col items-center justify-center py-12 text-center">
 <AlertCircle className="mb-3 h-10 w-10 text-loss" />
 <p className="mb-1 text-sm font-semibold text-loss ">
 تعذّر تحميل بيانات المراقبة
 </p>
 <p className="mb-4 max-w-md text-xs text-loss/70 /70">
 {error}
 </p>
 <Button
 variant="outline"
 size="sm"
 onClick={onRetry}
 className="gap-2 border-loss text-loss hover:bg-loss dark:hover:bg-loss/40"
 >
 <RefreshCw className="h-3.5 w-3.5" />
 إعادة المحاولة
 </Button>
 </CardContent>
 </Card>
 );
}

// ============================================================
// Main component
// ============================================================

export function LiveMonitor() {
 const [data, setData] = useState<MarketData | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [triggering, setTriggering] = useState(false);
 const [secondsUntilRefresh, setSecondsUntilRefresh] =
 useState<number>(REFRESH_INTERVAL);
 const [clockStr, setClockStr] = useState<string>(() => getCairoClockString());
 const [dateStr, setDateStr] = useState<string>(() => getCairoDateString());

 const refreshingRef = useRef(false);
 // P37-PHASE-2B-4A: countdown persists across ticks via a ref so the
 // visibility-aware polling callback (recreated each render) doesn't reset it.
 const countdownRef = useRef(REFRESH_INTERVAL);

 const fetchData = useCallback(async (isInitial = false) => {
 // Prevent overlapping background refreshes (initial load always proceeds)
 if (!isInitial && refreshingRef.current) return;
 refreshingRef.current = true;
 if (isInitial) setLoading(true);
 else setRefreshing(true);

 try {
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 15_000);
 const _market = useAppStore.getState().currentMarket;
 const res = await fetch(`/api/live-monitor?market=${encodeURIComponent(_market)}`, {
 signal: controller.signal,
 cache: 'no-store',
 });
 clearTimeout(timeout);

 const json = (await res.json()) as Partial<LiveMonitorData> & {
 error?: string;
 };

 if (!res.ok) {
 throw new Error(json.error ?? `HTTP ${res.status}`);
 }
 if (!json.success || !json.data) {
 throw new Error(json.error ?? 'استجابة غير صالحة من الخادم');
 }
 setData(json.data);
 setError(null);
 } catch (err) {
 const msg = err instanceof Error ? err.message : 'Unknown error';
 setError(msg);
 if (isInitial) {
 toast.error('فشل تحميل بيانات المراقبة');
 }
 } finally {
 if (isInitial) setLoading(false);
 else setRefreshing(false);
 refreshingRef.current = false;
 setSecondsUntilRefresh(REFRESH_INTERVAL);
 }
 }, []);

 // Initial fetch on mount
 useEffect(() => {
 fetchData(true);
 }, [fetchData]);

 // 1-second ticker: live clock + countdown to next refresh
 // P37-PHASE-2B-4A: visibility-aware polling — the entire 1-second ticker
 // (clock + date + countdown + data refresh trigger) stops when the tab is
 // hidden, and fires immediately when the tab becomes visible again. The
 // countdown is kept in a ref so it survives the callback recreation that
 // happens on each render.
 useVisibilityAwarePolling(() => {
 setClockStr(getCairoClockString());
 // Refresh date string once per minute (cheap check)
 const newDate = getCairoDateString();
 setDateStr((prev) => (prev !== newDate ? newDate : prev));

 countdownRef.current -= 1;
 setSecondsUntilRefresh(countdownRef.current);
 if (countdownRef.current <= 0) {
 countdownRef.current = REFRESH_INTERVAL;
 // Fire-and-forget background refresh
 void fetchData(false);
 }
 }, 1000, [fetchData]);

 // Manual trigger handler
 const handleTrigger = useCallback(async () => {
 if (triggering) return;
 setTriggering(true);
 const toastId = toast.loading('جاري تحديث الأسعار...');
 try {
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 60_000);
 const _trigMarket = useAppStore.getState().currentMarket;
 const res = await fetch(`/api/live-monitor/trigger?market=${encodeURIComponent(_trigMarket)}`, {
 method: 'POST',
 signal: controller.signal,
 });
 clearTimeout(timeout);
 const json = (await res.json().catch(() => ({}))) as {
 success?: boolean;
 error?: string;
 message?: string;
 };

 if (!res.ok) {
 throw new Error(json.error ?? `HTTP ${res.status}`);
 }
 if (json.success === false) {
 throw new Error(json.error ?? 'فشل التحديث');
 }

 toast.success('تم تحديث الأسعار بنجاح', { id: toastId });
 // Immediately refetch fresh data
 void fetchData(false);
 } catch (err) {
 const msg = err instanceof Error ? err.message : 'Unknown error';
 toast.error(`فشل التحديث: ${msg}`, { id: toastId });
 } finally {
 setTriggering(false);
 }
 }, [triggering, fetchData]);

 // ---- Render ----

 if (loading) {
 return (
 <div dir="rtl" className="space-y-4">
 <LiveMonitorSkeleton />
 </div>
 );
 }

 if (error && !data) {
 return (
 <div dir="rtl" className="space-y-4">
 <ErrorState error={error} onRetry={() => fetchData(true)} />
 </div>
 );
 }

 if (!data) return null;

 return (
 <div dir="rtl" className="space-y-4">
 {/* Top bar: title + manual trigger */}
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div className="flex items-center gap-2">
 <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 dark:bg-slate-100">
 <Activity className="h-5 w-5 text-profit " />
 <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-75" />
 <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-profit" />
 </span>
 </div>
 <div>
 <h2 className="text-lg font-bold text-slate-900 ">
 لوحة المراقبة الحية
 </h2>
 <p className="text-xs text-slate-500 dark:text-slate-400">
 {refreshing
 ? 'جاري التحديث...'
 : `التحديث التالي خلال ${secondsUntilRefresh} ثانية`}
 </p>
 </div>
 </div>

 <div className="flex items-center gap-2">
 {error && (
 <Badge
 variant="outline"
 className="gap-1 border-loss text-loss "
 >
 <AlertCircle className="h-3 w-3" />
 خطأ في آخر تحديث
 </Badge>
 )}
 <Button
 onClick={handleTrigger}
 disabled={triggering}
 className="gap-2 bg-profit text-white hover:bg-profit dark:hover:bg-profit"
 >
 {triggering ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <RefreshCw className="h-4 w-4" />
 )}
 تحديث الأسعار الآن
 </Button>
 </div>
 </div>

 {/* 1. Market status banner */}
 <MarketStatusBanner data={data} clockStr={clockStr} dateStr={dateStr} />

 {/* 2. System health cards */}
 <SystemHealthCards data={data} />

 {/* 2.5. Data sources info */}
 {data.data_sources && <DataSourcesCard sources={data.data_sources} />}

 {/* 3. Portfolio live monitor */}
 <PortfolioMonitor data={data} />

 {/* 4. Market movers */}
 <MarketMovers data={data} />

 {/* Footer */}
 <div className="flex items-center justify-center gap-2 pt-2 text-xs text-slate-400 dark:text-slate-600">
 <Clock className="h-3 w-3" />
 <span>
 التحديث التلقائي كل {REFRESH_INTERVAL} ثوانٍ
 Backend (port 8010)
 </span>
 </div>
 </div>
 );
}

function DataSourcesCard({ sources }: { sources: NonNullable<MarketData['data_sources']> }) {
 const sourceItems = [
 {
 label: 'الأسعار اللحظية',
 value: sources.intraday_primary,
 note: sources.intraday_note,
 icon: Zap,
 color: 'text-profit ',
 badge: 'أساسي',
 badgeCls: 'bg-profit text-profit /50 ',
 },
 {
 label: 'قائمة الأسهم الكاملة',
 value: sources.stock_universe,
 note: sources.stock_universe_note,
 icon: Database,
 color: 'text-warning ',
 badge: 'كل 15 دقيقة',
 badgeCls: 'bg-warning text-warning /50 ',
 },
 {
 label: 'بيانات نهاية اليوم',
 value: sources.end_of_day,
 note: sources.end_of_day_note,
 icon: Clock,
 color: 'text-slate-500 dark:text-slate-400',
 badge: 'يومي',
 badgeCls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
 },
 ];

 return (
 <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
 <CardContent className="p-4">
 <div className="mb-3 flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Database className="h-4 w-4 text-slate-600 dark:text-slate-400" />
 <h3 className="text-sm font-semibold text-slate-900 ">
 مصادر البيانات
 </h3>
 </div>
 <span className="text-xs text-slate-500 dark:text-slate-500">
 نظام متعدد المصادر
 </span>
 </div>
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
 {sourceItems.map((item, i) => {
 const Icon = item.icon;
 return (
 <div
 key={i}
 className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
 >
 <div className="mb-1.5 flex items-center justify-between">
 <Icon className={cn('h-3.5 w-3.5', item.color)} />
 <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', item.badgeCls)}>
 {item.badge}
 </span>
 </div>
 <div className="mb-1 text-sm font-bold text-slate-900 ">
 {item.value}
 </div>
 <div className="text-xs leading-snug text-slate-500 dark:text-slate-400">
 {item.label}
 </div>
 <p className="mt-1 text-xs leading-snug text-slate-400 dark:text-slate-500">
 {item.note}
 </p>
 </div>
 );
 })}
 </div>
 </CardContent>
 </Card>
 );
}

export default LiveMonitor;
