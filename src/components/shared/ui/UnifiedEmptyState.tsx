'use client';

/**
 * UnifiedEmptyState — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 5/8)
 * ====================================================================
 * بديل لافتات التحذير الصفراء الفاضغة.
 * يظهر برسمة هادئة ورسالة وقورة (مثال: "جاري تحليل السوق لجلسة اليوم،
 * ستظهر الفرص فور اكتمال السيولة").
 *
 * Rule 27: مفيش أرقام وهمية.
 * Rule 30: Emerald + Amber (ممنوع أزرق).
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface UnifiedEmptyStateProps {
 /** أيقونة مخصصة (optional). default: animated pulse. */
 icon?: React.ReactNode;
 /** العنوان (default: "لا توجد بيانات"). */
 title?: string;
 /** الوصف (default: فارغ). */
 description?: string;
 /** نص زر الإجراء (optional). */
 actionLabel?: string;
 /** callback زر الإجراء. */
 onAction?: () => void;
 /** variant: "loading" (animated pulse) | "empty" (static) | "error". */
 variant?: 'loading' | 'empty' | 'error';
 className?: string;
}

export function UnifiedEmptyState({
 icon,
 title,
 description,
 actionLabel,
 onAction,
 variant = 'empty',
 className,
}: UnifiedEmptyStateProps) {
 const defaultTitle =
 variant === 'loading'
 ? 'جاري التحليل...'
 : variant === 'error'
 ? 'تعذّر التحميل'
 : 'لا توجد بيانات';

 const defaultDesc =
 variant === 'loading'
 ? 'جاري تحليل السوق لجلسة اليوم، ستظهر الفرص فور اكتمال السيولة.'
 : variant === 'error'
 ? 'حدث خطأ أثناء التحميل. حاول مرة أخرى.'
 : 'ستظهر البيانات فور توفّرها.';

 return (
 <div
 className={cn(
 'flex flex-col items-center justify-center text-center p-8 min-h-[240px]',
 className
 )}
 dir="rtl"
 role={variant === 'loading' ? 'status' : undefined}
 aria-live={variant === 'error' ? 'assertive' : 'polite'}
 >
 {/* أيقونة / رسمة هادئة */}
 <div
 className={cn(
 'mb-4 flex items-center justify-center size-16 rounded-2xl',
 variant === 'loading'
 ? 'bg-profit/5'
 : variant === 'error'
 ? 'bg-loss/5'
 : 'bg-muted'
 )}
 >
 {icon ? (
 icon
 ) : variant === 'loading' ? (
 <div className="size-8 rounded-full border-2 border-profit/30 border-t-profit animate-spin" />
 ) : (
 <div className="size-3 rounded-full bg-muted-foreground/40" />
 )}
 </div>

 <h3 className="text-base font-bold text-foreground mb-1.5">
 {title || defaultTitle}
 </h3>

 <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
 {description || defaultDesc}
 </p>

 {actionLabel && onAction && (
 <Button
 onClick={onAction}
 size="sm"
 className="mt-5 bg-profit hover:bg-profit/90 text-profit-foreground gap-1.5"
 >
 {actionLabel}
 </Button>
 )}
 </div>
 );
}
