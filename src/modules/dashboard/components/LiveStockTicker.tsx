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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, WifiOff, Zap } from 'lucide-react';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { useAppStore } from '@/lib/store';
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
 <span className="text-slate-300 dark:text-slate-700 select-none">
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
 className="h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800"
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
 const [gainers, setGainers] = useState<StockMover[]>([]);
 const [losers, setLosers] = useState<StockMover[]>([]);
 const [marketStatus, setMarketStatus] = useState<'OPEN' | 'CLOSED'>('CLOSED');
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [isRefreshing, setIsRefreshing] = useState(false);

 const fetchData = useCallback(async () => {
 setIsRefreshing(true);
 try {
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 12_000);
 // FIX (Oct 2026): pass currentMarket to market-pulse (was always EGX)
 const _market = useAppStore.getState().currentMarket;
 const res = await fetch(`/api/market-pulse?market=${encodeURIComponent(_market)}`, {
 signal: controller.signal,
 headers: { Accept: 'application/json' },
 cache: 'no-store',
 });
 clearTimeout(timeout);

 if (!res.ok) throw new Error(`HTTP ${res.status}`);

 const json: ApiResponse = await res.json();
 const payload: MarketPulsePayload | undefined =
 (json && (json.data as MarketPulsePayload | undefined)) ||
 (json as unknown as MarketPulsePayload);

 if (!payload || (json.success === false && !json.data)) {
 throw new Error(json.error ?? 'استجابة غير صالحة');
 }

 setGainers((payload.gainers ?? []).slice(0, MAX_GAINERS));
 setLosers((payload.losers ?? []).slice(0, MAX_LOSERS));
 setMarketStatus(payload.market_status ?? 'CLOSED');
 setError(null);
 } catch (err) {
 const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
 setError(msg);
 } finally {
 setIsRefreshing(false);
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 void fetchData();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // P37-PHASE-2B-4A: visibility-aware polling — pauses when the tab is hidden,
 // fires immediately when it becomes visible again.
 useVisibilityAwarePolling(() => { void fetchData(); }, REFRESH_INTERVAL_MS, [fetchData]);

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
 className="relative flex h-10 items-center overflow-hidden border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60"
 dir="rtl"
 >
 {/* شارة "مباشر" على اليمين (بداية RTL) */}
 <div className="z-10 flex h-full shrink-0 items-center gap-1.5 border-l border-slate-200 bg-white/90 px-3 dark:border-slate-800 dark:bg-slate-950/90">
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
 <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
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
 <div className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500">
 لا توجد بيانات أسهم متاحة
 </div>
 )}
 </div>
 </div>
 </>
 );
}

export default LiveStockTicker;
