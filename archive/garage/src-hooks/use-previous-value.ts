'use client';

/**
 * usePreviousValue — BLUEPRINT Phase 5 (Live Screens)
 * ====================================================================
 * Hook بيتتبع القيمة السابقة + بيرجّع flash direction + delta.
 * Pattern: Jimmy's UnifiedTable (useRef + useState — مفيش re-render زيادة).
 *
 * Rule 20: مفيش logic حسابي — الـ delta بيتحسب من فرق رقمين (basic subtraction).
 *
 * Usage:
 *   const { prev, direction, delta, changed } = usePreviousValue(price);
 *   // direction: 'up' | 'down' | null
 *   // delta: number (current - prev)
 *   // changed: true لو القيمة اتغيرت في آخر update
 */
import { useRef, useState, useEffect } from 'react';

export interface PreviousValueResult<T> {
  prev: T | null;
  direction: 'up' | 'down' | null;
  delta: number;
  changed: boolean;
}

export function usePreviousValue<T extends number>(value: T): PreviousValueResult<T> {
  const prevRef = useRef<T | null>(null);
  const [result, setResult] = useState<PreviousValueResult<T>>({
    prev: null,
    direction: null,
    delta: 0,
    changed: false,
  });

  useEffect(() => {
    const prev = prevRef.current;
    if (prev !== null && prev !== value) {
      setResult({
        prev,
        direction: value > prev ? 'up' : 'down',
        delta: value - prev,
        changed: true,
      });
    } else if (prev === null) {
      setResult({ prev: null, direction: null, delta: 0, changed: false });
    }
    prevRef.current = value;
  }, [value]);

  return result;
}
