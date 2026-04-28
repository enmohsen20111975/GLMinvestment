'use client';

import React, { useState, useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Line,
} from 'recharts';
import { useAppStore } from '@/lib/store';
import { cn, safeToFixed } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const TIME_RANGES = [
  { key: '7d', label: '7 أيام', days: 7 },
  { key: '30d', label: 'شهر', days: 30 },
  { key: '90d', label: '3 أشهر', days: 90 },
  { key: '180d', label: '6 أشهر', days: 180 },
] as const;

type TimeRangeKey = (typeof TIME_RANGES)[number]['key'];

// Custom tooltip
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const close = payload.find((p) => p.dataKey === 'close');
  const volume = payload.find((p) => p.dataKey === 'volume');

  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg text-sm" dir="rtl">
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      {close && (
        <p className="font-semibold tabular-nums" dir="ltr">
          {safeToFixed(close.value)} EGP
        </p>
      )}
      {volume && (
        <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">
          حجم: {safeToFixed(volume.value / 1_000_000)}M
        </p>
      )}
    </div>
  );
}

// Empty chart placeholder
function EmptyChart() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
      <svg
        className="w-16 h-16 mb-3 opacity-30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm">لا توجد بيانات تاريخية متاحة</p>
    </div>
  );
}

export function StockChart() {
  const { stockHistory } = useAppStore();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [selectedRange, setSelectedRange] = useState<TimeRangeKey>('90d');

  // Filter data based on selected range
  const chartData = useMemo(() => {
    if (!stockHistory?.data || stockHistory.data.length === 0) return [];

    const rangeConfig = TIME_RANGES.find((r) => r.key === selectedRange);
    if (!rangeConfig) return stockHistory.data;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - rangeConfig.days);

    return stockHistory.data
      .filter((point) => {
        const pointDate = new Date(point.date);
        return pointDate >= cutoffDate;
      })
      .map((point) => ({
        ...point,
        // Format date for display
        dateLabel: new Date(point.date).toLocaleDateString('ar-EG', {
          month: 'short',
          day: 'numeric',
        }),
      }));
  }, [stockHistory, selectedRange]);

  const priceMin = useMemo(() => {
    if (chartData.length === 0) return 0;
    const prices = chartData.map((d) => d.low);
    return Math.min(...prices) * 0.995;
  }, [chartData]);

  const priceMax = useMemo(() => {
    if (chartData.length === 0) return 100;
    const prices = chartData.map((d) => d.high);
    return Math.max(...prices) * 1.005;
  }, [chartData]);

  // Check if first price is lower than last price for line color
  const isUpTrend = useMemo(() => {
    if (chartData.length < 2) return true;
    return chartData[chartData.length - 1].close >= chartData[0].close;
  }, [chartData]);

  if (!stockHistory && !chartData.length) {
    return (
      <div className="space-y-3" dir="rtl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header with Time Range Selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">الرسم البياني للسعر</h3>
        <div className="flex gap-1.5">
          {TIME_RANGES.map((range) => (
            <button
              key={range.key}
              onClick={() => setSelectedRange(range.key)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                selectedRange === range.key
                  ? 'bg-emerald-600 text-white'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary bar */}
      {stockHistory?.summary && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            الأعلى: <strong className="text-foreground tabular-nums" dir="ltr">{safeToFixed(stockHistory.summary?.highest)}</strong>
          </span>
          <span>
            الأدنى: <strong className="text-foreground tabular-nums" dir="ltr">{safeToFixed(stockHistory.summary?.lowest)}</strong>
          </span>
          <span>
            المتوسط: <strong className="text-foreground tabular-nums" dir="ltr">{safeToFixed(stockHistory.summary?.avg_price)}</strong>
          </span>
        </div>
      )}

      {/* Chart */}
      {chartData.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={isUpTrend ? '#34d399' : '#f87171'}
                  stopOpacity={isDark ? 0.5 : 0.4}
                />
                <stop
                  offset="95%"
                  stopColor={isUpTrend ? '#34d399' : '#f87171'}
                  stopOpacity={isDark ? 0.05 : 0.02}
                />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
              opacity={isDark ? 0.3 : 0.6}
            />

            {/* Price axis */}
            <YAxis
              yAxisId="price"
              domain={[priceMin, priceMax]}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={60}
              tickFormatter={(val: number) => val.toFixed(1)}
            />

            {/* Volume axis */}
            <YAxis
              yAxisId="volume"
              hide
              domain={[0, 'auto']}
            />

            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />

            <Tooltip content={<CustomTooltip />} />

            {/* Volume bars */}
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="hsl(var(--muted-foreground))"
              opacity={isDark ? 0.35 : 0.25}
              radius={[2, 2, 0, 0]}
            />

            {/* Price area fill */}
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="none"
              fill="url(#priceGradient)"
            />

            {/* Price line */}
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke={isUpTrend ? '#34d399' : '#f87171'}
              strokeWidth={isDark ? 3 : 2.5}
              dot={false}
              activeDot={{
                r: 5,
                fill: isUpTrend ? '#34d399' : '#f87171',
                stroke: 'hsl(var(--background))',
                strokeWidth: 2,
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Change info */}
      {stockHistory?.summary && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <span className="text-xs text-muted-foreground">التغيير في الفترة:</span>
          <span
            className={cn(
              'text-sm font-bold tabular-nums',
              stockHistory.summary.change_percent >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            )}
            dir="ltr"
          >
            {stockHistory.summary.change_percent >= 0 ? '+' : ''}
            {safeToFixed(stockHistory.summary?.change_percent)}%
          </span>
        </div>
      )}
    </div>
  );
}
