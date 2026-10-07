'use client';

import React, { useEffect, useRef, useState, memo } from 'react';

export interface FlashingChangeCellProps {
  changePct: number | null | undefined;
  className?: string;
}

export const FlashingChangeCell = memo(function FlashingChangeCell({
  changePct,
  className = '',
}: FlashingChangeCellProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevChangeRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (changePct == null || isNaN(changePct)) return;

    if (prevChangeRef.current !== null && prevChangeRef.current !== changePct) {
      const isUp = changePct > prevChangeRef.current;
      setFlash(isUp ? 'up' : 'down');

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setFlash(null);
      }, 1600);
    }

    prevChangeRef.current = changePct;

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [changePct]);

  if (changePct == null || isNaN(changePct)) {
    return <span className={`text-muted-foreground font-mono text-xs ${className}`}>-</span>;
  }

  const isUp = flash === 'up';
  const isDown = flash === 'down';
  const isPositive = changePct > 0;
  const isNegative = changePct < 0;

  const sign = isPositive ? '+' : '';
  const formatted = `${sign}${changePct.toFixed(2)}%`;

  return (
    <span
      className={`inline-flex items-center justify-end gap-0.5 font-mono tabular-nums text-xs transition-all duration-300 rounded px-1.5 py-0.5 ${
        isUp
          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/50 font-bold shadow-sm scale-105'
          : isDown
          ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/50 font-bold shadow-sm scale-105'
          : isPositive
          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
          : isNegative
          ? 'text-rose-600 dark:text-rose-400 font-semibold'
          : 'text-muted-foreground'
      } ${className}`}
    >
      <span>{formatted}</span>
    </span>
  );
});
