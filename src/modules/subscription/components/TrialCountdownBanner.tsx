'use client';

/**
 * TrialCountdownBanner — بانر تنبيهي بعدد الأيام المتبقية في الفترة المجانية
 * =====================================================================
 *
 * بيظهر فوق الـ TopBar للمستخدمين الـ Free في فترة الـ trial (14 يوم).
 * - لو باقي 7 أيام أو أكتر: لون أزرق هادي
 * - لو باقي 3-6 أيام: لون أصفر (تحذير)
 * - لو باقي 1-2 يوم: لون أحمر (حرج)
 * - لو الـ trial انتهى: مبيظهرش (الـ TrialExpiredModal بيتولّى الحظر)
 *
 * البانر فيه:
 * - عدد الأيام المتبقية
 * - زر "اشترك الآن" → يفتح PricingView
 *
 * مبيظهرش للمستخدمين المدفوعين.
 */

import React, { useState, useEffect } from 'react';
import { Clock, Crown, X } from 'lucide-react';
import { PricingView } from './PricingView';
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface TrialCountdownBannerProps {
 /** daysLeft: الأيام المتبقية (0 = منتهي) */
 daysLeft?: number;
 /** trialEndsAt: تاريخ انتهاء الـ trial */
 trialEndsAt?: string | null;
 /** هل المستخدم Free (trial active)؟ */
 show: boolean;
}

export function TrialCountdownBanner({ daysLeft, trialEndsAt, show }: TrialCountdownBannerProps) {
 const [pricingOpen, setPricingOpen] = useState(false);
 const [dismissed, setDismissed] = useState(false);

 // إعادة ضبط dismissed لو الـ daysLeft اتغيّر
 useEffect(() => {
 setDismissed(false);
 }, [daysLeft]);

 if (!show || dismissed || daysLeft == null || daysLeft <= 0) {
 return null;
 }

 // تحديد اللون حسب عدد الأيام
 let accent = 'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300';
 let urgencyLabel = 'فترة تجريبية';
 if (daysLeft <= 2) {
 accent = 'bg-loss/10 border-loss/30 text-loss ';
 urgencyLabel = 'آخر فرصة!';
 } else if (daysLeft <= 6) {
 accent = 'bg-warning/10 border-warning/30 text-warning ';
 urgencyLabel = 'تذكير';
 }

 return (
 <>
 <div
 className={cn(
 'sticky top-0 z-40 w-full border-b px-3 py-2 flex items-center justify-between gap-2 text-xs',
 accent,
 )}
 dir="rtl"
 >
 <div className="flex items-center gap-2 flex-1 min-w-0">
 <Clock className="w-3.5 h-3.5 shrink-0" />
 <span className="font-medium truncate">
 {urgencyLabel}: باقي{' '}
 <span className="font-bold">
 {daysLeft} {daysLeft === 1 ? 'يوم' : 'أيام'}
 </span>{' '}
 على انتهاء الفترة المجانية
 {trialEndsAt && (
 <span className="opacity-70 hidden sm:inline">
 {' '}
 ({new Date(trialEndsAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })})
 </span>
 )}
 </span>
 </div>
 <div className="flex items-center gap-1 shrink-0">
 <button
 onClick={() => setPricingOpen(true)}
 className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-foreground/10 hover:bg-foreground/20 transition-colors font-medium text-xs"
 >
 <Crown className="w-3 h-3" />
 <span className="hidden sm:inline">اشترك الآن</span>
 <span className="sm:hidden">اشترك</span>
 </button>
 <button
 onClick={() => setDismissed(true)}
 className="p-1 rounded hover:bg-foreground/10 transition-colors"
 aria-label="إغلاق"
 title="إغلاق"
 >
 <X className="w-3 h-3" />
 </button>
 </div>
 </div>

 {/* Pricing dialog */}
 <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
 <DialogContent className="max-w-5xl w-[calc(100%-1rem)] max-h-[90vh] overflow-y-auto p-0" dir="rtl">
 <DialogHeader className="sr-only">
 <DialogTitle>باقات الاشتراك</DialogTitle>
 </DialogHeader>
 <PricingView
 onCheckoutSuccess={(iframeUrl) => {
 window.location.href = iframeUrl;
 }}
 />
 </DialogContent>
 </Dialog>
 </>
 );
}
