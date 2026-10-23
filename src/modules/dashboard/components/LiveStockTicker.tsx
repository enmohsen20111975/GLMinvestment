'use client';

/**
 * LiveStockTicker — شريط الأسهم المتحرك
 * ==================================================
 * شريط أفقي متحرك (على غرار قنوات الأخبار المالية / Bloomberg):
 * - يعرض أعلى 10 رابحين + 10 خاسرين في تمرير مستمر
 * - كل عنصر: TICKER + تغير% (أخضر/أحمر)
 * - يتمرير من اليمين إلى اليسار (مناسب لـ RTL)
 * - يتوقف مؤقتاً عند المرور بالماوس (hover)
 * - يجلب البيانات من `/api/market-pulse` كل 20 ثانية
 * - ارتفاع مدمج ~40px
 * - حالة الخطأ: عرض آخر بيانات مع شارة "انقطاع الاتصال"
 * - العناصر تبدو قابلة للنقر (ميزة مستقبلية)
 *
 * RTL كامل. ألوان emerald / rose / slate فقط (لا أزرق/إنديغو).
 */

import React, { useMemo } from 'react';
import { ArrowDown, ArrowUp, Loader2, WifiOff, Zap } from 'lucide-react';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useAppStore } from '@/lib/store';
import { useApiQuery } from '@/hooks/use-api-query';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================

interface StockMover {
 ticker: string;
 name?: string;
 name_ar?: string;
 current_price?: number;
 change_percent: number;
 volume?: number;
}

interface MarketPulsePayload {
 gainers?: StockMover[];
 losers?: StockMover[];
 latest_update?: string;
 market_status?: 'OPEN' | 'CLOSED';
}

interface ApiResponse {
 success?: boolean;
 data?: MarketPulsePayload;
 error?: string;
}

// ============================================================
// Helpers
// ============================================================

const numberFmt2 = new Intl.NumberFormat('en-US', {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
});

function fmtPct(value: number | null | undefined): string {
 if (value === null || value === undefined || Number.isNaN(value)) return '—';
 const sign = value > 0 ? '+' : '';
 return `${sign}${numberFmt2.format(value)}%`;
}

// ============================================================
// Ticker item
// ============================================================

interface TickerItemProps {
 stock: StockMover;
 /** فاصل بين العناصر (نقطة فاصلة) */
 showSeparator?: boolean;
}

function TickerItem({ stock, showSeparator = true }: TickerItemProps) {
 const up = (stock.change_percent ?? 0) >= 0;
 return (
 <>
 <button
 type="button"
 title={`${stock.ticker} — ${fmtPct(stock.change_percent)}`}
 className={cn(
 'group inline-flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs font-medium tabular-nums transition-colors',
 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-profit/50 rounded',
 up
 ? 'text-profit hover:bg-profit dark:hover:bg-profit/10'
 : 'text-loss hover:bg-loss dark:hover:bg-loss/10',
 )}
 dir="ltr"
 >
 <span className="font-bold text-slate-900 ">
 {stock.ticker}
 </span>
 <span
 className={cn(
 'inline-flex items-center gap-0.5 font-mono font-semibold',
 up
 ? 'text-profit '
 : 'text-loss ',
 )}
 >
 {up ? (
 <ArrowUp className="h-2.5 w-2.5" />
 ) : (
 <ArrowDown className="h-2.5 w-2.5" />
 )}
 {fmtPct(stock.change_percent)}
 </span>
 </button>
 {showSeparator && (
 <span className="text-muted-foreground dark:text-muted-foreground select-none">
 •
 </span>
 )}
 </>
 );
}

// ============================================================
// Loading + empty
// ============================================================

function TickerSkeleton() {
 return (
 <div className="flex items-center gap-3 px-3 py-2">
 {Array.from({ length: 12 }).map((_, i) => (
 <div
 key={i}
 className="h-3 w-20 animate-pulse rounded bg-muted"
 />
 ))}
 </div>
 );
}

// ============================================================
// Main component
// ============================================================

const REFRESH_INTERVAL_MS = 20_000;
const MAX_GAINERS = 10;
const MAX_LOSERS = 10;

