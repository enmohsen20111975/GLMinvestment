'use client';

/**
 * ShariaBadge — شارة مدمجة لحالة التوافق الشرعي (Deliverable 2, Task 23-C)
 * ========================================================================
 * شارة صغيرة تُعرض بجوار رمز السهم في كل شاشات الأسهم:
 * - StockDetail (بجوار السعر)
 * - PersonaTab (بجوار رمز التوقع)
 * - MakerRadarTab (بجوار رمز الرادار)
 *
 * عند الضغط على الشارة تفتح Popover تعرض:
 * - نسبة التطهير (S&P)
 * - تفصيل المصادر الثمانية (متوافق / غير متوافق / مشمول / غير متاح)
 * - زر "حاسبة التطهير" ينقل المستخدم لشاشة التوافق الشرعي #sharia
 *
 * البيانات تُجلب من GET /api/sharia?symbol=TICKER (مع cache per-ticker).
 *
 * Reference:
 * - Constitution Rule 30 (CLIENT-FACING-STYLE): عربي فصيح رسمي.
 * - Constitution Rule 29 (NO-HYPE): لغة محايدة.
 * - Constitution Rule 62 (GIT-PUSH-DISCIPLINE).
 */

import React, { useEffect, useState, useMemo } from 'react';
import { ShieldCheck, ShieldX, ShieldAlert, Shield, Loader2, Info, Calculator } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

/* ------------------------------------------------------------------ */
/* Types — mirrors /api/sharia?symbol=X response */
/* ------------------------------------------------------------------ */

type ShariaStatus = 'compliant' | 'non_compliant' | 'doubtful' | 'not_available';

interface ShariaSourceRow {
 source_key: string;
 source_name_ar: string;
 status: ShariaStatus | null;
 percentage?: number | null;
 methodology?: string | null;
 is_active?: number | null;
}

export interface ShariaDetailResponse {
 success: boolean;
 symbol: string;
 metric?: Record<string, unknown>;
 sources?: ShariaSourceRow[];
 purification_rates?: Array<{
 method_key: string;
 method_name_ar: string;
 rate_pct: number | null;
 basis: string | null;
 is_primary: number;
 }>;
 price?: {
 ticker?: string;
 name?: string;
 current_price?: number;
 sector?: string;
 } | null;
 error?: string;
}

/* ------------------------------------------------------------------ */
/* Status helpers (shared with ShariaView) */
/* ------------------------------------------------------------------ */

const STATUS_LABELS_AR: Record<ShariaStatus, string> = {
 compliant: 'متوافق',
 non_compliant: 'غير متوافق',
 doubtful: 'مشمول',
 not_available: 'غير متاح',
};

const STATUS_EMOJI: Record<ShariaStatus, string> = {
 compliant: '🟢',
 non_compliant: '🔴',
 doubtful: '🟡',
 not_available: '⚪',
};

