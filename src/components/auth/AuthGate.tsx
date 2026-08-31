'use client';

/**
 * AuthGate (Task 13)
 * ------------------
 * Client-side gate that nudges unauthenticated visitors to register.
 *
 * Behaviour:
 *  1. Renders a sticky top banner: "سجّل الدخول للوصول إلى المزايا الكاملة".
 *  2. Every 30s, fires a Sonner toast reminding the user to register
 *     (only once at a time, only when the tab is visible, and only if the
 *     user is not authenticated).
 *  3. Watches `currentView`. If an unauthenticated user navigates to a
 *     protected view (portfolio, watchlist, predictions, stock-detail,
 *     alerts, ai-chat, learning, reports, …) we redirect them back to
 *     `dashboard` and open the LoginPromptModal.
 *  4. Hosts the <LoginPromptModal /> itself so any `setShowLoginPrompt(true)`
 *     call (e.g. from `requireAuth()`) Just Works.
 *
 * Colours: amber + emerald (no indigo/blue).
 */

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Sparkles, X, Rocket, Clock, AlertTriangle, Crown } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useAuthCheck } from '@/hooks/useAuthCheck';
import { getTrialStatus } from '@/lib/subscription-gate';
import { LoginPromptModal } from '@/components/auth/LoginPromptModal';
import { Button } from '@/components/ui/button';
import type { AppView } from '@/types';

const REMINDER_INTERVAL_MS = 1_800_000; // 30 minutes — was 5 min (too naggy)

/**
 * Views that REQUIRE authentication or an active subscription.
 *
 * NOTE (FIX Aug 2026): 'recommendations' and 'analysis' were REMOVED from
 * the protected list so that the #recommendations hash route is PUBLIC.
 * Visitors (including new users who haven't signed up) must be able to see
 * the recommendations/predictions page directly — this is the main landing
 * traffic driver. Blocking it with a login prompt was killing conversions.
 * The recommendations view itself limits unauthenticated users to 3 items
 * (enforced server-side in /api/predictions), so the nudge to register
 * still exists without hard-blocking the page.
 */
const PROTECTED_VIEWS: ReadonlySet<AppView> = new Set<AppView>([
  'stock-detail',
  'portfolio',
  'advanced-portfolio',
  'watchlist',
  'advanced-analysis',
  'unified-analysis',
  'specialist-analysis',
  'prediction-performance',
  'prediction-credibility',
  'seasonality',
  'reports',
  'learning',
  'simulation',
  'alerts-center',
  'trading-memory',
  'trading-journal',
  'publishing',
  'crypto-detail',
  'crypto-portfolio',
  'crypto-watchlist',
  'crypto-recommendations',
  'crypto-analysis',
  'crypto-learning',
  'crypto-simulation',
  'settings',
  'admin',
  // Hidden/legacy analytic views
  'finance',
  'backtesting',
  'ai-analysis',
  'v2-analysis',
] as AppView[]);

function isProtected(view: AppView): boolean {
  return PROTECTED_VIEWS.has(view);
}

