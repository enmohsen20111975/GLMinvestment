'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * StatCard — بطاقة إحصائية موحدة لكل المشروع.
 *
 * Rule 28 (NO-DUPLICATION): كان فيه 10 نسخ من StatCard في مكونات مختلفة.
 * دلوقتي اتوحدت هنا.
 *
 * الاستخدام:
 *   import { StatCard } from '@/components/ui/stat-card';
 *   <StatCard icon={<Target />} label="توقعات" value="10" tone="positive" />
 */

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
  className?: string;
}

export function StatCard({
  icon,
  label,
  value,
  tone = 'neutral',
  className,
}: StatCardProps) {
  return (
    <Card className={cn('p-3', className)}>
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div
        className={cn(
          'text-lg font-bold',
          tone === 'positive' && 'text-emerald-600',
          tone === 'negative' && 'text-red-600',
          tone === 'warning' && 'text-amber-600'
        )}
      >
        {value}
      </div>
    </Card>
  );
}

export default StatCard;
