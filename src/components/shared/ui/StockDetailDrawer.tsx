'use client';

/**
 * StockDetailDrawer — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 7/8)
 * ====================================================================
 * درج موحد عند النقر على أي سهم في أي شاشة (الرئيسية، الأسهم، الرادار،
 * التوصيات، المحفظة) يعرض عمق السهم، الشارت السريع، وتفاصيله المالية.
 *
 * بـ يستخدم shadcn/ui Sheet (موجود بالفعل).
 * Phase 1: wrapper موحد — الـ content بيتـ inject.
 * Phase 2-4: ممكن يـ standardize الـ detail layout.
 *
 * Rule 20: مفيش logic حسابي — الـ data بتيجي من API.
 * Rule 27: مفيش أرقام وهمية.
 * Rule 30: Emerald + Amber (ممنوع أزرق).
 */
import React from 'react';
import {
 Sheet,
 SheetContent,
 SheetHeader,
 SheetTitle,
 SheetDescription,
} from '@/components/ui/sheet';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StockDetailDrawerProps {
 /** مفتوح؟ */
 open: boolean;
 /** toggle handler. */
 onOpenChange: (open: boolean) => void;
 /** التيكر (مثلاً "COMI"). */
 ticker?: string;
 /** اسم السهم (optional). */
 name?: string;
 /** محتوى التفاصيل (chart + financials). */
 children?: React.ReactNode;
 className?: string;
}

export function StockDetailDrawer({
 open,
 onOpenChange,
 ticker,
 name,
 children,
 className,
}: StockDetailDrawerProps) {
 const title = ticker ? `${ticker}${name ? ' · ' + name : ''}` : 'تفاصيل السهم';

 return (
 <Sheet open={open} onOpenChange={onOpenChange}>
 <SheetContent
 side="right"
 className={cn(
 'w-full sm:max-w-2xl overflow-y-auto p-0',
 className
 )}
 dir="rtl"
 >
 <SheetHeader className="px-5 py-4 border-b border-border bg-muted/30 sticky top-0 z-10">
 <SheetTitle className="flex items-center gap-2 text-base font-bold">
 <span className="size-8 rounded-lg bg-profit/10 flex items-center justify-center text-profit font-bold text-sm">
 {ticker ? ticker.charAt(0) : ''}
 </span>
 {title}
 </SheetTitle>
 <SheetDescription className="sr-only">
 تفاصيل السهم {ticker || ''}
 </SheetDescription>
 </SheetHeader>

 {/* محتوى التفاصيل */}
 <div className="px-5 py-4">
 {children || (
 <div className="text-center py-12 text-sm text-muted-foreground">
 لا توجد تفاصيل متاحة لهذا السهم حالياً.
 </div>
 )}
 </div>
 </SheetContent>
 </Sheet>
 );
}
