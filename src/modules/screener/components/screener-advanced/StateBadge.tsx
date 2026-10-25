// src/modules/screener/components/screener-advanced/StateBadge.tsx
// F-Phase3-Split-Screener — StateBadge: شارة ملوّنة تعرض حالة السهم التقنية
// (CORRECTION_END / NEAR_BREAKOUT / AT_PEAK / ...). الـ tooltip بيعرض
// السبب (`reason`) لو موجود.

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n-context';
import {
  STATE_BADGE_COLORS,
  getStateLabels,
} from './helpers';
import type { StateBadgeProps } from './types';

export function StateBadge({ state, reason }: StateBadgeProps) {
  const t = useTranslation();
  const colorClass = STATE_BADGE_COLORS[state] || STATE_BADGE_COLORS.NEUTRAL;
  const label = getStateLabels(t)[state] || state;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border cursor-help',
              colorClass,
            )}
          >
            {label}
          </span>
        </TooltipTrigger>
        {reason && (
          <TooltipContent side="top" className="max-w-[280px] text-right">
            {reason}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
