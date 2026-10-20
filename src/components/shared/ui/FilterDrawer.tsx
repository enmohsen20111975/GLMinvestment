'use client';

/**
 * FilterDrawer — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 6/8)
 * ====================================================================
 * درج جانبي موحد ينزلق بسلاسة من اليمين ليحوي كل الفلاتر المتقدمة
 * (مؤشرات، قطاعات، نسب مالية)، بدلاً من بعثرة الفلاتر في صفحات منفصلة.
 *
 * بـ يستخدم shadcn/ui Sheet (موجود بالفعل).
 * Rule 30: Emerald + Amber (ممنوع أزرق).
 *
 * Phase 1: wrapper موحد. الـ filter content بيتـ inject كـ children.
 * Phase 2-4: ممكن يـ standardize الـ filter groups.
 */
import React from 'react';
import {
 Sheet,
 SheetContent,
 SheetHeader,
 SheetTitle,
 SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterDrawerProps {
 /** مفتوح؟ */
 open: boolean;
 /** toggle handler. */
 onOpenChange: (open: boolean) => void;
 /** محتوى الفلاتر (عناصر الفلتر). */
 children: React.ReactNode;
 /** عنوان الدرج (default: "تصفية متقدمة"). */
 title?: string;
 /** وصف (optional). */
 description?: string;
 /** زر تطبيق (optional). */
 onApply?: () => void;
 /** زر إعادة تعيين (optional). */
 onReset?: () => void;
 className?: string;
}

export function FilterDrawer({
 open,
 onOpenChange,
 children,
 title = 'تصفية متقدمة',
 description,
 onApply,
 onReset,
 className,
}: FilterDrawerProps) {
 return (
 <Sheet open={open} onOpenChange={onOpenChange}>
 <SheetContent
 side="right"
 className={cn(
 'w-full sm:max-w-md overflow-y-auto p-0',
 className
 )}
 dir="rtl"
 >
 <SheetHeader className="px-5 py-4 border-b border-border bg-muted/30">
 <SheetTitle className="flex items-center gap-2 text-base font-bold">
 <SlidersHorizontal className="size-4 text-profit" />
 {title}
 </SheetTitle>
 {description && (
 <SheetDescription className="text-xs">{description}</SheetDescription>
 )}
 </SheetHeader>

 {/* محتوى الفلاتر */}
 <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto">
 {children}
 </div>

 {/* أزرار الإجراء */}
 {(onApply || onReset) && (
 <div className="sticky bottom-0 flex gap-2 px-5 py-3 border-t border-border bg-background">
 {onReset && (
 <Button
 variant="outline"
 size="sm"
 onClick={onReset}
 className="flex-1 gap-1.5"
 >
 <X className="size-3.5" />
 إعادة تعيين
 </Button>
 )}
 {onApply && (
 <Button
 size="sm"
 onClick={onApply}
 className="flex-1 bg-profit hover:bg-profit/90 text-profit-foreground gap-1.5"
 >
 <SlidersHorizontal className="size-3.5" />
 تطبيق الفلاتر
 </Button>
 )}
 </div>
 )}
 </SheetContent>
 </Sheet>
 );
}
