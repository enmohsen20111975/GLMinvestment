'use client';

import React, { useEffect, useRef, useState, memo } from 'react';

/**
 * FlashingPriceCell — BLUEPRINT Phase 5: design tokens (profit/loss بدل emerald/rose).
 * بـ يـ flash أخضر/أحمر لما السعر يتغير + سهم صعود/هبوط.
 * Pattern: memo + useRef + useState (Jimmy's UnifiedTable style).
 */
export interface FlashingPriceCellProps {
  price: number | null | undefined;
  className?: string;
  format?: (val: number) => string;
}

function defaultFormat(val: number): string {
  if (val == null || isNaN(val)) return '-';
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (val >= 10) return (val ?? 0).toFixed(2);
  return (val ?? 0).toFixed(3);
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

  // BLUEPRINT Phase 5: design tokens (text-profit/text-loss) بدل direct palette.
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 font-mono tabular-nums text-xs md:text-sm transition-all duration-300 rounded px-1.5 py-0.5 ${
        isUp
          ? 'bg-profit/20 text-profit ring-1 ring-profit/50 font-bold shadow-sm scale-105'
          : isDown
          ? 'bg-loss/20 text-loss ring-1 ring-loss/50 font-bold shadow-sm scale-105'
          : 'text-foreground font-semibold'
      } ${className}`}
      title={isUp ? 'ارتفع السعر للتو' : isDown ? 'انخفض السعر للتو' : undefined}
    >
      {isUp && <span className="text-[10px] text-profit font-bold animate-pulse">▲</span>}
      {isDown && <span className="text-[10px] text-loss font-bold animate-pulse">▼</span>}
      <span>{format(price)}</span>
    </span>
  );
});
