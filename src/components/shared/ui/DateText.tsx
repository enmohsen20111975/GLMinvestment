'use client';

/**
 * DateText — مكون موحد لعرض التواريخ
 * ====================================================================
 * بدل ما تكتب 92 مرة:
 *   new Date(dateStr).toLocaleDateString('ar-EG', { ... })
 *   new Intl.DateTimeFormat('ar-EG', { ... }).format(...)
 *
 * دلوقتي:
 *   <DateText value={dateStr} format="datetime" />
 *
 * يستخدم في 65 ملف → توفير ~92 سطر تكرار.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface DateTextProps {
  value: string | Date | null | undefined;
  format?: 'date' | 'time' | 'datetime' | 'relative';
  locale?: string;
  className?: string;
}

function relativeTime(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 0) return 'الآن';
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    if (diffMin === 1) return 'منذ دقيقة';
    if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
    return `منذ ${diffMin} دقيقة`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    if (diffHr === 1) return 'منذ ساعة';
    if (diffHr <= 10) return `منذ ${diffHr} ساعات`;
    return `منذ ${diffHr} ساعة`;
  }
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'منذ يوم';
  if (diffDay <= 10) return `منذ ${diffDay} أيام`;
  return `منذ ${diffDay} يوم`;
}

export function DateText({
  value,
  format = 'datetime',
  locale = 'ar-EG',
  className,
}: DateTextProps) {
  if (!value) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  if (format === 'relative') {
    return <span className={className}>{relativeTime(date)}</span>;
  }

  const options: Intl.DateTimeFormatOptions = format === 'date'
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : format === 'time'
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };

  try {
    return <span className={className}>{new Intl.DateTimeFormat(locale, options).format(date)}</span>;
  } catch {
    return <span className={className}>{date.toLocaleString(locale)}</span>;
  }
}

export default DateText;
