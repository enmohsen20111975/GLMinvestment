'use client';

/**
 * WidgetStat — الكارت الإحصائي الموحد
 * ====================================================================
 * بدل ما كل widget يكتب:
 *   <div className="rounded-lg border bg-card p-2 text-center">
 *     <div className="text-[10px] text-muted-foreground">القيمة الحالية</div>
 *     <div className="text-sm font-bold tabular-nums text-profit">+1,234</div>
 *   </div>
 *
 * دلوقتي يكتب:
 *   <WidgetStat label="القيمة الحالية" value="+1,234" valueClass="text-profit" />
 *
 * استخدامه في 109+ ملف → توفير ~1500 سطر تكرار.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface WidgetStatProps {
  /** عنوان الإحصاء (عربي) */
  label: string;
  /** القيمة (رقم/نص) */
  value: React.ReactNode;
  /** وحدة إضافية (ج.م، %، إلخ) */
  suffix?: string;
  /** لون القيمة (Tailwind class) — profit/loss/muted */
  valueClass?: string;
  /** حجم القيمة (default: text-sm) */
  valueSize?: 'xs' | 'sm' | 'md' | 'lg';
  /** class إضافي */
  className?: string;
  /** callback عند الضغط */
  onClick?: () => void;
  /** اتجاه العرض */
  align?: 'center' | 'start';
}

const sizeMap = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

export function WidgetStat({
  label,
  value,
  suffix,
  valueClass,
  valueSize = 'sm',
  className,
  onClick,
  align = 'center',
}: WidgetStatProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      className={cn(
        'rounded-lg border border-border bg-card p-2 text-center',
        onClick && 'transition-colors hover:bg-accent/50 cursor-pointer',
        align === 'start' && 'text-start',
        className,
      )}
      onClick={onClick}
    >
      <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
      <div className={cn('font-bold tabular-nums', sizeMap[valueSize], valueClass)} dir="ltr">
        {value}
        {suffix && <span className="text-[9px] text-muted-foreground ms-0.5">{suffix}</span>}
      </div>
    </Comp>
  );
}

/**
 * WidgetStatGrid — grid layout لمجموعة WidgetStat
 * بدل ما تكتب grid grid-cols-3 gap-2 + كروت يدوي
 */
export function WidgetStatGrid({
  cols = 3,
  children,
  className,
}: {
  cols?: 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const colsMap = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  };
  return (
    <div className={cn('grid gap-2 rounded-lg bg-muted/30 p-2', colsMap[cols], className)}>
      {children}
    </div>
  );
}

export default WidgetStat;
