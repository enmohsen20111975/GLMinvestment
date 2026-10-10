'use client';

/**
 * useSmartChart — Hook موحد لبيانات الشارت الذكي (Smart Dynamic Chart)
 * ====================================================================
 * بروتوكول الشارت الديناميكي الذكي — Data Surgery.
 *
 * هذا الـ Hook يوحّد منطق جلب بيانات الشارت في كل الشاشات:
 *   - تحليل الأسهم، تحليل الكريبتو، المحفظة، السكرينر
 *
 * المنطق الذكي (Timeframe-Aware Data Source):
 *   ┌─────────────┬──────────────────────────────────────────────┐
 *   │ Timeframe   │ مصدر البيانات                                │
 *   ├─────────────┼──────────────────────────────────────────────┤
 *   │ 1D (يوم)    │ intraday.db — شموع 5 دقايق                  │
 *   │ 1W (أسبوع)  │ intraday.db — شموع 30 دقيقة / ساعة           │
 *   │ 1M (شهر)    │ intraday.db — شموع ساعة، أو daily fallback   │
 *   │ 3M / 6M     │ price_history.db — يومي (yahoo_clean أولوية) │
 *   │ 1Y / 2Y     │ price_history.db — يومي                      │
 *   │ 5Y / MAX    │ price_history.db — يومي                      │
 *   └─────────────┴──────────────────────────────────────────────┘
 *
 * المميزات:
 *   - تطبيع timestamps تلقائي (ISO string / epoch / numeric → unix seconds)
 *   - فصل intraday عن daily بوضوح
 *   - refetch() لتحديث البيانات يدوياً
 *   - pollInterval لتحديث تلحظي (optional) — بيحدّث شمعة النهارده بس
 *   - متوافق مع كل الـ chart components الموجودة
 *
 * Usage:
 *   const { ohlcv, loading, error, isIntraday, source, refetch } = useSmartChart({
 *     ticker: 'COMI',
 *     timeframe: '1Y',
 *     asset: 'stock',
 *   });
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────

export type ChartTimeframe = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | 'MAX';
export type AssetType = 'stock' | 'crypto' | 'commodity';

export interface ChartCandle {
  time: string;        // YYYY-MM-DD (daily) or unix-seconds string (intraday)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SmartChartResult {
  ohlcv: ChartCandle[];
  loading: boolean;
  error: string | null;
  source: 'intraday' | 'daily' | 'daily_fallback' | 'unknown';
  isIntraday: boolean;
  stats: {
    firstPrice?: number;
    lastPrice?: number;
    maxPrice?: number;
    minPrice?: number;
    changePct?: number;
  } | null;
  refetch: () => void;
  lastUpdated: Date | null;
}

export interface UseSmartChartOptions {
  ticker: string;
  timeframe: ChartTimeframe;
  asset?: AssetType;
  limit?: number;
  enabled?: boolean;          // default true
  pollInterval?: number;      // ms — لو محدد، يعمل poll تلقائي (للتحديث اللحظي)
}

// ─── Timeframe → Data Source mapping ──────────────────────────────────────

/**
 * خرائط كل timeframe إلى:
 *  - isIntraday: هل البيانات لحظية (intraday.db) أم يومية (price_history.db)
 *  - period: الـ period parameter اللي يتبعت للـ API
 *  - days: عدد الأيام (للـ daily history endpoint)
 */
export const TIMEFRAME_CONFIG: Record<ChartTimeframe, {
  isIntraday: boolean;
  period: string;       // للـ /api/chart/[ticker] endpoint
  days: number;         // للـ /api/stocks/[ticker]/history endpoint
  description: string;
}> = {
  '1D':  { isIntraday: true,  period: '1d',  days: 1,     description: 'ليوم — شموع 5 دقايق (intraday)' },
  '1W':  { isIntraday: true,  period: '1w',  days: 7,     description: 'أسبوع — شموع 30 دقيقة/ساعة (intraday)' },
  '1M':  { isIntraday: true,  period: '1m',  days: 30,    description: 'شهر — شموع ساعة أو daily fallback' },
  '3M':  { isIntraday: false, period: '3m',  days: 90,    description: '3 شهور — يومي (yahoo_clean)' },
  '6M':  { isIntraday: false, period: '6m',  days: 180,   description: '6 شهور — يومي (yahoo_clean)' },
  '1Y':  { isIntraday: false, period: '1y',  days: 365,   description: 'سنة — يومي (yahoo_clean)' },
  '2Y':  { isIntraday: false, period: '2y',  days: 730,   description: 'سنتين — يومي (yahoo_clean)' },
  '5Y':  { isIntraday: false, period: '5y',  days: 1825,  description: '5 سنين — يومي (yahoo_clean)' },
  'MAX': { isIntraday: false, period: 'max', days: 9999,  description: 'كل التاريخ — يومي (yahoo_clean)' },
};

