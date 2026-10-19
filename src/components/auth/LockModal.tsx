'use client';

/**
 * LockModal + LockedContent — RESTRUCT-A-P3
 * ====================================================================
 * LockModal: modal بسيط للمحتوى المقفول. يدعم 2 modes:
 *   - variant='guest': "سجّل مجاناً" (للـ guests اللي محتاجين تسجيل)
 *   - variant='upgrade': "ترقية" (للـ registered اللي محتاجين tier أعلى)
 *
 * LockedContent: blur overlay للمحتوى المقفول جوّه view.
 *   - بيـ blur المحتوى + يعرض CTA "ترقية" أو "سجّل".
 *   - للاستخدام في MakerRadarTab + SpecialistAnalysisView + التقارير.
 *
 * Rule 27: لا أرقام وهمية.
 * Rule 30: Emerald + Amber (ممنوع أزرق).
 * Rule 73: SINGLE-DISPLAY-SOURCE (نص TRIAL_DAYS جاي من subscription-gate).
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, X, Sparkles, Crown, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { TRIAL_DAYS } from '@/lib/subscription-gate';

// ============================================================================
// LockModal
// ============================================================================

interface LockModalProps {
  open: boolean;
  onClose: () => void;
  /** guest: "سجّل مجاناً" | upgrade: "ترقية" */
  variant?: 'guest' | 'upgrade';
  /** للـ guest: onSignUp (يفتح AuthView). للـ upgrade: onUpgrade (يفتح subscription). */
  onSignUp?: () => void;
  onUpgrade?: () => void;
  /** عنوان المحتوى المقفول (مثلاً: "تفاصيل رادار الحيتان"). */
  lockedItem?: string;
  /** الـ tier المطلوب (لـ upgrade mode). مثلاً: "premium". */
  requiredTier?: string;
}

export function LockModal({
  open,
  onClose,
  variant = 'guest',
  onSignUp,
  onUpgrade,
  lockedItem,
  requiredTier,
}: LockModalProps) {
  const isUpgrade = variant === 'upgrade';

  const primaryAction = isUpgrade ? onUpgrade : onSignUp;
  const primaryLabel = isUpgrade ? 'ترقية الاشتراك' : 'سجّل مجاناً';
  const primaryIcon = isUpgrade ? Crown : Lock;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Lock className="w-4 h-4 text-warning" />
            {isUpgrade ? 'محتوى يتطلب ترقية' : 'محتوى محمي'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {lockedItem
              ? `"${lockedItem}" متاح${isUpgrade ? ' في باقة أعلى' : ' للمسجلين فقط'}`
              : isUpgrade
                ? 'هذا المحتوى يتطلب باقة اشتراك أعلى'
                : 'هذا المحتوى متاح للمسجلين فقط'}
            {isUpgrade && requiredTier ? ` (${requiredTier})` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {/* رسالة واضحة */}
          <div className="rounded-lg bg-profit/5 border border-profit/20 p-3 text-center">
            <p className="text-sm font-semibold text-foreground">
              {isUpgrade
                ? 'رقّي اشتراكك لفتح التحليلات المتقدمة + التوقعات اللحظية'
                : `سجّل عشان تشوف التفاصيل الكاملة + تبدأ تجربة ${TRIAL_DAYS} يوماً مجاناً`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {isUpgrade
                ? 'باقات أعلى → تحليلات لحظية + توقعات متقدمة + backtest'
                : `تجربة ${TRIAL_DAYS} يوماً · 5 إشارات رادار + 3 توقعات يومية في اليوم`}
            </p>
          </div>

          {/* مزايا سريعة */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5 rounded-md bg-muted/40 p-2">
              <Sparkles className="w-3 h-3 text-profit shrink-0" />
              <span>تفاصيل كاملة (دخول/وقف/هدف)</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-muted/40 p-2">
              <TrendingUp className="w-3 h-3 text-warning shrink-0" />
              <span>الأدلة والبراهين</span>
            </div>
          </div>

          {/* أزرار */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
              لاحقاً
            </Button>
            <Button
              size="sm"
              onClick={primaryAction}
              className={
                isUpgrade
                  ? 'flex-1 bg-warning hover:bg-warning text-white gap-1.5'
                  : 'flex-1 bg-profit hover:bg-profit text-white gap-1.5'
              }
            >
              {React.createElement(primaryIcon, { className: 'w-3.5 h-3.5' })}
              {primaryLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// LockedContent — blur overlay للمحتوى المقفول جوّه view
// ============================================================================

interface LockedContentProps {
  /** المحتوى المقفول (هيـ blur). */
  children?: React.ReactNode;
  /** الـ feature المقفول (مثلاً: "رادار الحيتان اللحظي"). */
  feature?: string;
  /** guest: "سجّل" | upgrade: "ترقية". */
  variant?: 'guest' | 'upgrade';
  /** required tier للـ upgrade. */
  requiredTier?: string;
  /** onSignUp / onUpgrade. */
  onSignUp?: () => void;
  onUpgrade?: () => void;
  /** ارتفاع الـ overlay (default: min-h-[280px]). */
  className?: string;
}

export function LockedContent({
  children,
  feature,
  variant = 'guest',
  requiredTier,
  onSignUp,
  onUpgrade,
  className,
}: LockedContentProps) {
  const isUpgrade = variant === 'upgrade';
  const action = isUpgrade ? onUpgrade : onSignUp;
  const label = isUpgrade ? 'ترقية' : 'سجّل مجاناً';
  const Icon = isUpgrade ? Crown : Lock;

  return (
    <div className={`relative ${className || 'min-h-[280px]'}`}>
      {/* Blurred content behind (لو موجود) */}
      {children && (
        <div aria-hidden className="pointer-events-none select-none blur-md opacity-50">
          {children}
        </div>
      )}
      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          className="max-w-sm w-full rounded-xl bg-background/95 backdrop-blur border border-border shadow-lg p-4 text-center"
          dir="rtl"
        >
          <div className="inline-flex items-center justify-center mb-2 size-10 rounded-xl bg-warning/10 ring-2 ring-warning/20">
            <Icon className="size-5 text-warning" />
          </div>
          <p className="text-sm font-semibold text-foreground">
            {feature ? `"${feature}"` : 'هذا المحتوى'}
            {isUpgrade ? ' يتطلب ترقية' : ' متاح للمسجلين'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            {isUpgrade
              ? `باقة ${requiredTier || 'أعلى'} مطلوبة لفتح هذا المحتوى`
              : `سجّل مجاناً — تجربة ${TRIAL_DAYS} يوماً`}
          </p>
          <Button
            size="sm"
            onClick={action}
            className={
              isUpgrade
                ? 'bg-warning hover:bg-warning text-white gap-1.5'
                : 'bg-profit hover:bg-profit text-white gap-1.5'
            }
          >
            <Icon className="size-3.5" />
            {label}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