export function LiveStockTicker() {
 const currentMarket = useAppStore((s) => s.currentMarket);

 // F2.2: useApiQuery replaces manual fetch + useState + useVisibilityAwarePolling.
 // 20s polling via refetchInterval. TanStack handles retry + caching.
 const { data: rawJson, isLoading: loading, isFetching: isRefreshing, error: queryError, refetch } = useApiQuery<ApiResponse>('/api/market-pulse', {
   params: { market: currentMarket },
   queryOptions: {
     refetchInterval: REFRESH_INTERVAL_MS, // 20s polling
     refetchOnWindowFocus: false,
   },
 });

 // Derive payload from response (handle both {data} wrapper + raw payload shapes)
 const payload = useMemo<MarketPulsePayload | undefined>(() => {
   if (!rawJson) return undefined;
   return (rawJson && (rawJson.data as MarketPulsePayload | undefined)) ||
     (rawJson as unknown as MarketPulsePayload);
 }, [rawJson]);

 const gainers = useMemo(() => (payload?.gainers ?? []).slice(0, MAX_GAINERS), [payload]);
 const losers = useMemo(() => (payload?.losers ?? []).slice(0, MAX_LOSERS), [payload]);
 const marketStatus = payload?.market_status ?? 'CLOSED';
 const error = queryError ? (queryError instanceof Error ? queryError.message : 'خطأ غير معروف') : null;

 // Manual refresh via refetch (replaces fetchData(true))
 useVisibilityAwarePolling(() => { void refetch(); }, REFRESH_INTERVAL_MS, [refetch]);


 // ادمج الرابحين ثم الخاسرين (الرابحون أولاً في الظهور من اليمين)
 const items = useMemo<StockMover[]>(() => {
 return [...gainers, ...losers];
 }, [gainers, losers]);

 // ضاعّف القائمة لتمرير سلس ولا نهائي
 const doubled = useMemo(() => [...items, ...items], [items]);

 const isOpen = marketStatus === 'OPEN';
 const hasData = items.length > 0;

 // مدة التمرير تتناسب مع عدد العناصر (كي لا يكون سريعاً جداً أو بطيئاً جداً)
 const scrollDuration = Math.max(28, Math.min(80, items.length * 3.2));

 return (
 <>
 {/* keyframes — تمرير من اليمين إلى اليسار */}
 <style>{`
 @keyframes lss-ticker-scroll {
 0% { transform: translateX(0); }
 100% { transform: translateX(-50%); }
 }
 .lss-ticker-track {
 animation: lss-ticker-scroll ${scrollDuration}s linear infinite;
 will-change: transform;
 }
 .lss-ticker-wrap:hover .lss-ticker-track {
 animation-play-state: paused;
 }
 @media (prefers-reduced-motion: reduce) {
 .lss-ticker-track { animation: none; }
 }
 `}</style>

 <div
 className="relative flex h-10 items-center overflow-hidden border-b border-border bg-slate-50/80/60"
 dir="rtl"
 >
 {/* شارة "مباشر" على اليمين (بداية RTL) */}
 <div className="z-10 flex h-full shrink-0 items-center gap-1.5 border-l border-border bg-white/90 px-3 dark:bg-slate-950/90">
 <span className="relative flex h-2 w-2">
 {isOpen && (
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-75" />
 )}
 <span
 className={cn(
 'relative inline-flex h-2 w-2 rounded-full',
 isOpen
 ? 'bg-profit'
 : 'bg-slate-400 dark:bg-slate-600',
 )}
 />
 </span>
 <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-profit ">
 <Zap className="h-3 w-3" />
 {isOpen ? 'مباشر' : 'مغلق'}
 </span>
 {error && (
 <WifiOff
 className="h-3 w-3 text-loss"
 title="انقطاع الاتصال — عرض آخر بيانات"
 />
 )}
 {isRefreshing && (
 <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
 )}
 </div>

 {/* تدرّج لطفي على الحواف لإخفاء القطع */}
 <div className="pointer-events-none absolute inset-y-0 right-10 z-[1] w-8 from-slate-50/80 to-transparent dark:from-slate-900/60" />
 <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-8 from-slate-50/80 to-transparent dark:from-slate-900/60" />

 {/* المسار المتحرك */}
 <div className="lss-ticker-wrap relative flex-1 overflow-hidden">
 {loading && !hasData ? (
 <TickerSkeleton />
 ) : hasData ? (
 <div className="lss-ticker-track flex w-max items-center">
 {doubled.map((s, idx) => (
 <TickerItem
 key={`${s.ticker}-${idx}`}
 stock={s}
 showSeparator
 />
 ))}
 </div>
 ) : (
 <div className="px-4 py-2 text-xs text-muted-foreground dark:text-muted-foreground">
 لا توجد بيانات أسهم متاحة
 </div>
 )}
 </div>
 </div>
 </>
 );
}

export default LiveStockTicker;