function AuthGateBanner() {
  const setShowLoginPrompt = useAppStore((s) => s.setShowLoginPrompt);
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -24, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className="sticky top-0 z-40 w-full"
    >
      <div className="relative bg-gradient-to-l from-amber-500 via-amber-600 to-emerald-600 text-white shadow-md">
        <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-3">
          <span className="hidden sm:inline-flex size-7 items-center justify-center rounded-full bg-white/20">
            <Rocket className="size-4" />
          </span>
          <p className="flex-1 text-sm sm:text-base font-semibold leading-tight">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 inline sm:hidden" />
              سجّل الدخول للوصول إلى المزايا الكاملة
            </span>
            <span className="hidden sm:inline mr-2 text-white/85 font-normal">
              — توقعات ذكية، تحليلات متقدمة، ومتابعة محفظتك في مكان واحد
            </span>
          </p>
          <Button
            onClick={() => setShowLoginPrompt(true)}
            size="sm"
            className="h-8 px-4 bg-white text-amber-700 hover:bg-white/90 font-bold shadow-sm"
          >
            سجّل الآن
          </Button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="إغلاق"
            className="size-7 inline-flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function TrialWarningBanner({ daysLeft }: { daysLeft: number }) {
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -24, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className="sticky top-0 z-40 w-full"
    >
      <div className="relative bg-gradient-to-l from-amber-600 via-amber-700 to-emerald-700 text-white shadow-md">
        <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-3">
          <span className="hidden sm:inline-flex size-7 items-center justify-center rounded-full bg-white/20">
            <Clock className="size-4 animate-pulse" />
          </span>
          <p className="flex-1 text-sm sm:text-base font-semibold leading-tight">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="size-4 text-amber-200" />
              ⏳ متبقي لديك {daysLeft} يوماً في فترتك التجريبية المجانية (من أصل 30 يوماً)
            </span>
            <span className="hidden sm:inline mr-2 text-white/85 font-normal">
              — اشترك الآن للاستمرار في استخدام المنصة دون انقطاع
            </span>
          </p>
          <Button
            onClick={() => setCurrentView('subscription')}
            size="sm"
            className="h-8 px-4 bg-white text-amber-800 hover:bg-white/90 font-bold shadow-sm flex items-center gap-1.5"
          >
            <Crown className="size-3.5 text-amber-600" />
            اشترك الآن
          </Button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="إغلاق"
            className="size-7 inline-flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function TrialExpiredBanner({ daysLeft = 0 }: { daysLeft?: number }) {
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const isWarning = daysLeft > 0;
  const message = isWarning
    ? `❌ انتهت فترتك التجريبية المجانية (30 يوماً). ستتم حذف بياناتك بعد ${daysLeft} يوم — يرجى الاشتراك الآن`
    : '❌ انتهت فترتك التجريبية المجانية وتم حذف بياناتك. يرجى الاشتراك مرة أخرى';

  return (
    <motion.div
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -24, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className="sticky top-0 z-40 w-full"
    >
      <div className="relative bg-gradient-to-l from-red-600 via-rose-700 to-red-800 text-white shadow-lg border-b border-red-500">
        <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center gap-3">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-white/20">
            <AlertTriangle className="size-4 text-red-200 animate-bounce" />
          </span>
          <p className="flex-1 text-sm sm:text-base font-bold leading-tight">
            <span>{message}</span>
            <span className="hidden sm:inline mr-2 text-white/90 font-normal">
              — يرجى الاشتراك في إحدى الخطط لمتابعة الاستفادة من الخدمات
            </span>
          </p>
          <Button
            onClick={() => setCurrentView('subscription')}
            size="sm"
            className="h-8 px-4 bg-white text-red-700 hover:bg-white/90 font-bold shadow-sm flex items-center gap-1.5"
          >
            <Crown className="size-3.5 text-red-600" />
            اختر خطتك للاشتراك
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  useAuthCheck();

  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const authChecked = useAppStore((s) => s.authChecked);
  const user = useAppStore((s) => s.user);
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setShowLoginPrompt = useAppStore((s) => s.setShowLoginPrompt);

  const trialStatus = getTrialStatus(user);

  // Track whether the user just got bounced
  const lastBouncedView = useRef<AppView | null>(null);

  // 1. Unauthenticated Route Guard: bounce unauthenticated visitors off protected views
  useEffect(() => {
    if (!authChecked) return;
    if (isAuthenticated && user) return;
    if (!isProtected(currentView)) return;
    if (currentView === 'auth') return;

    if (lastBouncedView.current === currentView) return;
    lastBouncedView.current = currentView;

    setShowLoginPrompt(true);
    setCurrentView('dashboard');

    toast.warning('هذه الصفحة تتطلب تسجيل الدخول', {
      description: 'سجّل مجاناً للوصول إلى كل المميزات',
      duration: 4000,
    });

    const t = setTimeout(() => {
      lastBouncedView.current = null;
    }, 1500);
    return () => clearTimeout(t);
  }, [authChecked, isAuthenticated, user, currentView, setCurrentView, setShowLoginPrompt]);

  // 2. Expired Trial Guard: bounce free users whose trial has expired (after 7-day warning) to subscription view
  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthenticated || !user) return;
    if (!trialStatus.isExpiredAndDeletionPending) return;
    if (currentView === 'subscription' || currentView === 'settings' || currentView === 'zakat' || currentView === 'tithes' || currentView === 'auth') return;

    if (lastBouncedView.current === currentView) return;
    lastBouncedView.current = currentView;

    setCurrentView('subscription');

    toast.error('انتهت فترتك التجريبية', {
      description: 'يرجى اختيار باقة للاشتراك لمتابعة استخدام المنصة والخدمات',
      duration: 6000,
    });

    const t = setTimeout(() => {
      lastBouncedView.current = null;
    }, 1500);
    return () => clearTimeout(t);
  }, [authChecked, isAuthenticated, user, trialStatus.isExpiredAndDeletionPending, currentView, setCurrentView]);

  // Periodic reminder toast — every 30 mins while unauthenticated.
  // NOTE: The initial 8-second reminder was REMOVED because it was too
  // aggressive and caused the "login prompt keeps appearing" complaint.
  // Now the first reminder only fires after 30 minutes, and only if the
  // tab is visible. Users who are mid-session won't be interrupted.
  useEffect(() => {
    if (!authChecked) return;
    if (isAuthenticated && user) return;

    let interval: ReturnType<typeof setInterval> | undefined;

    const fireReminder = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (useAppStore.getState().showLoginPrompt) return;

      toast.info('سجل دخولك مجاناً للوصول لكل المميزات', {
        description: 'توقعات، تحليلات، محفظة، تنبيهات والمزيد',
        duration: 5000,
        action: {
          label: 'سجّل الآن',
          onClick: () => useAppStore.getState().setShowLoginPrompt(true),
        },
      });
    };

    // First reminder after 30 minutes (was 8 seconds — too aggressive)
    const firstTimeout = setTimeout(fireReminder, REMINDER_INTERVAL_MS);
    interval = setInterval(fireReminder, REMINDER_INTERVAL_MS);

    return () => {
      clearTimeout(firstTimeout);
      if (interval) clearInterval(interval);
    };
  }, [authChecked, isAuthenticated, user]);

  const showUnauthBanner = authChecked && (!isAuthenticated || !user);
  const showTrialWarningBanner = authChecked && isAuthenticated && user && trialStatus.isFreeUser && trialStatus.isInTrial;
  const showTrialExpiredBanner = authChecked && isAuthenticated && user && trialStatus.isFreeUser && trialStatus.isInWarning;
  const showTrialDeletionBanner = authChecked && isAuthenticated && user && trialStatus.isFreeUser && trialStatus.isExpiredAndDeletionPending;

  return (
    <>
      <AnimatePresence>
        {showUnauthBanner && <AuthGateBanner />}
        {showTrialWarningBanner && <TrialWarningBanner daysLeft={trialStatus.daysLeft} />}
        {showTrialExpiredBanner && <TrialExpiredBanner daysLeft={trialStatus.warningDaysLeft} />}
        {showTrialDeletionBanner && <TrialExpiredBanner daysLeft={0} />}
      </AnimatePresence>
      {children}
      <LoginPromptModal />
    </>
  );
}
