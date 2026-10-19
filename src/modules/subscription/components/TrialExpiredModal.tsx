'use client';

/**
 * TrialExpiredModal — RESTRUCT-A-P3: soft paywall (dismissable + CTA)
 * ====================================================================
 * يظهر عند انتهاء فترة التجربة المجانية (14 يوماً). soft paywall:
 *   - modal overlay (مش fullscreen block)
 *   - فيه زر إغلاق (X) — المستخدم يقدر يـ dismiss + يكمل تصفّح محدود
 *   - CTA أساسي: "اشترك الآن" (يفتح subscription view)
 *   - CTA ثانوي: "لاحقاً" (يـ dismiss)
 *
 * يتـ trigger من:
 *   1. /api/subscription/status isExpired=true (عبر page.tsx AppShell)
 *   2. api-client 402 trial_expired → PaywallListener (soft)
 *
 * RESTRUCT-A-P3: كان hard block (مفيش X). دلوقتي soft per CEO directive.
 * TRIAL_DAYS = 14 (A-P2.5 canonical).
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, X, Crown, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { TRIAL_DAYS } from '@/lib/subscription-gate';
import { PricingView } from './PricingView';

interface TrialExpiredModalProps {
  /** هل انتهت فترة التجربة المجانية؟ */
  isExpired: boolean;
  /** callback بعد نجاح عملية الدفع (يغلق المودال) */
  onResolved?: () => void;
  /** لو true → hard mode (مفيش dismiss) — للـ page.tsx block القديم. default: false (soft). */
  hardBlock?: boolean;
}

export function TrialExpiredModal({ isExpired, onResolved, hardBlock = false }: TrialExpiredModalProps) {
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const [dismissed, setDismissed] = useState(false);

  // soft mode: لو dismissed → اختفى. hard mode: مفيش dismiss.
  if (!isExpired) return null;
  if (hardBlock) {
    // hard block mode (legacy page.tsx usage) — يحتفظ بسلوكه القديم.
    return <HardTrialBlock onResolved={onResolved} />;
  }
  if (dismissed) return null;

  const goSubscribe = () => {
    setDismissed(true);
    setCurrentView('subscription');
    onResolved?.();
  };

  const dismiss = () => {
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-expired-soft-title"
      >
        <motion.div
          initial={{ scale: 0.95, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 10 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          className="relative w-full max-w-md bg-background rounded-2xl shadow-2xl border border-border overflow-hidden"
        >
          {/* Close button (soft — dismissable) */}
          <button
            type="button"
            onClick={dismiss}
            aria-label="إغلاق"
            className="absolute top-3 left-3 z-20 size-9 rounded-full bg-background/70 backdrop-blur border border-border/60 text-muted-foreground hover:text-foreground hover:bg-background transition-colors flex items-center justify-center"
          >
            <X className="size-4" />
          </button>

          {/* Header */}
          <div className="bg-gradient-to-br from-warning via-warning to-profit px-6 pt-7 pb-6 text-center text-white">
            <div className="inline-flex items-center justify-center mb-3 size-14 rounded-2xl bg-white/15 ring-4 ring-white/25 backdrop-blur">
              <Clock className="size-7" />
            </div>
            <h2 id="trial-expired-soft-title" className="text-xl font-extrabold tracking-tight">
              انتهت فترة التجربة المجانية
            </h2>
            <p className="text-sm text-white/90 mt-1.5">
              انتهت فترة التجربة المجانية ({TRIAL_DAYS} يوماً). اشترك الآن للاستمرار في استخدام
              المنصة بكامل مزاياها — أو تصفّح المحتوى المحدود.
            </p>
          </div>

          {/* Body */}
          <div className="px-6 py-5 bg-background space-y-4">
            <div className="rounded-lg bg-warning/5 border border-warning/20 p-3 flex items-start gap-2.5">
              <AlertCircle className="size-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                الوصول الكامل (التوقعات المتقدمة، التحليل اللحظي، المحفظة) بيتطلب اشتراك نشط.
                تقدر تكمل تصفّح السوق والأخبار مجاناً، أو اشترك لفتح كل المزايا.
              </p>
            </div>

            {/* CTAs */}
            <div className="space-y-2">
              <Button
                onClick={goSubscribe}
                size="lg"
                className="w-full h-11 text-base font-bold bg-gradient-to-r from-warning to-profit hover:from-warning hover:to-profit text-white shadow-md gap-2"
              >
                <Crown className="size-5" />
                اشترك الآن
              </Button>
              <Button
                onClick={dismiss}
                size="lg"
                variant="outline"
                className="w-full h-11 text-base font-semibold"
              >
                تصفّح المحتوى المحدود
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================================================
// Hard block variant — للـ page.tsx usage القديم (hardBlock prop).
// يحافظ على سلوك "no close" الأصلي (مش بيتستخدم في A-P3 default path).
// ============================================================================

function HardTrialBlock({ onResolved }: { onResolved?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-expired-hard-title"
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl border border-border">
        <div className="sticky top-0 z-[5] bg-warning/10 border-b border-warning/20 p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <AlertCircle className="w-5 h-5 text-warning" />
            <h2 id="trial-expired-hard-title" className="text-lg font-bold text-foreground">
              انتهت فترة التجربة المجانية
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            انتهت فترة التجربة المجانية ({TRIAL_DAYS} يوماً). اشترك الآن للاستمرار في استخدام
            المنصة بكامل مزاياها.
          </p>
        </div>
        <PricingView
          asModal
          onCheckoutSuccess={(iframeUrl: string) => {
            window.location.href = iframeUrl;
            onResolved?.();
          }}
        />
      </div>
    </div>
  );
}
