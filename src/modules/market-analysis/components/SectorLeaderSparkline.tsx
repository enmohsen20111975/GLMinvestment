'use client';

/**
 * SectorLeaderSparkline — A2 (Alpha, Task 3-a)
 * =================================================
 * Tiny 30-day sparkline for a sector's leader stock.
 *
 * DATA SOURCE: /api/stocks/sparkline?ticker=X&days=30
 *   - Pulls REAL historical close prices from (in order):
 *       1. price_history.db.price_history  (canonical)
 *       2. stocks.db.stock_daily_prices
 *       3. stocks.db.index_daily_prices    (for index symbols)
 *   - If no real history exists, the endpoint returns `source: 'none'` with
 *     `prices: []` — we render "—" and DO NOT fabricate (Rule 27 NO-FAKE-DATA).
 *     (The endpoint already had a fabrication block removed — see
 *      ALPHA-FAB-FIX-SPARKLINE-001 in its route.ts.)
 *
 * This component is intentionally minimal: it shows the leading stock's 30-day
 * price path (NOT sector flow) so the user can sanity-check whether the leader
 * is breaking out or pulling back. It does NOT imply anything about sector flow.
 */

import React, { useEffect, useRef, useState } from 'react';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

interface SectorLeaderSparklineProps {
  ticker: string;
  days?: number;
  /** color override — defaults to whale (teal). Use 'profit'/'loss' to reflect trend. */
  colorMode?: 'auto' | 'whale';
  className?: string;
}

interface SparklineResponse {
  success: boolean;
  ticker: string;
  prices: number[];
  min: number;
  max: number;
  first: number;
  last: number;
  change_pct: number;
  days: number;
  source: string;
  error?: string;
}

type Status = 'idle' | 'loading' | 'ok' | 'empty' | 'error';

// Per-ticker in-memory cache (component-local — survives re-renders of the same sector row)
const sparkCache = new Map<string, { ts: number; data: SparklineResponse | null }>();
const CACHE_TTL_MS = 60_000;

export function SectorLeaderSparkline({
  ticker,
  days = 30,
  colorMode = 'auto',
  className,
}: SectorLeaderSparklineProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<SparklineResponse | null>(null);
  const tickerRef = useRef(ticker);
  tickerRef.current = ticker;

  useEffect(() => {
    if (!ticker) return;
    const cached = sparkCache.get(ticker);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.data) {
      setData(cached.data);
      setStatus(cached.data.source === 'none' || cached.data.prices.length === 0 ? 'empty' : 'ok');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const url = `/api/stocks/sparkline?ticker=${encodeURIComponent(ticker)}&days=${days}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setStatus('error');
          return;
        }
        const json: SparklineResponse = await res.json();
        if (cancelled) return;
        const hasPrices = Array.isArray(json.prices) && json.prices.length > 1;
        sparkCache.set(ticker, { ts: Date.now(), data: json });
        setData(json);
        setStatus(hasPrices ? 'ok' : 'empty');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ticker, days]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div
        className={cn('h-8 w-[88px] rounded bg-muted/30 animate-pulse', className)}
        aria-label={`جاري تحميل مخطط ${ticker}`}
      />
    );
  }

  if (status === 'error' || status === 'empty' || !data || data.prices.length < 2) {
    // Honest: no fabricated sparkline. Show "—" with tooltip explaining.
    return (
      <span
        className={cn('inline-block h-8 w-[88px] text-xs text-muted-foreground leading-8 text-center', className)}
        title={
          status === 'error'
            ? 'تعذّر تحميل البيانات التاريخية'
            : 'لا توجد بيانات تاريخية حقيقية لهذا السهم'
        }
      >
        —
      </span>
    );
  }

  // status === 'ok' — render real sparkline
  const chartData = data.prices.map((p, i) => ({ i, p }));
  const trend = data.change_pct ?? 0;
  const color =
    colorMode === 'whale'
      ? 'hsl(189 95% 43%)'
      : trend >= 0
      ? 'hsl(160 84% 39%)'
      : 'hsl(0 84% 60%)';

  return (
    <div
      className={cn('h-8 w-[88px] relative', className)}
      data-testid={`leader-sparkline-${ticker}`}
      data-source={data.source}
      data-days={data.days}
      data-change-pct={trend.toFixed(2)}
      title={`${ticker} — آخر ${data.days} يوم • ${trend >= 0 ? '+' : ''}${trend.toFixed(1)}% (مصدر: ${data.source})`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis domain={['dataMin', 'dataMax']} hide />
          <Line
            type="monotone"
            dataKey="p"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
