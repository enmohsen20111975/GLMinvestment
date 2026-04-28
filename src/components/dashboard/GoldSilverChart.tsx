'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn, safeToFixed } from '@/lib/utils';

interface HistoryPoint {
  date: string;
  price: number;
  change: number | null;
  currency: string;
}

interface GoldSilverChartProps {
  karat: string;
  label: string;
  currency: string;
  colorClass: string; // e.g., 'text-amber-600' or 'text-slate-500'
  lineColor: string; // e.g., '#d97706' or '#64748b'
  days?: number;
}

function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function GoldSilverChart({
  karat,
  label,
  currency,
  colorClass,
  lineColor,
  days = 30,
}: GoldSilverChartProps) {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/market/gold/history?karat=${encodeURIComponent(karat)}&days=${days}`);
      if (!res.ok) throw new Error('Failed');
      const json = await res.json();
      if (json.success) {
        setData(json.data || []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [karat, days]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="rounded-lg bg-muted/30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/30 animate-pulse" />
          <span className="text-[11px] text-muted-foreground">{label}</span>
        </div>
        <div className="h-10 bg-muted/40 rounded animate-pulse" />
      </div>
    );
  }

  if (error || data.length === 0) {
    return null;
  }

  // Calculate stats
  const currentPrice = data[data.length - 1]?.price || 0;
  const startPrice = data[0]?.price || 0;
  const highPrice = Math.max(...data.map((d) => d.price));
  const lowPrice = Math.min(...data.map((d) => d.price));
  const changeAmt = currentPrice - startPrice;
  const changePct = startPrice > 0 ? (changeAmt / startPrice) * 100 : 0;
  const isPositive = changeAmt >= 0;

  // SVG sparkline dimensions
  const width = 280;
  const height = 36;
  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const priceRange = highPrice - lowPrice || 1;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * chartWidth;
    const y = padding + chartHeight - ((d.price - lowPrice) / priceRange) * chartHeight;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(' L ')}`;
  // Area fill path (go down to bottom)
  const areaD = `${pathD} L ${padding + chartWidth},${height - padding} L ${padding},${height - padding} Z`;

  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className={cn('w-2 h-2 rounded-full', isPositive ? 'bg-emerald-500' : 'bg-red-500')} />
          <span className={cn('text-[11px] font-semibold', colorClass)}>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tabular-nums" dir="ltr">
            {formatNumber(currentPrice)} {currency}
          </span>
          <span
            className={cn(
              'text-[10px] font-bold tabular-nums flex items-center gap-0.5',
              isPositive
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            )}
          >
            {Math.abs(changeAmt) > 0.01 ? (
              <>
                {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {isPositive ? '+' : ''}{safeToFixed(changePct)}%
              </>
            ) : (
              <>
                <Minus className="w-2.5 h-2.5" />
                0.00%
              </>
            )}
          </span>
        </div>
      </div>

      {/* Sparkline SVG */}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-10" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${karat}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path d={areaD} fill={`url(#grad-${karat})`} />
        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Current price dot */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].split(',')[0]}
            cy={points[points.length - 1].split(',')[1]}
            r="2.5"
            fill={lineColor}
            stroke={isDark ? 'hsl(var(--background))' : 'white'}
            strokeWidth="1"
          />
        )}
      </svg>

      {/* Min/Max labels */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-muted-foreground tabular-nums" dir="ltr">
          أدنى: {formatNumber(lowPrice)}
        </span>
        <span className="text-[9px] text-muted-foreground">
          آخر {data.length} يوم
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums" dir="ltr">
          أعلى: {formatNumber(highPrice)}
        </span>
      </div>
    </div>
  );
}
