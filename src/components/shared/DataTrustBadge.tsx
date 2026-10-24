'use client';

/**
 * DataTrustBadge
 * ==============
 * FRONTEND-1 (Deliverable 4 — BONUS) — Public trust indicator.
 *
 * Compact, public-facing badge that shows data freshness at-a-glance.
 * Used on the liquidity radar screen so end users see the data is
 * trustworthy (the owner's #1 ask: "How does the user verify data is fresh?").
 *
 * - Uses `?public=1` on the API so no admin auth required.
 * - Auto-refreshes every 90s.
 * - Tiny (h-7) and unobtrusive — sits next to the RefreshCw button.
 * - Tooltip on hover shows last-updated + any frozen sources.
 *
 * Color tokens: profit (emerald) / warning (amber) / loss (rose).
 * NO indigo/blue (Rule 30).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types — minimal subset of the API response (only what the badge needs)
// ---------------------------------------------------------------------------

interface DataTrustResponse {
  success: boolean;
  timestamp: string;
  overall_health: 'GREEN' | 'YELLOW' | 'RED';
  overall_health_ar: string;
  summary: {
    frozen_markets: string[];
  };
  error?: 'db_locked';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DataTrustBadgeProps {
  /** Optional className override (used by LiquidityRadarView to size it). */
  className?: string;
}

export function DataTrustBadge({ className }: DataTrustBadgeProps) {
  const [data, setData] = useState<DataTrustResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        const res = await fetch('/api/admin/data-health?public=1', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json: DataTrustResponse = await res.json();
        if (!cancelled && json.success) {
          setData(json);
        }
      } catch {
        // Silent fail — the badge just stays on the last known state.
      }
    };

    fetchData();
    timerRef.current = setInterval(fetchData, 90_000);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Default state (before first fetch): neutral grey "جارٍ الفحص...".
  if (!data) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full',
                'bg-muted/60 border border-border/60 text-xs text-muted-foreground',
                'animate-pulse',
                className,
              )}
              dir="rtl"
            >
              <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
              <span>جارٍ فحص البيانات...</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p>جارٍ التحقق من طزاجة البيانات...</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const level = data.overall_health;
  const frozenCount = data.summary?.frozen_markets?.length ?? 0;

  const dotClass =
    level === 'GREEN'  ? 'bg-profit'  :
    level === 'YELLOW' ? 'bg-warning' :
                         'bg-loss';

  const badgeClass =
    level === 'GREEN'
      ? 'bg-profit/10 border-profit/30 text-profit'
      : level === 'YELLOW'
      ? 'bg-warning/10 border-warning/30 text-warning'
      : 'bg-loss/10 border-loss/30 text-loss';

  const label =
    level === 'GREEN'  ? 'بيانات طازجة' :
    level === 'YELLOW' ? 'بعض البيانات متأخرة' :
                         'بيانات متجمدة';

  const emoji =
    level === 'GREEN'  ? '🟢' :
    level === 'YELLOW' ? '🟡' :
                         '🔴';

  const tooltipLines: string[] = [
    `الحالة العامة: ${data.overall_health_ar} (${level})`,
    `آخر فحص: ${new Date(data.timestamp).toLocaleString('ar-EG')}`,
  ];
  if (frozenCount > 0) {
    tooltipLines.push(`مصادر متجمدة: ${frozenCount}`);
  }
  if (data.error === 'db_locked') {
    tooltipLines.push('تنبيه: قاعدة البيانات تحت ضغط مؤقت');
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full',
              'border text-xs font-semibold cursor-help',
              badgeClass,
              className,
            )}
            dir="rtl"
          >
            <span className="relative flex h-2 w-2">
              <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', dotClass)} />
              <span className={cn('relative inline-flex rounded-full h-2 w-2', dotClass)} />
            </span>
            <span>{emoji} {label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-[260px]" dir="rtl">
          <div className="space-y-0.5">
            {tooltipLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default DataTrustBadge;
