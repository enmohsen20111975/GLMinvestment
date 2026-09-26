'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * StatCard — بطاقة إحصائية موحدة لكل المشروع.
 * تدعم تمرير الأيقونة كعنصر JSX مثل `<Target className="..." />` أو كمكون مثل `icon={BarChart3}`.
 */
interface StatCardProps {
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
  color?: string;
  bg?: string;
  subtext?: string;
  className?: string;
}

function renderStatIcon(icon?: React.ReactNode | React.ComponentType<{ className?: string }>) {
  if (!icon) return null;
  if (React.isValidElement(icon)) {
    return icon;
  }
  if (
    typeof icon === 'function' ||
    (typeof icon === 'object' && icon !== null && ('render' in icon || '$$typeof' in icon))
  ) {
    const IconComponent = icon as React.ComponentType<{ className?: string }>;
    return <IconComponent className="w-4 h-4" />;
  }
  return null;
}

export function StatCard({
  icon,
  label,
  value,
  tone = 'neutral',
  color,
  bg,
  subtext,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('p-3 transition-all', bg, className)}>
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {renderStatIcon(icon)}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div
        className={cn(
          'text-lg font-bold tabular-nums',
          color,
          !color && tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          !color && tone === 'negative' && 'text-red-600 dark:text-red-400',
          !color && tone === 'warning' && 'text-amber-600 dark:text-amber-400'
        )}
      >
        {value}
      </div>
      {subtext && (
        <p className="text-[11px] text-muted-foreground mt-1 truncate">
          {subtext}
        </p>
      )}
    </Card>
  );
}

export default StatCard;

