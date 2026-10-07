'use client';

import React, { useEffect, useRef, useState, memo } from 'react';

export interface FlashingPriceCellProps {
  price: number | null | undefined;
  className?: string;
  format?: (val: number) => string;
}

function defaultFormat(val: number): string {
  if (val == null || isNaN(val)) return '-';
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (val >= 10) return val.toFixed(2);
  return val.toFixed(3);
}

export const FlashingPriceCell = memo(function FlashingPriceCell({
  price,
  className = '',
  format = defaultFormat,
}: FlashingPriceCellProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (price == null || isNaN(price)) return;

    if (prevPriceRef.current !== null && prevPriceRef.current !== price) {
      const isUp = price > prevPriceRef.current;
      setFlash(isUp ? 'up' : 'down');

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setFlash(null);
      }, 1600);
    }

    prevPriceRef.current = price;

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [price]);

  if (price == null || isNaN(price)) {
    return <span className={`text-muted-foreground font-mono ${className}`}>-</span>;
  }

  const isUp = flash === 'up';
  const isDown = flash === 'down';

  return (
    <span
      className={`inline-flex items-center justify-end gap-1 font-mono tabular-nums text-xs md:text-sm transition-all duration-300 rounded px-1.5 py-0.5 ${
        isUp
          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/50 font-bold shadow-sm scale-105'
          : isDown
          ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/50 font-bold shadow-sm scale-105'
          : 'text-foreground font-semibold'
      } ${className}`}
      title={isUp ? 'ارتفع السعر للتو' : isDown ? 'انخفض السعر للتو' : undefined}
    >
      {isUp && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold animate-pulse">▲</span>}
      {isDown && <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold animate-pulse">▼</span>}
      <span>{format(price)}</span>
    </span>
  );
});
