'use client';

/**
 * LoginPromptModal (Task 13)
 * --------------------------
 * Engaging modal that motivates visitors to register (free) before
 * accessing protected features (stock details, predictions, portfolio,
 * watchlist, alerts, ai-chat, learning, reports…).
 *
 * Visuals:
 *  - Platform logo (logo-square.png)
 *  - Title: "سجّل مجاناً للوصول الكامل"
 *  - Feature checklist (5 perks)
 *  - Two CTAs: "سجّل مجاناً" (primary) and "دخول" (outline)
 *  - Close button (X) — requires confirmation via AlertDialog
 *
 * Colours: amber + emerald (no indigo/blue) per design brief.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sparkles,
  TrendingUp,
  BarChart3,
  Wallet,
  Bell,
  Eye,
  CheckCircle2,
  UserPlus,
  LogIn,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const FEATURES = [
  {
    icon: TrendingUp,
    title: 'توقعات يومية ذكية',
    desc: 'توقعات مالية وفنية متقدمة لكل سوق',
    color: 'text-emerald-600',
  },
  {
    icon: BarChart3,
    title: 'تحليلات فنية متقدمة',
    desc: 'مؤشرات RSI، MACD، أنماط الشموع، فيبوناتشي',
    color: 'text-amber-600',
  },
  {
    icon: Wallet,
    title: 'متابعة المحفظة',
    desc: 'أسهم، ذهب، شهادات، عملات رقمية',
    color: 'text-emerald-600',
  },
  {
    icon: Bell,
    title: 'تنبيهات الأسعار',
    desc: 'تنبيهات فورية عند وصول السعر للهدف',
    color: 'text-amber-600',
  },
  {
    icon: Eye,
    title: 'قوائم المراقبة',
    desc: 'تابع أسهمك المفضلة في مكان واحد',
    color: 'text-emerald-600',
  },
] as const;

export function LoginPromptModal() {
  const showLoginPrompt = useAppStore((s) => s.showLoginPrompt);
  const setShowLoginPrompt = useAppStore((s) => s.setShowLoginPrompt);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const [confirmClose, setConfirmClose] = useState(false);

  const goRegister = () => {
    setShowLoginPrompt(false);
    setCurrentView('auth');
    // Hint to AuthView to open the register tab
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('auth_initial_tab', 'register');
      } catch {
        /* ignore */
      }
    }
  };

  const goLogin = () => {
    setShowLoginPrompt(false);
    setCurrentView('auth');
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('auth_initial_tab', 'login');
      } catch {
        /* ignore */
      }
    }
  };

  const requestClose = () => {
    // Require confirmation — keeps the upgrade funnel warm.
    setConfirmClose(true);
  };

  return (
    <>
      <Dialog
        open={showLoginPrompt}
        onOpenChange={(open) => {
          if (!open) requestClose();
          else setShowLoginPrompt(true);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-md overflow-hidden p-0 gap-0"
        >
          <DialogTitle className="sr-only">سجّل مجاناً للوصول الكامل</DialogTitle>
          <DialogDescription className="sr-only">
            أنشئ حساباً مجانياً للوصول إلى كل المميزات
          </DialogDescription>

          {/* Close button (custom, requires confirmation) */}
          <button
            type="button"
            onClick={requestClose}
            aria-label="إغلاق"
            className="absolute top-3 left-3 z-20 size-9 rounded-full bg-background/70 backdrop-blur border border-border/60 text-muted-foreground hover:text-foreground hover:bg-background transition-colors flex items-center justify-center"
          >
            <X className="size-4" />
          </button>

          {/* Gradient header */}
          <div className="relative bg-gradient-to-br from-amber-500 via-amber-600 to-emerald-600 px-6 pt-7 pb-6 text-center text-white">
            <div className="absolute inset-0 opacity-20 pointer-events-none">
              <div className="absolute -top-10 -right-10 size-40 rounded-full bg-white blur-3xl" />
              <div className="absolute -bottom-10 -left-10 size-40 rounded-full bg-emerald-200 blur-3xl" />
            </div>

            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 18 }}
              className="relative inline-flex items-center justify-center mb-3"
            >
              <div className="size-20 rounded-2xl bg-white/15 ring-4 ring-white/30 backdrop-blur flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-square.png"
                  alt="دليل الاستثمار"
                  className="size-16 object-contain"
                />
              </div>
            </motion.div>

            <motion.p
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.05 }}
              className="relative text-xl font-extrabold tracking-tight"
            >
              سجّل مجاناً للوصول الكامل
            </motion.p>

            <motion.p
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="relative text-sm text-white/90 mt-1"
            >
              منصة «دليل الاستثمار» — كل أدوات الاستثمار الذكية في مكان واحد
            </motion.p>

            <div className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <Sparkles className="size-3.5" />
              مجاني للأبد — بدون بطاقة ائتمان
            </div>
          </div>

          {/* Features list */}
          <div className="px-6 py-5 bg-background">
            <ul className="space-y-2.5">
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <motion.li
                    key={f.title}
                    initial={{ x: -10, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.05 + i * 0.05 }}
                    className="flex items-start gap-3"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted',
                        f.color
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                        {f.title}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                    </div>
                  </motion.li>
                );
              })}
            </ul>
          </div>

          {/* CTA footer */}
          <div className="px-6 pb-6 pt-1 bg-background space-y-2">
            <Button
              onClick={goRegister}
              size="lg"
              className="w-full h-11 text-base font-bold bg-gradient-to-r from-amber-500 to-emerald-600 hover:from-amber-600 hover:to-emerald-700 text-white shadow-md"
            >
              <UserPlus className="size-5" />
              سجّل مجاناً
            </Button>
            <Button
              onClick={goLogin}
              size="lg"
              variant="outline"
              className="w-full h-11 text-base font-semibold border-amber-500/40 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40"
            >
              <LogIn className="size-5" />
              دخول
            </Button>
            <p className="text-center text-[11px] text-muted-foreground pt-1">
              بالتسجيل، أنت توافق على شروط الاستخدام وسياسة الخصوصية
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close confirmation */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إغلاق نافذة التسجيل؟</AlertDialogTitle>
            <AlertDialogDescription>
              ستفوت عليك الوصول إلى التوقعات والتحليلات والمحفظة. سنبقى نذكرك كل فترة
              بإمكانية التسجيل المجاني.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>أكمل بدون تسجيل</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => setConfirmClose(false)}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              متابعة التسجيل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AnimatePresence kept for future exit animations */}
      <AnimatePresence />
    </>
  );
}
