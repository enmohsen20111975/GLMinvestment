'use client';

/**
 * TimeHorizonBadge — شارة الأفق الزمني
 * ============================================================
 * يعرض الأفق الزمني للتوصية (يومية/أسبوعية/استراتيجية) كـ badge.
 * Rule 4: لا حساب مالي — كل البيانات من API.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TimeHorizonBadgeProps {
  horizon?: string | null;
  icon?: string | null;
  className?: string;
}

export function TimeHorizonBadge({ horizon, icon, className }: TimeHorizonBadgeProps) {
  if (!horizon) return null;

  // لونBadge حسب الأفق (emerald/teal/amber — لا أزرق)
  const colorClass = horizon.includes('يومية') || horizon.includes('قصيرة')
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
    : horizon.includes('أسبوعية') || horizon.includes('متوسطة')
    ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30'
    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30';

  return (
    <Badge variant="outline" className={cn('gap-1 text-[10px] font-medium', colorClass, className)}>
      {icon && <span className="text-xs">{icon}</span>}
      {horizon}
    </Badge>
  );
}