const STATUS_BADGE_CLASS: Record<ShariaStatus, string> = {
 compliant:
 'bg-profit text-profit/50 border-profit ',
 non_compliant:
 'bg-loss text-loss/50 border-loss ',
 doubtful:
 'bg-warning text-warning/50 border-warning ',
 not_available:
 'bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

function deriveOverallStatus(metric: Record<string, unknown> | undefined): ShariaStatus {
 if (!metric) return 'not_available';
 const consensus = Number(metric.is_halal_consensus ?? 0);
 if (consensus >= 1) return 'compliant';
 const compliantCount = Number(metric.compliant_sources_count ?? 0);
 const activeCount = Number(metric.active_sources_count ?? 0);
 if (activeCount > 0 && compliantCount === 0) return 'non_compliant';
 if (activeCount > 0 && compliantCount < 6) return 'doubtful';
 return 'not_available';
}

function formatPct(v: number | null | undefined, digits = 2): string {
 if (v == null || !Number.isFinite(v)) return '—';
 return `${v.toFixed(digits)}%`;
}

/* ------------------------------------------------------------------ */
/* Per-ticker in-memory cache (avoids refetching the same symbol) */
/* ------------------------------------------------------------------ */

type CacheEntry =
 | { state: 'loading' }
 | { state: 'ok'; data: ShariaDetailResponse }
 | { state: 'error'; error: string };

const tickerCache = new Map<string, CacheEntry>();
// Subscribers list — lets multiple badge instances share one fetch per ticker.
const tickerSubscribers = new Map<string, Set<() => void>>();

function notifySubscribers(ticker: string) {
 const subs = tickerSubscribers.get(ticker);
 if (!subs) return;
 for (const cb of subs) cb();
}

function subscribeTicker(ticker: string, cb: () => void) {
 let set = tickerSubscribers.get(ticker);
 if (!set) {
 set = new Set();
 tickerSubscribers.set(ticker, set);
 }
 set.add(cb);
 return () => {
 const s = tickerSubscribers.get(ticker);
 if (!s) return;
 s.delete(cb);
 if (s.size === 0) tickerSubscribers.delete(ticker);
 };
}

async function fetchTickerOnce(ticker: string) {
 if (tickerCache.has(ticker)) {
 const entry = tickerCache.get(ticker)!;
 if (entry.state === 'loading' || entry.state === 'ok' || entry.state === 'error') {
 return;
 }
 }
 tickerCache.set(ticker, { state: 'loading' });
 notifySubscribers(ticker);
 try {
 const res = await fetch(`/api/sharia?symbol=${encodeURIComponent(ticker)}`, { cache: 'no-store' });
 if (!res.ok) {
 const txt = await res.text().catch(() => '');
 throw new Error(`HTTP ${res.status} ${txt.slice(0, 100)}`);
 }
 const json = (await res.json()) as ShariaDetailResponse;
 if (!json.success) {
 throw new Error(json.error || 'لم يتم العثور على بيانات');
 }
 tickerCache.set(ticker, { state: 'ok', data: json });
 } catch (e) {
 tickerCache.set(ticker, { state: 'error', error: String((e as Error).message || e) });
 }
 notifySubscribers(ticker);
}

/** Public hook so ShariaStockCard can reuse the same cache. */
export function useShariaDetail(ticker: string | null | undefined) {
 const upper = ticker ? ticker.trim().toUpperCase() : '';
 const [tick, setTick] = useState(0); // force re-render on subscription notify

 useEffect(() => {
 if (!upper) return;
 if (!tickerCache.has(upper)) {
 fetchTickerOnce(upper);
 } else {
 const entry = tickerCache.get(upper)!;
 if (entry.state === 'error') {
 // Retry once on mount.
 fetchTickerOnce(upper);
 }
 }
 const unsub = subscribeTicker(upper, () => setTick((t) => t + 1));
 return unsub;
 }, [upper]);

 const entry: CacheEntry | undefined = upper ? tickerCache.get(upper) : undefined;

 // Memoise to keep stable references between renders that don't change state.
 return useMemo(
 () => ({
 ticker: upper,
 state: entry?.state ?? 'loading',
 data: entry?.state === 'ok' ? entry.data : null,
 error: entry?.state === 'error' ? entry.error : null,
 // tick is referenced to silence exhaustive-deps warnings and force re-render.
 _tick: tick,
 }),
 [entry, upper, tick],
 );
}

/** Public helper: derive a flat status object from the API response. */
export function deriveShariaSummary(data: ShariaDetailResponse | null) {
 if (!data || !data.success) {
 return {
 status: 'not_available' as ShariaStatus,
 label: 'غير متاح',
 emoji: '⚪',
 badgeClass: STATUS_BADGE_CLASS.not_available,
 purificationRatePct: null,
 compliantCount: 0,
 activeCount: 0,
 isConsensus: false,
 };
 }
 const metric = data.metric || {};
 const status = deriveOverallStatus(metric);
 const compliantCount = Number(metric.compliant_sources_count ?? 0);
 const activeCount = Number(metric.active_sources_count ?? 0);
 const isConsensus = Number(metric.is_halal_consensus ?? 0) === 1;
 const primaryRate = data.purification_rates?.find((r) => r.is_primary === 1);
 const purificationRatePct =
 primaryRate?.rate_pct ??
 (typeof metric.sp_haram_earning_pct === 'number' ? metric.sp_haram_earning_pct : null);
 return {
 status,
 label: STATUS_LABELS_AR[status],
 emoji: STATUS_EMOJI[status],
 badgeClass: STATUS_BADGE_CLASS[status],
 purificationRatePct,
 compliantCount,
 activeCount,
 isConsensus,
 };
}

/* ------------------------------------------------------------------ */
/* Badge component */
/* ------------------------------------------------------------------ */

export interface ShariaBadgeProps {
 ticker: string | null | undefined;
 /** compact = small dot + label; default = full badge */
 variant?: 'compact' | 'default';
 /** Hide the text label, show only emoji + small dot */
 showRate?: boolean;
 className?: string;
 /** If false, no click-to-open-popover behavior */
 interactive?: boolean;
}

export function ShariaBadge({
 ticker,
 variant = 'default',
 showRate = false,
 className,
 interactive = true,
}: ShariaBadgeProps) {
 const { state, data, error } = useShariaDetail(ticker);
 const summary = deriveShariaSummary(state === 'ok' ? data : null);
 const setCurrentView = useAppStore((s) => s.setCurrentView);

 const trigger = (
 <span
 role={interactive ? 'button' : undefined}
 tabIndex={interactive ? 0 : undefined}
 className={cn(
 'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium leading-none cursor-default',
 summary.badgeClass,
 interactive && 'hover:opacity-80 cursor-pointer transition-opacity',
 variant === 'compact' && 'px-1',
 className,
 )}
 title={`التوافق الشرعي: ${summary.label}`}
 >
 {state === 'loading' ? (
 <Loader2 className="w-2.5 h-2.5 animate-spin" />
 ) : (
 <span aria-hidden>{summary.emoji}</span>
 )}
 {variant !== 'compact' && (
 <span>{state === 'loading' ? '...' : summary.label}</span>
 )}
 {showRate && summary.purificationRatePct != null && state === 'ok' && (
 <span className="opacity-70" dir="ltr">
 {(summary.purificationRatePct ?? 0).toFixed(1)}%
 </span>
 )}
 </span>
 );

 if (!interactive) {
 return trigger;
 }

 return (
 <Popover>
 <PopoverTrigger asChild>
 {trigger}
 </PopoverTrigger>
 <PopoverContent
 sideOffset={4}
 align="end"
 className="w-72 p-0 border-profit "
 >
 <ShariaBadgePopoverBody
 ticker={ticker || ''}
 state={state}
 data={data}
 error={error}
 onOpenSharia={() => {
 setCurrentView('sharia');
 if (typeof window !== 'undefined') window.location.hash = 'sharia';
 }}
 />
 </PopoverContent>
 </Popover>
 );
}

/* ------------------------------------------------------------------ */
/* Popover body */
/* ------------------------------------------------------------------ */

function ShariaBadgePopoverBody({
 ticker,
 state,
 data,
 error,
 onOpenSharia,
}: {
 ticker: string;
 state: 'loading' | 'ok' | 'error' | undefined;
 data: ShariaDetailResponse | null;
 error: string | null;
 onOpenSharia: () => void;
}) {
 return (
 <div className="text-xs">
 {/* Header */}
 <div className="from-profit to-profit text-profit p-2.5 rounded-t-md">
 <div className="flex items-center gap-1.5">
 <ShieldCheck className="w-3.5 h-3.5" />
 <span className="font-bold">التوافق الشرعي — {ticker}</span>
 </div>
 </div>

 <div className="p-2.5 space-y-2">
 {state === 'loading' && (
 <div className="space-y-1.5">
 <Skeleton className="h-3 w-full" />
 <Skeleton className="h-3 w-2/3" />
 <Skeleton className="h-12 w-full" />
 </div>
 )}

 {state === 'error' && (
 <div className="text-xs text-loss flex items-center gap-1">
 <Info className="w-3 h-3 flex-shrink-0" />
 <span>تعذّر تحميل بيانات التوافق الشرعي: {error?.slice(0, 80)}</span>
 </div>
 )}

 {state === 'ok' && data && <ShariaBadgePopoverOkBody data={data} onOpenSharia={onOpenSharia} />}
 </div>
 </div>
 );
}

function ShariaBadgePopoverOkBody({
 data,
 onOpenSharia,
}: {
 data: ShariaDetailResponse;
 onOpenSharia: () => void;
}) {
 const summary = deriveShariaSummary(data);
 const metric = data.metric || {};
 const spPct =
 typeof metric.sp_haram_earning_pct === 'number' ? metric.sp_haram_earning_pct : null;
 const sources = data.sources || [];

 return (
 <>
 {/* Status line */}
 <div className="flex items-center justify-between gap-2">
 <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border', summary.badgeClass)}>
 {summary.emoji} {summary.label}
 </span>
 {summary.isConsensus && (
 <span className="text-xs px-1.5 py-0.5 rounded-full border border-warning bg-warning text-warning/40 ">
 إجماع
 </span>
 )}
 </div>

 {/* Metrics grid */}
 <div className="grid grid-cols-3 gap-1.5 text-center">
 <div className="rounded border border-warning bg-warning/10 /20 p-1">
 <div className="text-xs text-muted-foreground">نسبة S&P</div>
 <div className="text-xs font-bold text-warning tabular-nums" dir="ltr">
 {formatPct(spPct ?? summary.purificationRatePct)}
 </div>
 </div>
 <div className="rounded border border-profit bg-profit/10 /20 p-1">
 <div className="text-xs text-muted-foreground">المصادر المتوافقة</div>
 <div className="text-xs font-bold text-profit tabular-nums" dir="ltr">
 {summary.compliantCount}/{summary.activeCount || 8}
 </div>
 </div>
 <div className="rounded border border-border bg-muted/30 p-1">
 <div className="text-xs text-muted-foreground">السعر</div>
 <div className="text-xs font-bold tabular-nums" dir="ltr">
 {data.price?.current_price != null ? data.price.current_price.toFixed(2) : '—'}
 </div>
 </div>
 </div>

 {/* Sources breakdown */}
 {sources.length > 0 && (
 <>
 <Separator className="my-1" />
 <div className="space-y-0.5">
 {sources.slice(0, 8).map((s) => {
 const st = (s.status || 'not_available') as ShariaStatus;
 return (
 <div key={s.source_key} className="flex items-center justify-between gap-1.5">
 <span className="text-xs truncate">{s.source_name_ar}</span>
 <span className={cn('inline-flex items-center gap-0.5 text-xs px-1 py-0 rounded border', STATUS_BADGE_CLASS[st])}>
 {STATUS_EMOJI[st]} {STATUS_LABELS_AR[st]}
 </span>
 </div>
 );
 })}
 </div>
 </>
 )}

 <Separator className="my-1" />
 <button
 onClick={onOpenSharia}
 className="w-full text-xs flex items-center justify-center gap-1 py-1 rounded bg-profit/10 text-profit hover:bg-profit dark:hover:bg-profit/10 border border-profit transition-colors"
 >
 <Calculator className="w-3 h-3" />
 افتح شاشة التوافق الشرعي
 </button>
 </>
 );
}

export default ShariaBadge;
