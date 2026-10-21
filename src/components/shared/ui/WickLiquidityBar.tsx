'use client';

/**
 * WickLiquidityBar — تشريح الفتائل والسيولة الحقيقية
 * ====================================================================
 * Per ALPHA Operational Directive (Task 2) 2026-10-20.
 *
 * Shows 3 horizontal bars:
 * 1. Lower wick ratio (قوة الشراء) — green
 * 2. Upper wick ratio (ضغط البيع) — red
 * 3. Dryness ratio (الجفاف اليومي) — amber
 *
 * Dumb component: ALL values from API props. NO calculations in React.
 * NO marketing language — plain market terms only.
 *
 * @example
 * <WickLiquidityBar lowerWickPct={35} upperWickPct={15} drynessPct={50} />
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface WickLiquidityBarProps {
  /** Lower wick percentage (0-100) — buying power. */
  lowerWickPct?: number | null;
  /** Upper wick percentage (0-100) — selling pressure. */
  upperWickPct?: number | null;
  /** Dryness percentage (0-100) — low volume ratio. */
  drynessPct?: number | null;
  /** Hard Gate 0 status from API. If 'rejected', show red ban card. */
  hardGateStatus?: 'passed' | 'rejected' | 'unknown' | string | null;
  /** Hard Gate 0 reason from API (shown in the ban card). */
  hardGateReason?: string | null;
  /** Extra className. */
  className?: string;
}

function Bar({ label, pct, color, emoji }: {
  label: string;
  pct: number | null | undefined;
  color: string;
  emoji: string;
}) {
  const value = (pct != null && Number.isFinite(pct)) ? Math.min(100, Math.max(0, pct)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{emoji} {label}</span>
        <span className={cn('font-bold tabular-nums', color)}>
          {pct != null ? `${pct.toFixed(1)}%` : '—'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${value}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

export function WickLiquidityBar({
  lowerWickPct,
  upperWickPct,
  drynessPct,
  hardGateStatus,
  hardGateReason,
  className,
}: WickLiquidityBarProps) {
  return (
    <div className={cn('space-y-2', className)} dir="rtl">
      <div className="text-xs font-bold text-muted-foreground">تشريح الفتائل والسيولة</div>

      {/* Lower wick — buying power */}
      <Bar
        label="فتيلة سفلية (قوة الشراء)"
        pct={lowerWickPct}
        color="bg-profit text-profit"
        emoji="🟢"
      />

      {/* Upper wick — selling pressure */}
      <Bar
        label="فتيلة علوية (ضغط البيع)"
        pct={upperWickPct}
        color="bg-loss text-loss"
        emoji="🔴"
      />

      {/* Dryness — low volume */}
      <Bar
        label="الجفاف اليومي"
        pct={drynessPct}
        color="bg-warning text-warning"
        emoji="🟡"
      />

      {/* Hard Gate 0 — sovereign veto */}
      {hardGateStatus === 'rejected' && (
        <div className="rounded-md border border-loss/30 bg-loss/10 p-2 mt-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-loss">
            <span>🚫</span>
            <span>السهم محظور سيادياً — في منطقة تصريف أو قمة سنوية</span>
          </div>
          {hardGateReason && (
            <p className="text-[10px] text-loss/70 mt-1">{hardGateReason}</p>
          )}
        </div>
      )}

      {hardGateStatus === 'passed' && (
        <div className="rounded-md border border-profit/20 bg-profit/5 p-1.5 text-[10px] text-profit text-center">
          ✅ اجتاز البوابة السيادية
        </div>
      )}
    </div>
  );
}

export default WickLiquidityBar;
