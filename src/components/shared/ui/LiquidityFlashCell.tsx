'use client';

/**
 * LiquidityFlashCell — BLUEPRINT Phase 5 (Live Screens)
 * ====================================================================
 * خلية بـ تـ flash لما السيولة تتغير: أخضر (زادت) / أحمر (قلت).
 * مخصصة لرادار السيولة — تعرض القيمة + flash animation + سهم.
 *
 * Pattern: memo + useRef + useState (Jimmy's UnifiedTable style).
 * Rule 27: مفيش أرقام وهمية.
 * Rule 30: profit/loss tokens (ممنوع direct palette).
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface LiquidityFlashCellProps {
  /** قيمة السيولة الحالية (net flow, volume, إلخ). */
  value: number | null | undefined;
  /** دالة format (default: M/K format). */
  format?: (val: number) => string;
  className?: string;
}

function defaultFormat(val: number): string {
  const abs = Math.abs(val);
  const sign = val >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export const LiquidityFlashCell = memo(function LiquidityFlashCell({
  value,
  format = defaultFormat,
  className,
}: LiquidityFlashCellProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;

    if (prevRef.current !== null && prevRef.current !== value) {
      setFlash(value > prevRef.current ? 'up' : 'down');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setFlash(null), 2000);
    }
    prevRef.current = value;

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value]);

  if (value == null || !Number.isFinite(value)) {
    return <span className={cn('text-muted-foreground font-mono', className)}>—</span>;
  }

  const isUp = flash === 'up';
  const isDown = flash === 'down';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono tabular-nums font-bold transition-all duration-500 rounded px-1.5 py-0.5',
        isUp && 'bg-profit/20 text-profit ring-1 ring-profit/40 animate-pulse',
        isDown && 'bg-loss/20 text-loss ring-1 ring-loss/40 animate-pulse',
        !isUp && !isDown && value >= 0 && 'text-profit',
        !isUp && !isDown && value < 0 && 'text-loss',
        className
      )}
    >
      {isUp && <span className="text-[10px] animate-bounce">▲</span>}
      {isDown && <span className="text-[10px] animate-bounce">▼</span>}
      <span>{format(value)}</span>
    </span>
  );
});
