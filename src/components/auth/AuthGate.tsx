'use client';

/**
 * AuthGate (Task 13)
 * ------------------
 * Client-side gate that nudges unauthenticated visitors to register.
 *
 * Behaviour:
 * 1. Renders a sticky top banner: "سجّل الدخول للوصول إلى المزايا الكاملة".
 * 2. Every 30s, fires a Sonner toast reminding the user to register
 * (only once at a time, only when the tab is visible, and only if the
 * user is not authenticated).
 * 3. Watches `currentView`. If an unauthenticated user navigates to a
 * protected view (portfolio, watchlist, predictions, stock-detail,
 * alerts, ai-chat, learning, reports, …) we redirect them back to
 * `dashboard` and open the LoginPromptModal.
 * 4. Hosts the <LoginPromptModal /> itself so any `setShowLoginPrompt(true)`
 * call (e.g. from `requireAuth()`) Just Works.
 *
 * Colours: amber + emerald (no indigo/blue).
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useSession } from '@/lib/next-auth-shim';
import { Sparkles, X, Rocket, Clock, AlertTriangle, Crown, Lock, KeyRound } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useAuthCheck } from '@/hooks/useAuthCheck';
import { getTrialStatus, TRIAL_DAYS } from '@/lib/subscription-gate';
import { LoginPromptModal } from '@/components/auth/LoginPromptModal';
import { Button } from '@/components/ui/button';
import { isAdmin as checkIsAdmin } from '@/lib/admin-auth';
import type { AppView } from '@/types';

const REMINDER_INTERVAL_MS = 1_800_000; // 30 minutes — was 5 min (too naggy)

/**
 * Arabic labels for the protected views so the redirect toast can tell the
 * user exactly which page they tried to access.
 */
const VIEW_LABEL_AR: Partial<Record<AppView, string>> = {
 'stock-detail': 'تفاصيل السهم',
 'portfolio': 'المحفظة الموحدة',
 'advanced-portfolio': 'المحفظة المتقدمة',
 'watchlist': 'قوائم المراقبة',
 'advanced-analysis': 'التحليل المتقدم',
 'specialist-analysis': 'تحليل المتخصصين',
 'prediction-performance': 'أداء التوقعات',
 'prediction-credibility': 'مصداقية التوقعات',
 'seasonality': 'الموسمية',
 'reports': 'التقارير',
 'simulation': 'المحاكاة',
 'academy': 'الأكاديمية',
 'alerts-center': 'مركز التنبيهات',
 'trading-memory': 'ذاكرة التداول',
 'trading-journal': 'يوميات التداول',
 'publishing': 'النشر',
 'crypto-detail': 'تفاصيل العملة الرقمية',
 'crypto-portfolio': 'محفظة العملات الرقمية',
 'crypto-watchlist': 'قوائم مراقبة العملات',
 'crypto-recommendations': 'توقعات العملات الرقمية',
 'crypto-analysis': 'تحليل العملات الرقمية',
 'crypto-learning': 'تعلّم العملات الرقمية',
 'crypto-simulation': 'محاكاة العملات الرقمية',
 'settings': 'الإعدادات',
 'finance': 'التمويل',
 'backtesting': 'الاختبار الراجع',
 'ai-analysis': 'التحليل بالذكاء الاصطناعي',
 'v2-analysis': 'تحليل متقدم',
};

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
 'simulation',
 // 'academy' removed — education should be PUBLIC (Task 29 — owner directive 'محتاج شغل كتير جدا')
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
 // Hidden/legacy analytic views
 'finance',
 'backtesting',
 'ai-analysis',
 'v2-analysis',
] as AppView[]);

// ADMIN_VIEWS — شاشات الأدمن فقط (قاعدة 30 + قاعدة 32).
// أي مستخدم مش أدمن بيت bounced للداشبورد. مش بيعرضها AuthGateBanner.
const ADMIN_VIEWS: ReadonlySet<AppView> = new Set<AppView>([
 'admin',
] as AppView[]);

function isProtected(view: AppView): boolean {
 return PROTECTED_VIEWS.has(view);
}

