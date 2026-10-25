'use client';

/**
 * useMarketPulseData — Strangler Pattern hook for MarketPulseWidget
 * ====================================================================
 * Extracted from MarketPulseWidget.tsx (was 912 LOC, now the data logic
 * lives here so the widget stays focused on rendering).
 *
 * Responsibilities:
 *   - Fetch /api/market-pulse via useApiQuery (TanStack Query)
 *   - Normalize the response (handle both {data} wrapper + raw payload)
 *   - Track "freshness" indicator (flash green on data update)
 *   - Track "lastUpdateStr" (relative time, updates every 1s)
 *
 * The widget just calls: const { data, loading, refreshing, error, isFresh, lastUpdateStr, refetch } = useMarketPulseData();
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { useAppStore } from '@/lib/store';

// ============================================================
// Types (mirror the API response)
// ============================================================

interface IndexData {
  price: number;
  change_percent: number;
  name?: string;
  updated_at?: string;
}

interface Breadth {
  gainers: number;
  losers: number;
  unchanged: number;
  adv_dec_ratio: number;
  total_turnover: number;
  total_turnover_bn: number;
}

export interface MarketPulseData {
  success: boolean;
  market_status: 'OPEN' | 'CLOSED' | 'POST_MARKET';
  egx30?: IndexData | null;
  egx70?: IndexData | null;
  index?: IndexData | null;
  indices?: IndexData[];
  breadth: Breadth;
  gainers?: unknown[];
  losers?: unknown[];
  latest_update?: string | null;
  [key: string]: unknown;
}

interface ApiResponse {
  success?: boolean;
  data?: MarketPulseData;
  error?: string;
}

// ============================================================
// Helpers
// ============================================================

const REFRESH_INTERVAL_MS = 10_000;

/** Normalize the API payload: handle both {data: {...}} wrapper + raw payload shapes. */
function normalizePulseData(raw: MarketPulseData | undefined | null): MarketPulseData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as MarketPulseData & Record<string, unknown>;
  // 1) Map index fields: egx30 ← index ← indices[0]
  const egx30 = (r.egx30 as IndexData) ?? r.index ?? r.indices?.[0];
  const egx70 = (r.egx70 as IndexData) ?? (r.index_70 as IndexData) ?? r.indices?.[1];
  // 2) breadth: if it's a number (fallback) → build object from advancing/declining/unchanged
  const rawBreadth = r.breadth as unknown;
  let breadth: MarketPulseData['breadth'];
  if (rawBreadth && typeof rawBreadth === 'object' && !Array.isArray(rawBreadth)) {
    breadth = rawBreadth as MarketPulseData['breadth'];
  } else {
    const advancing = (r.advancing as number) ?? 0;
    const declining = (r.declining as number) ?? 0;
    const unchanged = (r.unchanged as number) ?? 0;
    breadth = {
      gainers: advancing,
      losers: declining,
      unchanged,
      adv_dec_ratio: declining > 0 ? advancing / declining : (advancing > 0 ? Infinity : 0),
      total_turnover: 0,
      total_turnover_bn: 0,
    };
  }
  return { ...r, egx30, egx70, breadth };
}

/** Relative time in Arabic (e.g., "منذ 5 دقائق"). */
function relTime(dateString: string | null | undefined): string {
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

// ============================================================
// Hook
// ============================================================

export interface UseMarketPulseDataResult {
  data: MarketPulseData | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  isFresh: boolean;
  lastUpdateStr: string;
  refetch: () => void;
}

export function useMarketPulseData(): UseMarketPulseDataResult {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const [isFresh, setIsFresh] = useState(false);
  const [lastUpdateStr, setLastUpdateStr] = useState<string>('—');
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // F2.2 + Strangler: useApiQuery handles fetch + caching + retry + polling.
  const { data: rawJson, isLoading: loading, isFetching: refreshing, error: queryError, refetch } = useApiQuery<ApiResponse>('/api/market-pulse', {
    params: { market: currentMarket },
    queryOptions: {
      refetchInterval: REFRESH_INTERVAL_MS, // 10s polling
      refetchOnWindowFocus: false,
    },
  });

  // Derive normalized data from cached query
  const data = useMemo<MarketPulseData | null>(() => {
    if (!rawJson) return null;
    const payload = (rawJson.data as MarketPulseData | undefined) ||
      (rawJson as unknown as MarketPulseData);
    if (!payload || (rawJson.success === false && !rawJson.data)) return null;
    return normalizePulseData(payload);
  }, [rawJson]);

  const error = queryError ? (queryError instanceof Error ? queryError.message : 'خطأ غير معروف') : null;

  // Freshness indicator: flash green on data change, clear after 1.2s
  useEffect(() => {
    if (data) {
      setIsFresh(true);
      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
      freshTimerRef.current = setTimeout(() => setIsFresh(false), 1200);
    }
    return () => {
      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
    };
  }, [data]);

  // "آخر تحديث: منذ X" — update every 1s
  useEffect(() => {
    if (!data?.latest_update) {
      setLastUpdateStr('—');
      return;
    }
    setLastUpdateStr(relTime(data.latest_update));
    const id = setInterval(() => {
      setLastUpdateStr(relTime(data?.latest_update));
    }, 1000);
    return () => clearInterval(id);
  }, [data?.latest_update]);

  return { data, loading, refreshing, error, isFresh, lastUpdateStr, refetch };
}
