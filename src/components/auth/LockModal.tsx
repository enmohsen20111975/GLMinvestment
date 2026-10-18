'use client';

/**
 * LockModal — modal بسيط للمحتوى المقفول
 * ====================================================================
 * TASK-LANDING: لما المستخدم يضغط على حاجة مقفولة → يطلعله modal:
 * "سجّل عشان تشوف التفاصيل الكاملة + تبدأ التجربة المحدودة"
 *
 * Rule 27: لا أرقام وهمية
 * Rule 30: Emerald + Amber (ممنوع أزرق)
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface LockModalProps {
  open: boolean;
  onClose: () => void;
  onSignUp: () => void;
  /** عنوان المحتوى المقفول (مثلاً: "تفاصيل رادار الحيتان") */
  lockedItem?: string;
}

export function LockModal({ open, onClose, onSignUp, lockedItem }: LockModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Lock className="w-4 h-4 text-amber-500" />
            محتوى محمي
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {lockedItem ? `"${lockedItem}"` : 'هذا المحتوى'} متاح للمسجلين فقط
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {/* رسالة واضحة */}
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 text-center">
            <p className="text-sm font-semibold text-foreground">
              سجّل عشان تشوف التفاصيل الكاملة + تبدأ التجربة المحدودة
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              تجربة محدودة 3 أيام · 5 إشارات رادار + 3 توقعات يومية في اليوم
            </p>
          </div>

          {/* مزايا سريعة */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5 rounded-md bg-muted/40 p-2">
              <Sparkles className="w-3 h-3 text-emerald-500 shrink-0" />
              <span>تفاصيل كاملة (دخول/وقف/هدف)</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-muted/40 p-2">
              <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
              <span>الأدلة والبراهين</span>
            </div>
          </div>

          {/* أزرار */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="flex-1"
            >
              لاحقاً
            </Button>
            <Button
              size="sm"
              onClick={onSignUp}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              سجّل مجاناً – تجربة محدودة
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
