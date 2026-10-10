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

import React, { useState } from 'react';
import { AlertCircle, Tag, CheckCircle2, Loader2, LogOut } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { PricingView } from './PricingView';

interface TrialExpiredModalProps {
  /** هل انتهت فترة التجربة المجانية؟ (يأتي من /api/subscription/status) */
  isExpired: boolean;
  /** callback بعد نجاح عملية الدفع (يغلق المودال) */
  onResolved?: () => void;
}

export function TrialExpiredModal({ isExpired, onResolved }: TrialExpiredModalProps) {
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [promoSuccess, setPromoSuccess] = useState('');

  // إن لم تكن فترة التجربة منتهية، يبقى المودال مخفياً
  if (!isExpired) {
    return null;
  }

  const handleRedeemPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = promoCode.trim().toUpperCase();
    if (!code) {
      setPromoError('يرجى إدخال كود الخصم');
      return;
    }
    setPromoLoading(true);
    setPromoError('');
    setPromoSuccess('');

    try {
      const res = await fetch('/api/redeem-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPromoSuccess(data.message || 'تم تفعيل الكود وترقية اشتراكك بنجاح! جاري التحديث...');
        setTimeout(() => {
          onResolved?.();
          window.location.reload();
        }, 1500);
      } else {
        setPromoError(data.error || 'كود الخصم غير صحيح أو منتهي الصلاحية');
      }
    } catch {
      setPromoError('حدث خطأ أثناء تفعيل الكود، يرجى المحاولة مرة أخرى');
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-expired-title"
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl border border-border">
        {/* شريط تنبيه أعلى المودال مع خيار تسجيل الخروج */}
        <div className="sticky top-0 z-[5] bg-amber-500/10 border-b border-amber-500/20 p-4 text-center">
          <div className="flex items-center justify-between px-2">
            <div className="w-8" />
            <div className="flex items-center justify-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <h2 id="trial-expired-title" className="text-lg font-bold text-foreground">
                انتهت فترة التجربة المجانية
              </h2>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors p-1 rounded border border-border/50 bg-background/50 hover:bg-background"
              title="تسجيل الخروج"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>خروج</span>
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            انتهت فترة التجربة المجانية. اشترك الآن للاستمرار في استخدام المنصة، أو فعّل برومو كود إذا كان لديك.
          </p>
        </div>

        {/* قسم إدخال كود الخصم / البرومو كود */}
        <div className="m-4 p-4 rounded-xl border border-primary/20 bg-primary/5">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">
              هل لديك برومو كود أو كود هدية (Promo Code)؟
            </h3>
          </div>
          <form onSubmit={handleRedeemPromo} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="أدخل كود التفعيل هنا (مثال: LIVE-VIP)"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 uppercase font-mono"
              disabled={promoLoading}
            />
            <button
              type="submit"
              disabled={promoLoading || !promoCode.trim()}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {promoLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري التحقق...</span>
                </>
              ) : (
                <span>تفعيل الكود</span>
              )}
            </button>
          </form>

          {promoError && (
            <p className="text-xs text-rose-500 mt-2 font-medium">⚠️ {promoError}</p>
          )}
          {promoSuccess && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>{promoSuccess}</span>
            </div>
          )}
        </div>

        {/* عرض الباقات داخل المودال */}
        <PricingView
          asModal
          onCheckoutSuccess={(iframeUrl) => {
            window.location.href = iframeUrl;
            onResolved?.();
          }}
        />
      </div>
    </div>
  );
}