function isAdminView(view: AppView): boolean {
 return ADMIN_VIEWS.has(view);
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
 <div className="relative from-slate-700 via-slate-800 to-slate-900 text-foreground shadow-md">
 <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-3">
 <span className="hidden sm:inline-flex size-7 items-center justify-center rounded-full bg-white/15">
 <Lock className="size-4" />
 </span>
 <p className="flex-1 text-sm sm:text-base font-medium leading-tight">
 <span className="inline-flex items-center gap-1.5">
 <KeyRound className="size-3.5 inline sm:hidden" />
 سجّل الدخول للوصول إلى حسابك ومحفظتك
 </span>
 <span className="hidden sm:inline mr-2 text-foreground/70 font-normal">
 — توقعات، تحليلات، ومتابعة المحفظة
 </span>
 </p>
 <Button
 onClick={() => setShowLoginPrompt(true)}
 size="sm"
 className="h-8 px-4 bg-white text-slate-800 hover:bg-white/90 font-semibold shadow-sm"
 >
 تسجيل الدخول
 </Button>
 <button
 type="button"
 onClick={() => setDismissed(true)}
 aria-label="إغلاق"
 className="size-7 inline-flex items-center justify-center rounded-full text-foreground/70 hover:text-foreground hover:bg-white/15 transition-colors"
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
 <div className="relative from-warning via-warning to-profit text-foreground shadow-md">
 <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-3">
 <span className="hidden sm:inline-flex size-7 items-center justify-center rounded-full bg-white/20">
 <Clock className="size-4 animate-pulse" />
 </span>
 <p className="flex-1 text-sm sm:text-base font-semibold leading-tight">
 <span className="inline-flex items-center gap-1.5">
 <AlertTriangle className="size-4 text-warning" />
 ⏳ متبقي لديك {daysLeft} يوماً في فترتك التجريبية المجانية (من أصل {TRIAL_DAYS} يوماً)
 </span>
 <span className="hidden sm:inline mr-2 text-foreground/85 font-normal">
 — اشترك الآن للاستمرار في استخدام المنصة دون انقطاع
 </span>
 </p>
 <Button
 onClick={() => setCurrentView('subscription')}
 size="sm"
 className="h-8 px-4 bg-white text-warning hover:bg-white/90 font-bold shadow-sm flex items-center gap-1.5"
 >
 <Crown className="size-3.5 text-warning" />
 اشترك الآن
 </Button>
 <button
 type="button"
 onClick={() => setDismissed(true)}
 aria-label="إغلاق"
 className="size-7 inline-flex items-center justify-center rounded-full text-foreground/80 hover:text-foreground hover:bg-white/15 transition-colors"
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
 ? `❌ انتهت فترتك التجريبية المجانية (${TRIAL_DAYS} يوماً). ستتم حذف بياناتك بعد ${daysLeft} يوم — يرجى الاشتراك الآن`
 : '❌ انتهت فترتك التجريبية المجانية وتم حذف بياناتك. يرجى الاشتراك مرة أخرى';

 return (
 <motion.div
 initial={{ y: -24, opacity: 0 }}
 animate={{ y: 0, opacity: 1 }}
 exit={{ y: -24, opacity: 0 }}
 transition={{ type: 'spring', stiffness: 220, damping: 24 }}
 className="sticky top-0 z-40 w-full"
 >
 <div className="relative from-loss via-loss to-loss text-foreground shadow-lg border-b border-loss">
 <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center gap-3">
 <span className="inline-flex size-7 items-center justify-center rounded-full bg-white/20">
 <AlertTriangle className="size-4 text-loss animate-bounce" />
 </span>
 <p className="flex-1 text-sm sm:text-base font-bold leading-tight">
 <span>{message}</span>
 <span className="hidden sm:inline mr-2 text-foreground/90 font-normal">
 — يرجى الاشتراك في إحدى الخطط لمتابعة الاستفادة من الخدمات
 </span>
 </p>
 <Button
 onClick={() => setCurrentView('subscription')}
 size="sm"
 className="h-8 px-4 bg-white text-loss hover:bg-white/90 font-bold shadow-sm flex items-center gap-1.5"
 >
 <Crown className="size-3.5 text-loss" />
 اختر خطتك للاشتراك
 </Button>
 </div>
 </div>
 </motion.div>
 );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
 useAuthCheck();
 const { data: session } = useSession();

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

 // Guard against re-firing on the same view (prevents toast spam if the
 // hash navigation triggers the effect multiple times for the same view).
 if (lastBouncedView.current === currentView) return;
 lastBouncedView.current = currentView;

 const pageLabel = VIEW_LABEL_AR[currentView] || 'هذه الصفحة';

 toast.warning(`صفحة «${pageLabel}» تتطلب تسجيل الدخول`, {
 description: 'يرجى تسجيل الدخول أو إنشاء حساب مجاني للمتابعة.',
 duration: 5000,
 });

 // Open the LoginPromptModal so the user has a one-click path to register.
 setShowLoginPrompt(true);
 // UI-FIX (2026-09-30): preserve the URL hash so users can return after login.
 // Before: setCurrentView('dashboard') cleared the hash silently (confusing).
 // After: redirect to dashboard but keep the hash for post-login redirect.
 setCurrentView('dashboard');
 // Note: we DON'T clear window.location.hash — it stays as #portfolio etc.
 // so after login, the user lands back on the page they wanted.

 const t = setTimeout(() => {
 lastBouncedView.current = null;
 }, 1500);
 return () => clearTimeout(t);
 }, [authChecked, isAuthenticated, user, currentView, setCurrentView, setShowLoginPrompt]);

 // 1b. Admin-only Route Guard (قاعدة 30 + 32): شاشات الأدمن متاحة فقط للمديرين.
 // N4: لو المستخدم مش مسجّل دخول وضغط #admin → نطرده لـ auth (تسجيل دخول) مش dashboard.
 // لو مسجّل دخول وأدمن → نسيبه يفتح. لو مسجّل ومش أدمن → نطرده لـ dashboard.
 useEffect(() => {
 if (!authChecked) return;
 if (!isAdminView(currentView)) return;
 // AdminView handles its own direct credentials & session authentication
 if (currentView === 'admin') return;

 const u = user as Record<string, unknown> | null;
 const s = session?.user as Record<string, unknown> | null;
 const isAuthed = isAuthenticated || Boolean(s?.email || s?.name);

 // لو مش مسجّل دخول → نوجهه لتسجيل الدخول (مش dashboard)
 if (!isAuthed || (!u && !s)) {
 if (lastBouncedView.current === currentView) return;
 lastBouncedView.current = currentView;
 setShowLoginPrompt(true);
 setCurrentView('dashboard');
 toast.info('يرجى تسجيل الدخول للوصول إلى لوحة الإدارة', {
 duration: 4000,
 });
 const t = setTimeout(() => {
 lastBouncedView.current = null;
 }, 1500);
 return () => clearTimeout(t);
 }

 // مسجّل دخول → فحص شامل لصلاحيات الأدمن (حالة الاشتراك، علامة is_admin، الهوية)
 const userEmail = (u?.email as string) || (s?.email as string) || null;
 const userName = (u?.username as string) || (u?.name as string) || (s?.name as string) || null;

 const isUserAdmin =
 u?.is_admin === true ||
 u?.subscription_tier === 'admin' ||
 u?.subscription_tier === 'premium' ||
 s?.is_admin === true ||
 s?.subscription_tier === 'admin' ||
 (userName && ['mohseny', 'admin', 'enmohsen20111975'].includes(userName.toLowerCase())) ||
 (userEmail && ['mohseny@m2y.net', 'enmohsen20111975@gmail.com', 'enmohsen2011975@gmail.com', 'ceo@m2y.net'].includes(userEmail.toLowerCase())) ||
 checkIsAdmin(userEmail, userName) ||
 checkIsAdmin(userName, userEmail);

 if (!isUserAdmin) {
 if (lastBouncedView.current === currentView) return;
 lastBouncedView.current = currentView;
 setCurrentView('dashboard');
 toast.error('هذه الصفحة متاحة للمديرين فقط', {
 duration: 4000,
 });
 const t = setTimeout(() => {
 lastBouncedView.current = null;
 }, 1500);
 return () => clearTimeout(t);
 }
 }, [authChecked, isAuthenticated, user, session, currentView, setCurrentView, setShowLoginPrompt]);

 const [dismissedPaywall, setDismissedPaywall] = useState(false);

 useEffect(() => {
 const handleDismissEvent = () => {
 setDismissedPaywall(true);
 };
 if (typeof window !== 'undefined') {
 window.addEventListener('dismiss_subscription_view', handleDismissEvent);
 if (sessionStorage.getItem('dismissed_subscription_view') === 'true') {
 setDismissedPaywall(true);
 }
 }
 return () => {
 if (typeof window !== 'undefined') {
 window.removeEventListener('dismiss_subscription_view', handleDismissEvent);
 }
 };
 }, []);

 // 2. Expired Trial Guard: bounce free users whose trial has expired (after 7-day warning) to subscription view
 // Respect user dismissal so the screen does NOT stay stuck in their face if they want to log in or try basic views
 useEffect(() => {
 if (!authChecked) return;
 if (!isAuthenticated || !user) return;
 if (dismissedPaywall) return;
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
 }, [authChecked, isAuthenticated, user, trialStatus.isExpiredAndDeletionPending, currentView, setCurrentView, dismissedPaywall]);

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

 toast.info('سجّل الدخول للوصول إلى حسابك', {
 description: 'توقعات، تحليلات، محفظة، وتنبيهات',
 duration: 5000,
 action: {
 label: 'تسجيل الدخول',
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
