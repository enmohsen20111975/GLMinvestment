'use client';

/**
 * useLiveMonitorData — Strangler Pattern hook for LiveMonitor
 * ====================================================================
 * Extracted from LiveMonitor.tsx (was 1468 LOC, now the data logic
 * lives here so the widget stays focused on rendering).
 *
 * Responsibilities:
 *   - Fetch /api/live-monitor via useApiQuery (TanStack Query, 10s polling)
 *   - 1-second countdown ticker (live clock + refresh countdown)
 *   - Manual trigger handler (POST /api/live-monitor/trigger)
 *
 * The widget just calls: const { data, loading, refreshing, error, secondsUntilRefresh, clockStr, dateStr, triggering, handleTrigger, refetch } = useLiveMonitorData();
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

// ============================================================
// Types (mirror the API response)
// ============================================================

interface StockMover {
 ticker: string;
 name?: string;
 name_ar?: string;
 current_price?: number;
 change_percent: number;
 volume?: number;
 updated_at?: string;
}

interface MarketData {
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
 items: unknown[];
 total_invested: number;
 total_current_value: number;
 total_gain_loss: number;
 total_gain_loss_pct: number;
 items_count: number;
 [key: string]: unknown;
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
}

interface LiveMonitorData {
 success: boolean;
 data: MarketData;
 error?: string;
}

// ============================================================
// Helpers (Cairo time — UTC+2 or UTC+3 during DST)
// ============================================================

const REFRESH_INTERVAL = 10; // seconds

function getCairoClockString(): string {
 try {
 return new Intl.DateTimeFormat('ar-EG', {
 timeZone: 'Africa/Cairo',
 hour: '2-digit',
 minute: '2-digit',
 second: '2-digit',
 hour12: false,
 }).format(new Date());
 } catch {
 return new Date().toLocaleTimeString('ar-EG');
 }
}

function getCairoDateString(): string {
 try {
 return new Intl.DateTimeFormat('ar-EG', {
 timeZone: 'Africa/Cairo',
 weekday: 'long',
 day: 'numeric',
 month: 'long',
 }).format(new Date());
 } catch {
 return new Date().toLocaleDateString('ar-EG');
 }
}

// ============================================================
// Hook
// ============================================================

export interface UseLiveMonitorDataResult {
 data: MarketData | null;
 loading: boolean;
 refreshing: boolean;
 error: string | null;
 secondsUntilRefresh: number;
 clockStr: string;
 dateStr: string;
 triggering: boolean;
 handleTrigger: () => Promise<void>;
 refetch: () => void;
}

export function useLiveMonitorData(): UseLiveMonitorDataResult {
 const [triggering, setTriggering] = useState(false);
 const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number>(REFRESH_INTERVAL);
 const [clockStr, setClockStr] = useState<string>(() => getCairoClockString());
 const [dateStr, setDateStr] = useState<string>(() => getCairoDateString());
 const countdownRef = useRef(REFRESH_INTERVAL);

 // F2.2 + Strangler: useApiQuery handles fetch + caching + retry + polling.
 const _market = useAppStore.getState().currentMarket;
 const { data, isLoading: loading, isFetching: refreshing, error: queryError, refetch } = useApiQuery<MarketData>('/api/live-monitor', {
   params: { market: _market },
   queryOptions: {
     refetchInterval: REFRESH_INTERVAL * 1000, // 10s polling
     refetchOnWindowFocus: false,
   },
 });

 const error = queryError ? (queryError instanceof Error ? queryError.message : 'Unknown error') : null;

 // 1-second ticker: live clock + countdown to next refresh
 useEffect(() => {
   const id = setInterval(() => {
     setClockStr(getCairoClockString());
     const newDate = getCairoDateString();
     setDateStr((prev) => (prev !== newDate ? newDate : prev));

     countdownRef.current -= 1;
     setSecondsUntilRefresh(countdownRef.current);
     if (countdownRef.current <= 0) {
       countdownRef.current = REFRESH_INTERVAL;
       void refetch();
     }
   }, 1000);
   return () => clearInterval(id);
 }, [refetch]);

 // Show error toast on initial load failure
 useEffect(() => {
   if (queryError && loading) {
     toast.error('فشل تحميل بيانات المراقبة');
   }
 }, [queryError, loading]);

 // Manual trigger handler — POST /api/live-monitor/trigger
 const handleTrigger = useCallback(async () => {
   if (triggering) return;
   setTriggering(true);
   const toastId = toast.loading('جاري تحديث الأسعار...');
   try {
     const _trigMarket = useAppStore.getState().currentMarket;
     const res = await fetch(`/api/live-monitor/trigger?market=${encodeURIComponent(_trigMarket)}`, {
       method: 'POST',
       signal: AbortSignal.timeout(15_000),
     });
     if (!res.ok) throw new Error(`HTTP ${res.status}`);
     toast.success('تم تحديث الأسعار بنجاح', { id: toastId });
     // Immediately refetch fresh data
     void refetch();
   } catch (err) {
     const msg = err instanceof Error ? err.message : 'Unknown error';
     toast.error(`فشل التحديث: ${msg}`, { id: toastId });
   } finally {
     setTriggering(false);
   }
 }, [triggering, refetch]);

 return {
   data: (data as any) ?? null,
   loading,
   refreshing,
   error,
   secondsUntilRefresh,
   clockStr,
   dateStr,
   triggering,
   handleTrigger,
   refetch,
 };
}
