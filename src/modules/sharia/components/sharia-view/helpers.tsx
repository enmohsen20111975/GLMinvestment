/**
 * sharia-view/helpers.tsx
 * ======================
 * Shared helpers + Islamic visual vocabulary for the ShariaView split
 * (Task F-Phase3-FinalPush — split from 1,478 LOC).
 *
 * Exports:
 *   - IslamicPattern, OrnamentDivider, GoldBorder (visual primitives)
 *   - deriveOverallStatus, formatPct, safeNumber (pure compute)
 *   - Alert (small inline alert component)
 *
 * Pure helpers + minimal JSX primitives — no fetch, no state.
 */

import React from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShariaRow, ShariaStatus } from './types';

/* ------------------------------------------------------------------ */
/* Islamic visual vocabulary (consistent with ZakatView/TithesView) */
/* ------------------------------------------------------------------ */

export function IslamicPattern() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.06] pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <pattern
          id="shariaIslamicPattern"
          x="0"
          y="0"
          width="60"
          height="60"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M30 0 L60 30 L30 60 L0 30 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
          />
          <circle cx="30" cy="30" r="10" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <path d="M30 20 L30 40 M20 30 L40 30" stroke="currentColor" strokeWidth="0.3" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#shariaIslamicPattern)" />
    </svg>
  );
}

export function OrnamentDivider() {
  return (
    <div className="flex items-center justify-center gap-2 py-1" aria-hidden>
      <div className="flex-1 h-px from-transparent to-transparent" />
      <Sparkles className="w-3.5 h-3.5 text-warning/70" />
      <div className="flex-1 h-px from-transparent to-transparent" />
    </div>
  );
}

export function GoldBorder() {
  return (
    <div
      className="h-0.5 w-full rounded-full"
      style={{
        background:
          'linear-gradient(90deg, rgba(212,175,55,0) 0%, rgba(212,175,55,0.7) 50%, rgba(212,175,55,0) 100%)',
      }}
      aria-hidden
    />
  );
}

/* ------------------------------------------------------------------ */
/* Status helpers */
/* ------------------------------------------------------------------ */

export function deriveOverallStatus(row: ShariaRow): ShariaStatus {
  const consensus = Number(row.is_halal_consensus ?? 0);
  if (consensus >= 1) return 'compliant';
  const compliantCount = Number(row.compliant_sources_count ?? 0);
  const activeCount = Number(row.active_sources_count ?? 0);
  if (activeCount > 0 && compliantCount === 0) return 'non_compliant';
  if (activeCount > 0 && compliantCount < 6) return 'doubtful' as any;
  return 'not_available' as any;
}

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export function safeNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* Small alert — used by calculators + list tab */
/* ------------------------------------------------------------------ */

export function Alert({ variant, children }: { variant: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 p-3 rounded-md text-xs border',
        variant === 'error'
          ? 'border-loss bg-loss/10 text-loss border border-loss/20 '
          : 'border-warning bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
      )}
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}
