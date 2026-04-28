import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert any value to a safe number. Returns 0 for undefined/null/NaN. */
export function safeNum(value: unknown, fallback: number = 0): number {
  const num = Number(value);
  return !isNaN(num) && isFinite(num) ? num : fallback;
}

/** Safely call toFixed on any value. Returns fallback string for undefined/null/NaN. */
export function safeToFixed(value: unknown, digits: number = 2, fallback: string = '—'): string {
  const num = Number(value);
  return !isNaN(num) && isFinite(num) ? num.toFixed(digits) : fallback;
}