// ─── Timestamp normalization ──────────────────────────────────────────────

/**
 * يطبّع أي صيغة timestamp إلى unix seconds (number).
 * يدعم: ISO string, 'YYYY-MM-DD', numeric string, epoch seconds, epoch millis.
 */
function normalizeTimestamp(raw: any): number {
  if (raw === undefined || raw === null) return 0;

  // لو بالفعل number
  if (typeof raw === 'number') {
    // لو millis (أكبر من 1e12) → قسم على 1000
    return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
  }

  const s = String(raw).trim();
  if (!s) return 0;

  // لو numeric string
  const asNum = Number(s);
  if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
    return asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum);
  }

  // لو ISO string أو 'YYYY-MM-DD HH:MM:SS'
  const parsed = Date.parse(s.replace(' ', 'T'));
  return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useSmartChart(options: UseSmartChartOptions): SmartChartResult {
  const {
    ticker,
    timeframe,
    asset = 'stock',
    limit = 500,
    enabled = true,
    pollInterval,
  } = options;

  const [ohlcv, setOhlcv] = useState<ChartCandle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SmartChartResult['source']>('unknown');
  const [stats, setStats] = useState<SmartChartResult['stats']>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const cancelledRef = useRef(false);

  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG['1Y'];
  const isIntraday = config.isIntraday;

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    if (!enabled || !ticker) {
      setOhlcv([]);
      setLoading(false);
      return;
    }

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        let res: Response;
        let isIntradayFetch = isIntraday;

        if (isIntraday) {
          // ── Intraday: /api/chart/[ticker]?period=1d|1w|1m ──
          res = await fetch(
            `/api/chart/${encodeURIComponent(ticker)}?period=${config.period}&asset=${asset}&_t=${Date.now()}`,
            { cache: 'no-store' }
          );
        } else {
          // ── Daily: /api/stocks/[ticker]/history?days=N (يستخدم load_merged_history → yahoo_clean) ──
          // بيختار yahoo_clean بالأولوية (Data Surgery)
          if (asset === 'crypto') {
            res = await fetch(
              `/api/chart/${encodeURIComponent(ticker)}?period=${config.period}&asset=crypto&_t=${Date.now()}`,
              { cache: 'no-store' }
            );
          } else {
            res = await fetch(
              `/api/stocks/${encodeURIComponent(ticker)}/history?days=${config.days}&_t=${Date.now()}`,
              { cache: 'no-store' }
            );
            isIntradayFetch = false;
          }
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const json = await res.json();

        if (!json.success && !json.data) {
          throw new Error(json.error || 'فشل تحميل بيانات الشارت');
        }

        const rawData: any[] = Array.isArray(json.data) ? json.data : [];

        // تطبيع البيانات إلى ChartCandle[]
        const candles: ChartCandle[] = rawData
          .map((d: any) => {
            const rawTime = d.timestamp ?? d.date ?? d.time;
            const time = isIntradayFetch
              ? String(normalizeTimestamp(rawTime))
              : String(rawTime || '');

            const price = Number(d.price ?? d.close ?? 0);

            return {
              time,
              open: Number(d.open) || price,
              high: Number(d.high) || price,
              low: Number(d.low) || price,
              close: Number(d.close) || price,
              volume: Number(d.volume) || 0,
            };
          })
          .filter((c: ChartCandle) => c.close > 0 && c.time);

        if (cancelledRef.current) return;

        setOhlcv(candles);
        setSource(json.source || (isIntradayFetch ? 'intraday' : 'daily'));
        setStats(json.stats || null);
        setLastUpdated(new Date());
        setError(null);
      } catch (err: any) {
        if (cancelledRef.current) return;
        setError(err.message || 'خطأ غير متوقع في تحميل الشارت');
        setOhlcv([]);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    }

    fetchData();

    // optional polling للتحديث اللحظي
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    if (pollInterval && pollInterval > 0 && enabled) {
      pollTimer = setInterval(() => {
        if (!cancelledRef.current) fetchData();
      }, pollInterval);
    }

    return () => {
      cancelledRef.current = true;
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe, asset, limit, enabled, isIntraday, config.period, config.days, refreshKey, pollInterval]);

  return {
    ohlcv,
    loading,
    error,
    source,
    isIntraday,
    stats,
    refetch,
    lastUpdated,
  };
}

export default useSmartChart;
