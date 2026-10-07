'use client';

/**
 * TrialExpiredModal — overlay لا يحتوي على زر إغلاق
 * ============================================================
 * يظهر عند انتهاء فترة التجربة المجانية (14 يوماً). «إغلاق المنصة بالكامل»:
 *   - modal fullscreen overlay
 *   - لا يوجد زر إغلاق (X) — الطريقة الوحيدة للخروج هي الاشتراك
 *   - المحتوى الوحيد المتاح: زر «اشترك الآن»
 *   - يفتح PricingView بداخله
 *
 * يُعرض تلقائياً عندما يُرجِع /api/subscription/status قيمة isExpired=true.
 *
 * FIX-P3-P5-P6 (Group P3 — Fix 3):
 *   - تمت إزالة زر الإغلاق (X) بالكامل
 *   - تمت إزالة حالة `dismissed` — المودال لا يُغلق إلا بالترقية
 *   - لا يزال الـ `onResolved` callback مدعوماً لكنه يُستدعى فقط بعد نجاح
 *     الـ checkout (وهي الطريقة الوحيدة لإغلاق المودال)
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { PricingView } from './PricingView';

interface TrialExpiredModalProps {
  /** هل انتهت فترة التجربة المجانية؟ (يأتي من /api/subscription/status) */
  isExpired: boolean;
  /** callback بعد نجاح عملية الدفع (يغلق المودال) */
  onResolved?: () => void;
}

export function TrialExpiredModal({ isExpired, onResolved }: TrialExpiredModalProps) {
  // إن لم تكن فترة التجربة منتهية، يبقى المودال مخفياً
  if (!isExpired) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-expired-title"
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl border border-border">
        {/* شريط تنبيه أعلى المودال — لا يوجد زر إغلاق، المودال لا يُغلق إلا بالترقية */}
        <div className="sticky top-0 z-[5] bg-amber-500/10 border-b border-amber-500/20 p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <h2 id="trial-expired-title" className="text-lg font-bold text-foreground">
              انتهت فترة التجربة المجانية
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            انتهت فترة التجربة المجانية (7 أيام). اشترك الآن للاستمرار في استخدام
            المنصة بكامل مزاياها.
          </p>
        </div>

        {/* عرض الباقات داخل المودال — الطريقة الوحيدة للخروج */}
        <PricingView
          asModal
          onCheckoutSuccess={(iframeUrl) => {
            // فتح Paymob iframe في نفس الصفحة
            window.location.href = iframeUrl;
            // بعد أن يُكمل المستخدم الدفع بنجاح، تقوم صفحة نجاح الدفع
            // بإعادة التحميل وتفعيل الاشتراك — فيُعاد التحقق من حالة
            // التجربة ولن يظهر المودال. الـ onResolved اختياري.
            onResolved?.();
          }}
        />
      </div>
    </div>
  );
}
