'use client';

export const dynamic = "force-dynamic";

import React from 'react';
import dynamicImport from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { VALID_VIEWS, VALID_VIEWS_SET, resolveCryptoRedirect, isCryptoView } from '@/lib/valid-views';
import { MobileNav } from '@/components/layout/MobileNav';
import { TopBar } from '@/components/layout/TopBar';
import { DashboardView } from '@/modules/dashboard/components/DashboardView';
import { AuthGate } from '@/components/auth/AuthGate';
import { RealtimeTicker } from '@/modules/dashboard/components/RealtimeTicker';
import { RoboNotifierToggle } from '@/components/notifications/RoboNotifierToggle';
import { CentralAlertMonitor } from '@/components/notifications/CentralAlertMonitor';
import { DesktopNotificationPrompt } from '@/components/notifications/DesktopNotificationPrompt';
import { TrialExpiredModal } from '@/modules/subscription/components/TrialExpiredModal';
import { TrialCountdownBanner } from '@/modules/subscription/components/TrialCountdownBanner';
import { DevLoginForm } from '@/modules/auth/components/DevLoginForm';

import { Footer } from '@/components/layout/Footer';
import { PlatformGuide, usePlatformGuide } from '@/components/help/PlatformGuide';
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';
import { SafeWidget } from '@/modules/dashboard/components/SafeWidget';
import { Header } from '@/components/layout/Header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Dynamic imports - only loaded when the view is activated
// This reduces initial compilation from 4089 modules to ~1500, preventing OOM in sandbox.
// Phase 3: added `loading: <LazyTabLoader />` to the heaviest views so users
// see a clear "بيتحمّل..." skeleton instead of a blank white screen while
// the chunk downloads (typically 200-800ms on a fresh cache).
// Phase 4 Task 3: wrapped the heaviest views with `withErrorBoundary` so that
// a runtime error in one view (e.g., TradingChartView's Recharts rendering)
// shows a friendly "حدث خطأ" message + Retry button instead of a White Screen
// of Death. Each view has its own isolated boundary — the rest of the app
// keeps working.
const StocksView = dynamicImport(() => import('@/modules/stock-analysis/components/StocksView').then(m => ({ default: m.StocksView })), { ssr: false, loading: () => <LazyTabLoader label="الأسهم" /> });
const EnhancedPortfolioView = withErrorBoundary(
  dynamicImport(() => import('@/modules/portfolio/components/EnhancedPortfolioView').then(m => ({ default: m.EnhancedPortfolioView })), { ssr: false, loading: () => <LazyTabLoader label="المحفظة" /> }),
  'المحفظة',
);
const EnhancedWatchlistView = withErrorBoundary(
  dynamicImport(() => import('@/components/watchlist/EnhancedWatchlistView').then(m => ({ default: m.EnhancedWatchlistView })), { ssr: false, loading: () => <LazyTabLoader label="قائمة المتابعة" /> }),
  'قائمة المتابعة',
);
const MarketAnalysisView = withErrorBoundary(
  dynamicImport(() => import('@/modules/market-analysis/components/MarketAnalysisView').then(m => ({ default: m.MarketAnalysisView })), { ssr: false, loading: () => <LazyTabLoader label="التحليل" /> }),
  'التحليل',
);
// فلاتر الأسهم — شاشة موحّدة (فلاتر متقدمة + أعلى الأرباح/الخسائر) — Python screener via proxy
const StockScreenerAdvancedView = withErrorBoundary(
  dynamicImport(() => import('@/modules/screener/components/StockScreenerAdvanced').then(m => ({ default: m.StockScreenerAdvanced })), { ssr: false, loading: () => <LazyTabLoader label="فلاتر الأسهم" /> }),
  'فلاتر الأسهم',
);
const ReportsView = withErrorBoundary(
  dynamicImport(() => import('@/modules/reports/components/ReportsView').then(m => ({ default: m.ReportsView })), { ssr: false, loading: () => <LazyTabLoader label="التقارير" /> }),
  'التقارير',
);
const NewsFeedView = withErrorBoundary(
  dynamicImport(() => import('@/modules/news/components/NewsFeedView').then(m => ({ default: m.NewsFeedView })), { ssr: false, loading: () => <LazyTabLoader label="الأخبار" /> }),
  'الأخبار',
);
// Rule 63 (Education Unification 2026-10-01):
//   LearningView (1,063 LOC) was a duplicate education screen — archived to
//   archive/education-duplicate-2026-10-01/. Single canonical education
//   screen is now #academy (AcademyView). The `learning` route + dynamic
//   import below were removed; `crypto-learning` now redirects to `academy`
//   (see valid-views.ts CRYPTO_VIEW_REDIRECTS).
const SimulationView = withErrorBoundary(
  dynamicImport(() => import('@/modules/simulation/components/SimulationView').then(m => ({ default: m.SimulationView })), { ssr: false, loading: () => <LazyTabLoader label="المحاكاة" /> }),
  'المحاكاة',
);
const AcademyView = withErrorBoundary(
  dynamicImport(() => import('@/modules/education/components/AcademyView').then(m => ({ default: m.AcademyView })), { ssr: false, loading: () => <LazyTabLoader label="الأكاديمية" /> }),
  'الأكاديمية',
);
// TASK 31-C — Disaster Stock Rescue: thin wrapper view (Rule 4 compliant —
// no new top-level route, just a new case in the existing page.tsx switch).
// Wraps the existing BagHolderRescuePanel with a simple header.
const BagHolderRescueView = withErrorBoundary(
  dynamicImport(() => import('@/modules/portfolio/components/BagHolderRescuePanel').then(m => ({ default: m.BagHolderRescuePanel })), { ssr: false, loading: () => <LazyTabLoader label="إنقاذ سهم خسران" /> }),
  'إنقاذ سهم خسران',
);
const SettingsView = withErrorBoundary(
  dynamicImport(() => import('@/components/settings/SettingsView').then(m => ({ default: m.SettingsView })), { ssr: false, loading: () => <LazyTabLoader label="الإعدادات" /> }),
  'الإعدادات',
);
const AdminView = withErrorBoundary(
  dynamicImport(() => import('@/modules/admin/components/AdminView').then(m => ({ default: m.AdminView })), { ssr: false, loading: () => <LazyTabLoader label="لوحة الأدمن" /> }),
  'لوحة الأدمن',
);
const AuthView = dynamicImport(() => import('@/components/auth/AuthView').then(m => ({ default: m.AuthView })), { ssr: false });
const SubscriptionView = dynamicImport(() => import('@/components/subscription/SubscriptionView').then(m => ({ default: m.SubscriptionView })), { ssr: false });
// UI-MIRROR PROTOCOL (Complete Mirror):
// CryptoView, LiveCryptoTable, CryptoWatchlistView REMOVED.
// Crypto now uses the SAME components as stocks:
//   crypto           -> DashboardView (same widgets/layout, crypto data)
//   crypto-live      -> StocksView    (same table/columns/presets/search)
//   crypto-watchlist -> EnhancedWatchlistView (same watchlist UX)
// The Sidebar sets currentMarket='CRYPTO' on crypto nav clicks, which makes
// these stock components load crypto data automatically.
const CryptoPortfolioView = withErrorBoundary(
  dynamicImport(() => import('@/modules/crypto/components/CryptoPortfolioView').then(m => ({ default: m.CryptoPortfolioView })), { ssr: false }),
  'محفظة الكريبتو',
);
const ZakatView = withErrorBoundary(
  dynamicImport(() => import('@/components/zakat/ZakatView').then(m => ({ default: m.ZakatView })), { ssr: false }),
  'الزكاة',
);
const TithesView = withErrorBoundary(
  dynamicImport(() => import('@/components/tithes/TithesView').then(m => ({ default: m.TithesView })), { ssr: false }),
  'العشور',
);
// Task 23-C (Frontend — Sharia UI): شاشة التوافق الشرعي المستقلة — استثناء
// صريح من المالك من قاعدة "No new screens" (Constitution Rule 4). الشاشة
// بطراز مالي إسلامي محترف (emerald + gold) وبتعرض 253 سهماً + حاسبة تطهير.
const ShariaView = withErrorBoundary(
  dynamicImport(() => import('@/modules/sharia/components/ShariaView').then(m => ({ default: m.ShariaView })), { ssr: false }),
  'التوافق الشرعي',
);
// StoredAnalysisView REMOVED — advanced-analysis features distributed to
// #recommendations (متابعة التوقعات) + #specialist-analysis (تحليل المتخصصين).
// The file still exists for reference but is no longer routed.
const SpecialistAnalysisView = withErrorBoundary(
  dynamicImport(() => import('@/components/advanced-analysis/SpecialistAnalysisView').then(m => ({ default: m.SpecialistAnalysisView })), { ssr: false }),
  'التحليل التخصصي',
);
// PredictionPerformanceView + PredictionCredibilityTable معطّلين (admin-only)
const AdvancedPortfolioManager = withErrorBoundary(
  dynamicImport(() => import('@/modules/portfolio/components/AdvancedPortfolioManager').then(m => ({ default: m.AdvancedPortfolioManager })), { ssr: false }),
  'المحفظة المتقدمة',
);
const SeasonalityDashboard = withErrorBoundary(
  dynamicImport(() => import('@/components/seasonality/SeasonalityDashboard').then(m => ({ default: m.SeasonalityDashboard })), { ssr: false }),
  'لوحة الموسمية',
);
const AlertsCenterView = withErrorBoundary(
  dynamicImport(() => import('@/components/alerts/AlertsCenterView').then(m => ({ default: m.AlertsCenterView })), { ssr: false }),
  'مركز التنبيهات',
);
const UserPublishingView = withErrorBoundary(
  dynamicImport(() => import('@/components/publishing/UserPublishingView').then(m => ({ default: m.UserPublishingView })), { ssr: false }),
  'منصة النشر',
);
const TradingMemoryView = withErrorBoundary(
  dynamicImport(() => import('@/components/memory/TradingMemoryView').then(m => ({ default: m.TradingMemoryView })), { ssr: false }),
  'ذاكرة التداول',
);
const TradingJournalView = withErrorBoundary(
  dynamicImport(() => import('@/components/journal/TradingJournalView').then(m => ({ default: m.TradingJournalView })), { ssr: false }),
  'يوميات التداول',
);
const UnifiedAnalysisView = withErrorBoundary(
  dynamicImport(() => import('@/modules/market-analysis/components/UnifiedAnalysisView'), { ssr: false }),
  'التحليل الموحّد',
);
const SmartConfluenceView = withErrorBoundary(
  dynamicImport(() => import('@/components/smart-assistant/SmartConfluenceView').then(m => ({ default: m.SmartConfluenceView })), { ssr: false }),
  'المساعد الذكي',
);
const PredictionTrackingView = withErrorBoundary(
  dynamicImport(() => import('@/modules/predictions/components/PredictionTrackingView').then(m => ({ default: m.PredictionTrackingView })), { ssr: false }),
  'تتبّع التوقعات',
);
// PicksManagementView removed 2026-09-28 (file deleted in Task 7-A — features merged into PredictionTrackingView)
const DualTrackPredictionsView = withErrorBoundary(
  dynamicImport(() => import('@/modules/predictions/components/DualTrackPredictionsView').then(m => ({ default: m.DualTrackPredictionsView })), { ssr: false, loading: () => <LazyTabLoader label="التوقعات المزدوجة" /> }),
  'التوقعات المزدوجة',
);
const V82DecisionPanel = withErrorBoundary(
  dynamicImport(() => import('@/components/v82/V82DecisionPanel').then(m => ({ default: m.V82DecisionPanel })), { ssr: false, loading: () => <LazyTabLoader label="القرار المؤسسي" /> }),
  'القرار المؤسسي',
);
const LiveMonitor = withErrorBoundary(
  dynamicImport(() => import('@/modules/dashboard/components/LiveMonitor'), { ssr: false }),
  'المراقبة الحية',
);
const WealthCharts = withErrorBoundary(
  dynamicImport(() => import('@/modules/admin/components/WealthCharts').then(m => ({ default: m.WealthCharts })), { ssr: false }),
  'رسوم الثروة',
);
// IterativeLearningView + SimpleRecommendationsView معطّلين (مش مستخدمين في switch)
const EGXBacktestDashboard = withErrorBoundary(
  dynamicImport(() => import('@/components/backtesting/EGXBacktestDashboard').then(m => ({ default: m.EGXBacktestDashboard })), { ssr: false }),
  'لوحة الـ Backtest',
);

const TradingChartView = withErrorBoundary(
  dynamicImport(() => import('@/modules/market-analysis/components/TradingChartView').then(m => ({ default: m.TradingChartView })), { ssr: false, loading: () => <LazyTabLoader label="الشارت التفاعلي" height="h-[600px]" /> }),
  'الشارت التفاعلي',
  { height: 'h-[600px]' },
);
const LiquidityRadarView = withErrorBoundary(
  dynamicImport(() => import('@/modules/predictions/components/MakerRadarTab').then(m => ({ default: m.MakerRadarTab })), {
    ssr: false,
    loading: () => <LazyTabLoader label="رادار السيولة" />,
  }),
  'رادار السيولة',
);
// MARKET-DEPTH-VIEW: شاشة عمق السوق المنفصلة (عملات + ذهب + سيولة + مستثمرون + ضغط جلسة).
// نستعمل lazy chunks للـ 4 widgets الموجودة فعلاً (مش بنعمل ملف جديد — Rule 4).
// كل widget معمّى بـ SafeWidget جوّه الـ case عشان أي خطأ في واحدة ميبوظش الباقي.
const MarketDepthMultiMarket = withErrorBoundary(
  dynamicImport(() => import('@/modules/dashboard/components/MultiMarketWidget').then(m => ({ default: m.MultiMarketWidget })), {
    ssr: false,
    loading: () => <LazyTabLoader label="العملات والذهب" />,
  }),
  'العملات والذهب',
);
const MarketDepthInvestorsFlow = withErrorBoundary(
  dynamicImport(() => import('@/modules/dashboard/components/InvestorsFlowPanel').then(m => ({ default: m.InvestorsFlowPanel })), {
    ssr: false,
    loading: () => <LazyTabLoader label="تدفّق المستثمرين" />,
  }),
  'تدفّق المستثمرين',
);
const MarketDepthLiquidityFlow = withErrorBoundary(
  dynamicImport(() => import('@/modules/dashboard/components/LiquidityFlowPanel').then(m => ({ default: m.LiquidityFlowPanel })), {
    ssr: false,
    loading: () => <LazyTabLoader label="حركة السيولة" />,
  }),
  'حركة السيولة القطاعية',
);
const MarketDepthIntradayPressure = withErrorBoundary(
  dynamicImport(() => import('@/modules/dashboard/components/IntradayPressurePanel').then(m => ({ default: m.IntradayPressurePanel })), {
    ssr: false,
    loading: () => <LazyTabLoader label="ضغط الجلسة" />,
  }),
  'ضغط الشراء والبيع',
);
const AboutView = dynamicImport(() => import('@/components/about/AboutView').then(m => ({ default: m.AboutView })), { ssr: false });
// ALPHA-P0: Rescue Clinic standalone page
const RescuePage = dynamicImport(() => import('@/app/rescue/page'), { ssr: false, loading: () => <LazyTabLoader label="عيادة الإنقاذ" /> });
// SniperView removed — merged into MarketAnalysisView persona tabs

// Crypto additional views - loaded as a batch
// V40.4 §6 Phase 6: CryptoRecommendationsView + CryptoAnalysisView removed
// (archived to _archived_v404/) — the unified MarketAnalysisView now
// handles #crypto-recommendations + #crypto-analysis via initialMarket prop.
// Rule 63 (Education Unification 2026-10-01): CryptoLearningView was the
// old crypto-specific education screen. `crypto-learning` route now redirects
// to `academy` (single canonical education screen), so the lazy load was
// removed.
//
// Wave 5 — Simulation Globalization (Task 13 Step 4, 2026-10-01):
// CryptoSimulationView was the dedicated crypto trading-sim screen. It was
// archived to archive/simulation-crypto-duplicate-2026-10-01/ because
// SimulationView now serves ALL markets (EGX/TADAWUL/KSE/QSE/US/CRYPTO)
// via the unified MarketSelector. The `crypto-simulation` route below
// returns <SimulationView /> directly (with setCurrentMarket('CRYPTO')
// applied by the shell effect), so the dead `let CryptoSimulationView =
// null` + cryptoViewsPromise block is removed.

// ─── مكونات الكريبتو المستقلة (بيانات crypto_prices حقيقية) ────────────────────────
// Task P1-CLEANUP (2026-10-08): CryptoScreenerView + CryptoTradingChartView +
// CryptoAdvancedAnalysisView + CryptoLearningView moved to archive/dead-components-2026-10-08/
// (they were imported as dynamic-import variables but never rendered in any JSX).
// CryptoPredictionTrackingView is KEPT (it IS rendered). To restore: move files back + uncomment.
const CryptoScreenerView = null;
const CryptoTradingChartView = null;
const CryptoAdvancedAnalysisView = null;
const CryptoPredictionTrackingView = withErrorBoundary(
  dynamicImport(() => import('@/modules/crypto/components/CryptoPredictionTrackingView'), { ssr: false, loading: () => <LazyTabLoader label="تتبّع توقعات الكريبتو" /> }),
  'تتبّع توقعات الكريبتو',
);

/**
 * DbSchemaInit — ensures finance tables exist on first load (once per session)
 * Also initializes database with VPS data if empty
 */
function DbSchemaInit() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('finance_schema_init_done')) return;
    
    // Initialize database schema
    fetch('/api/finance/schema', { method: 'POST', cache: 'no-store' })
      .then(() => sessionStorage.setItem('finance_schema_init_done', '1'))
      .catch(() => {});
    
    // Initialize database with VPS data if empty
    fetch('/api/init-db', { method: 'GET', cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'synced') {
          console.log('[Init] Database synced from VPS:', data.stocks_inserted, 'stocks');
        }
      })
      .catch(() => {});
  }, []);
  return null;
}

/**
 * UrlHashSync — syncs URL hash with app view state
 * Enables browser back/forward navigation and direct links to views
 */
function UrlHashSync() {
  const setCurrentViewFromHash = useAppStore((s) => s.setCurrentViewFromHash);
  const currentView = useAppStore((s) => s.currentView);

  // Valid views for URL hash (موحد من src/lib/valid-views.ts)
  const validViews = VALID_VIEWS;

  // Initialize from URL hash on mount
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash = window.location.hash.slice(1); // Remove #
    if (hash && validViews.includes(hash)) {
      setCurrentViewFromHash(hash as typeof currentView);
      // CRYPTO-SUPPORT: لو الـ hash يبدأ بـ crypto → setCurrentMarket('CRYPTO')
      const { setCurrentMarket, currentMarket } = useAppStore.getState();
      if (hash.startsWith('crypto') && currentMarket !== 'CRYPTO') {
        setCurrentMarket('CRYPTO');
      } else if (!hash.startsWith('crypto') && currentMarket === 'CRYPTO' && ['stocks', 'dashboard', 'recommendations', 'portfolio', 'watchlist', 'trading-chart'].includes(hash)) {
        setCurrentMarket('EGX');
      }
    }
  }, [setCurrentViewFromHash]);

  // Listen for browser back/forward (hashchange event)
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove #
      if (hash && validViews.includes(hash)) {
        // Only update if different from current
        if (hash !== currentView) {
          setCurrentViewFromHash(hash as typeof currentView);
        }
      } else if (!hash) {
        // No hash = dashboard
        if (currentView !== 'dashboard') {
          setCurrentViewFromHash('dashboard');
        }
      }
    };

    // Listen for popstate (back/forward) - more reliable than hashchange
    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.view && validViews.includes(e.state.view)) {
        if (e.state.view !== currentView) {
          setCurrentViewFromHash(e.state.view as typeof currentView);
        }
      } else {
        // No state = check hash or go to dashboard
        const hash = window.location.hash.slice(1);
        if (hash && validViews.includes(hash) && hash !== currentView) {
          setCurrentViewFromHash(hash as typeof currentView);
        } else if (!hash && currentView !== 'dashboard') {
          setCurrentViewFromHash('dashboard');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [currentView, setCurrentViewFromHash]);

  return null; // no UI
}

/**
 * SessionSync — bridges NextAuth session into the zustand store
 * so every component that reads `useAppStore().user` sees real auth data.
 */
function SessionSync() {
  const { data: session, status } = useSession();
  const syncFromSession = useAppStore((s) => s.syncFromSession);
  const user = useAppStore((s) => s.user);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  React.useEffect(() => {
    if (status === 'authenticated') {
      // Only sync if session changed (avoid infinite loops)
      const sessionUser = session?.user as Record<string, unknown> | undefined;
      if (!user || user.id !== session?.user?.id) {
        syncFromSession(session ?? null);
      }
    } else if (status === 'unauthenticated' && user) {
      // Session was cleared — reset store
      syncFromSession(null);
    }
  }, [status, session, syncFromSession, user]);

  // If user just authenticated via OAuth redirect, go to dashboard
  React.useEffect(() => {
    if (status === 'authenticated' && user) {
      const { currentView } = useAppStore.getState();
      if (currentView === 'auth') {
        setCurrentView('dashboard');
      }
    }
  }, [status, user, setCurrentView]);

  return null; // no UI
}

function AppShell() {
  const { currentView } = useAppStore();
  const setCurrentViewFromHash = useAppStore((s) => s.setCurrentViewFromHash);
  const currentMarket = useAppStore((s) => s.currentMarket);
  const setCurrentMarket = useAppStore((s) => s.setCurrentMarket);
  const selectedTicker = useAppStore((s) => s.selectedTicker);

  // SEC-AUTH-GATE (2026-09-30): مفيش وصول للمنصة من غير تسجيل.
  // لو status === 'unauthenticated' → نعرض AuthView (شاشة تسجيل الدخول)
  // لو status === 'loading' → نعرض skeleton
  // لو status === 'authenticated' → نكمل الـ AppShell العادي
  const { status: authStatus } = useSession();

  // ─── Subscription: فحص حالة الـ trial كل 5 دقايق ───
  // لو الـ trial انتهى (isExpired=true)، نعرض TrialExpiredModal (block كامل)
  // لو الـ trial نشط، نعرض TrialCountdownBanner (بانر تنبيهي بالأيام المتبقية)
  const [trialExpired, setTrialExpired] = React.useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = React.useState<number | null>(null);
  const [trialEndsAt, setTrialEndsAt] = React.useState<string | null>(null);
  const [trialShowBanner, setTrialShowBanner] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/subscription/status', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setTrialExpired(Boolean(j.isExpired));
        setTrialDaysLeft(typeof j.daysLeft === 'number' ? j.daysLeft : null);
        setTrialEndsAt(j.trialEndsAt ? (typeof j.trialEndsAt === 'string' ? j.trialEndsAt : (j.trialEndsAt as Date).toISOString()) : null);
        // اعرض البانر بس لو المستخدم Free + في trial نشط (مش expired)
        setTrialShowBanner(!j.isPaid && !j.isExpired && j.status === 'trial');
      } catch {
        // network error — متسجلش، يمكن المستخدم offline
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // UNIFIED-MARKET-UX (Task 2): Crypto view → CRYPTO market
  // لما المستخدم يدخل على crypto-* view (سواء من الـ TopBar أو من deep link)،
  // احنا بنفعّل وضع الكريبتو في الـ store فوراً عشان الـ unified components
  // يجيبوا بيانات الكريبتو بدل بيانات الأسهم. الـ effect ده بيشيل تعقيد الـ
  // setCurrentMarket اللي كان متكرر في كل handler منفصل.
  React.useEffect(() => {
    if (isCryptoView(currentView) && currentMarket !== 'CRYPTO') {
      setCurrentMarket('CRYPTO');
    }
  }, [currentView, currentMarket, setCurrentMarket]);

  // Direct hash → view sync (robust fallback that survives hydration errors)
  // Reads URL hash on mount and on hashchange, sets the current view directly.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash && VALID_VIEWS_SET.has(hash)) {
        const { currentView: cur } = useAppStore.getState();
        if (cur !== hash) {
          setCurrentViewFromHash(hash as typeof currentView);
        }
      }
    };

    // Apply on mount
    applyHash();

    // Listen for hash changes
    window.addEventListener('hashchange', applyHash);
    window.addEventListener('popstate', applyHash);

    return () => {
      window.removeEventListener('hashchange', applyHash);
      window.removeEventListener('popstate', applyHash);
    };
  }, [setCurrentViewFromHash]);

  const renderView = () => {
    switch (currentView) {
      // === البورصة المصرية (EGX) ===
      case 'dashboard':
        return <DashboardView />;
      case 'stocks':
      case 'stock-detail':
        return <StocksView />;
      case 'stock-filters':
        return <StockScreenerAdvancedView />;
      // #top-performers merged into #stock-filters (Tab 2). Redirect safely.
      case 'top-performers':
        return <StockScreenerAdvancedView initialTab="top-performers" />;
      case 'screener':
      case 'trading-chart':
        return <TradingChartView />;
      case 'portfolio':
      case 'finance':
        return <EnhancedPortfolioView />;
      case 'watchlist':
        return <EnhancedWatchlistView />;
      case 'recommendations':
      case 'analysis':
        return <MarketAnalysisView />;
      case 'advanced-analysis':
      case 'v2-analysis':
        // advanced-analysis REMOVED — features distributed to:
        //   - #recommendations (متابعة التوقعات) → prediction tracking + persona tabs
        //   - #specialist-analysis (تحليل المتخصصين) → expert intelligence + comparison
        // Redirect to recommendations for backward-compat hash links.
        return <MarketAnalysisView />;
      case 'unified-analysis':
        return <UnifiedAnalysisView />;
      case 'specialist-analysis':
        return <SpecialistAnalysisView />;
      case 'prediction-performance':
      case 'prediction-credibility':
        // These views are admin-only now — available in /#admin panel
        // Direct access redirects to dashboard
        return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
            <div className="text-6xl mb-4">🔬</div>
            <h2 className="text-2xl font-bold mb-2">قسم التحليلات الفنية</h2>
            <p className="text-muted-foreground mb-4">
              هذه الصفحة متاحة في لوحة التحكم للمشرفين فقط.
            </p>
            <button
              onClick={() => { setCurrentViewFromHash('dashboard'); window.location.hash = ''; }}
              className="px-6 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90"
            >
              العودة للوحة التحكم
            </button>
          </div>
        );
      case 'prediction-tracking':
        return <PredictionTrackingView />;
      // picks-management REMOVED 2026-09-28 — redirects to prediction-tracking
      case 'picks-management':
        return <PredictionTrackingView />;
      case 'dual-track':
        return <DualTrackPredictionsView />;
      case 'v82':
        return <V82DecisionPanel initialTicker="COMI" />;
      case 'reports':
        return <ReportsView />;
      case 'news':
        return <NewsFeedView />;
      case 'simulation':
        return <SimulationView />;
      case 'academy':
        return <AcademyView />;
      // TASK 31-C — Disaster Stock Rescue Battalion: شاشة إنقاذ السهم الخسران
      // كانت مخفية جوّه EnhancedPortfolioView، دلوقتي بنوفرها كـ view مستقل
      // في الـ switch ده (مش route جديد) عشان تظهر في القائمة العلوية.
      case 'bagholder-rescue':
        return <BagHolderRescueView />;
      case 'advanced-portfolio':
        return <AdvancedPortfolioManager />;
      case 'seasonality':
        return <SeasonalityDashboard />;
      // sniper merged into analysis
      
      // === المساعد المالي الذكي (Smart Assistant) ===
      case 'smart-confluence':
        return <SmartConfluenceView />;

      // === رادار السيولة (Liquidity Radar) — شاشة منفصلة ===
      // N8: كان تبويب جوّه MarketAnalysisView باسم "رادار الميكرز". دلوقتي شاشة مستقلة
      // قابلة للوصول مباشرة من القائمة. أهم خدمة للمستثمرين (80% من الأرباح).
      case 'liquidity-radar':
        return <LiquidityRadarView market={currentMarket === 'CRYPTO' ? 'EGX' : currentMarket} />;

      // === عمق السوق (Market Depth) — شاشة منفصلة (MARKET-DEPTH-VIEW) ===
      // Owner directive: "حركة العملات والذهب + حركة السيولة + تدفّق المستثمرين +
      // ضغط الشراء/البيع" في شاشة مستقلة من قائمة الأعلى. الـ 4 widgets دي كانت
      // جوّه DashboardView واتشالت منها عشان الـ Dashboard يبقى نضيف.
      //
      // MultiMarketWidget بيتعرض لكل الأسواق (عملات وذهب عالمية).
      // InvestorsFlow + LiquidityFlow + IntradayPressure → EGX only (بيانات intraday
      // محصورة على EGX). لغير EGX بنعرض تنبيه ودي بدل الـ 3 panels.
      case 'market-depth': {
        const isEGX = currentMarket === 'EGX';
        const marketLabel = MARKET_NAMES_AR[currentMarket] || 'السوق';
        return (
          <div className="min-h-screen flex flex-col bg-background">
            <Header
              title="عمق السوق"
              subtitle={`لوحة متابعة شاملة — ${marketLabel}`}
            />
            <main className="flex-1 p-3 md:p-4 space-y-4" dir="rtl">
              {/* ── الصف 1: عام لكل الأسواق (عملات + ذهب + كريبتو + أسهم) ── */}
              <section aria-label="العملات والذهب والأسهم — لكل الأسواق">
                <SafeWidget name="العملات والذهب">
                  <MarketDepthMultiMarket />
                </SafeWidget>
              </section>

              {/* ── الصف 2: بيانات EGX اللحظية (تدفّق المستثمرين + السيولة + ضغط الجلسة) ── */}
              {isEGX ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* تدفّق المستثمرين + السيولة القطاعية — 7 أعمدة */}
                  <section aria-label="تدفّق المستثمرين وحركة السيولة" className="lg:col-span-7 space-y-4">
                    <SafeWidget name="تدفّق المستثمرين">
                      <MarketDepthInvestorsFlow />
                    </SafeWidget>
                    <SafeWidget name="حركة السيولة القطاعية">
                      <MarketDepthLiquidityFlow />
                    </SafeWidget>
                  </section>

                  {/* ضغط الجلسة — 5 أعمدة */}
                  <section aria-label="ضغط الشراء والبيع داخل الجلسة" className="lg:col-span-5">
                    <SafeWidget name="ضغط الشراء والبيع">
                      <MarketDepthIntradayPressure initialTicker={selectedTicker || 'COMI'} />
                    </SafeWidget>
                  </section>
                </div>
              ) : (
                <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
                  <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
                    <span className="font-semibold">
                      بيانات تدفّق المستثمرين والسيولة القطاعية وضغط الجلسة متاحة لسوق EGX فقط.
                    </span>
                    <span className="block mt-1 text-xs text-amber-700 dark:text-amber-300">
                      جدول العملات والذهب أعلاه متاح لكل الأسواق. للوصول لبيانات EGX intraday،
                      بدّل السوق إلى 🇪🇬 مصر من قائمة الأسواق بأعلى الصفحة.
                    </span>
                  </AlertDescription>
                </Alert>
              )}
            </main>
            <Footer />
          </div>
        );
      }

      // === الذكاء الاصطناعي (Intelligence) ===
      case 'alerts-center':
        return <AlertsCenterView />;
      

      case 'live-monitor':
        return <LiveMonitor />;
      
      case 'wealth':
        return <WealthCharts />;
      
      // === ذاكرة التداول (Trading Memory) ===
      case 'trading-memory':
        return <TradingMemoryView />;
      
      // === يوميات التداول (Trading Journal) ===
      case 'trading-journal':
        return <TradingJournalView />;
      
      // === منصة التوقعات (Publishing & Points) ===
      case 'publishing':
        return <UserPublishingView />;
      
      // === العملات الرقمية (Crypto) — UNIFIED-MARKET-UX (Task 2) ============
      // كل الـ crypto-* views دلوقتي بـ redirect للـ unified view المناسب
      // (نفس الـ component اللي بيستعمله السوق العادي) + setCurrentMarket('CRYPTO')
      // بيشتغل تلقائياً من useEffect في AppShell. الفرق الوحيد بين الكريبتو
      // والأسهم هو قيمة currentMarket في الـ store — الـ unified component بياخد
      // البيانات من هناك فبيعرض بيانات الكريبتو بشكل تلقائي (UI-Mirror Protocol).
      //
      // Mapping (see CRYPTO_VIEW_REDIRECTS in valid-views.ts):
      //   crypto               → dashboard        (DashboardView + CRYPTO)
      //   crypto-live          → stocks           (StocksView + CRYPTO)
      //   crypto-recommendations → recommendations (MarketAnalysisView + CRYPTO)
      //   crypto-trading-chart → trading-chart    (TradingChartView + CRYPTO)
      //   crypto-screener      → stock-filters    (StockScreenerAdvancedView + CRYPTO)
      //   crypto-analysis      → smart-confluence  (SmartConfluenceView + CRYPTO)
      //   crypto-learning      → academy          (AcademyView + CRYPTO)
      //   crypto-simulation    → simulation       (SimulationView + CRYPTO)
      case 'crypto':
        // unified: dashboard + setCurrentMarket('CRYPTO')
        return <DashboardView />;
      case 'crypto-live':
        // unified: stocks + setCurrentMarket('CRYPTO')
        return <StocksView />;
      case 'crypto-portfolio':
        return <CryptoPortfolioView />;
      case 'crypto-watchlist':
        return <EnhancedWatchlistView />;
      case 'crypto-recommendations':
        // unified: recommendations (MarketAnalysisView) + setCurrentMarket('CRYPTO')
        return <MarketAnalysisView />;
      case 'crypto-analysis':
        // unified: smart-confluence (SmartConfluenceView) + setCurrentMarket('CRYPTO')
        return <SmartConfluenceView />;
      case 'crypto-learning':
        // Rule 63 (Education Unification 2026-10-01):
        //   LearningView archived. crypto-learning now redirects to academy.
        //   setCurrentMarket('CRYPTO') is still applied by the shell effect.
        return <AcademyView />;
      case 'crypto-simulation':
        // unified: simulation (SimulationView) + setCurrentMarket('CRYPTO')
        return <SimulationView />;
      case 'crypto-trading-chart':
        // unified: trading-chart (TradingChartView) + setCurrentMarket('CRYPTO')
        return <TradingChartView />;
      case 'crypto-prediction-tracking':
        return <CryptoPredictionTrackingView />;
      case 'crypto-screener':
        // unified: stock-filters (StockScreenerAdvancedView) + setCurrentMarket('CRYPTO')
        return <StockScreenerAdvancedView />;
      
      // === حسابات دينية ===
      case 'zakat':
        return <ZakatView />;
      case 'tithes':
        return <TithesView />;
      case 'sharia':
        return <ShariaView />;
       
       // === أخرى ===
      case 'subscription':
        return <SubscriptionView />;
      case 'settings':
        return <SettingsView />;
      case 'auth':
        return <AuthView />;
      case 'admin':
        return <AdminView />;

      // === من نحن ===
      case 'about':
        return <AboutView />;

      // === مخفية/قديمة ===
      case 'backtesting':
        return <EGXBacktestDashboard />;

      case 'rescue':
        return <RescuePage />;

      default:
        return <DashboardView />;
    }
  };

  const isChartView = currentView === 'trading-chart' || currentView === 'screener';

  // SEC-AUTH-GATE: لو مش مسجل → نعرض شاشة تسجيل الدخول فقط (مفيش وصول للمنصة)
  // SEC-DEV-LOGIN (2026-09-30): لو في ?dev=1 → نعرض DevLoginForm (للسيرفر التجريبي)
  if (authStatus === 'unauthenticated') {
    // فحص ?dev=1 في الـ URL
    const isDevLogin = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('dev') === '1';

    if (isDevLogin) {
      return <DevLoginForm />;
    }

    // BOT-SUBSCRIPTION-GATE (2026-10-01): لو في ?bot_link=TOKEN → اعرض AuthView
    // مع بانر واضح يوضح إنه لازم يسجل قبل ما يقدر يربط البوت بحسابه.
    const botLinkToken = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('bot_link')
      : null;
    if (botLinkToken) {
      return (
        <div
          className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-emerald-50/30 dark:from-emerald-950/20 dark:via-background dark:to-background p-4 gap-4"
          dir="rtl"
        >
          <div className="max-w-md w-full rounded-xl border border-primary/30 bg-card p-5 text-center shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)] ring-1 ring-primary/10">
            <h2 className="text-lg font-bold mb-1">ربط بوت تليجرام بحسابك</h2>
            <p className="text-sm text-muted-foreground">
              سجّل دخولك أو أنشئ حساب (تجربة 7 أيام مجاناً) لتأكيد ربط البوت بحسابك في الموقع.
            </p>
          </div>
          <div className="w-full max-w-md">
            <AuthView />
          </div>
        </div>
      );
    }

    return (
      <div
        className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-emerald-50/30 dark:from-emerald-950/25 dark:via-background dark:to-background p-4 relative overflow-hidden"
        dir="rtl"
      >
        {/* Subtle emerald pattern overlay — adds texture without distraction
            (Rule 29 NO-HYPE: alpha ≤ 0.04) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, hsl(var(--primary)) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative w-full max-w-md">
          <AuthView />
        </div>
      </div>
    );
  }

  // لو الـ session لسه بيتحمّل → skeleton
  if (authStatus === 'loading') {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-emerald-50/30 dark:from-emerald-950/25 dark:via-background dark:to-background"
        dir="rtl"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthGate>
      <div className="min-h-screen flex flex-col bg-background">
        <DbSchemaInit />
        <SessionSync />
        <UrlHashSync />
        <RealtimeTicker />
        {/* BOT-SUBSCRIPTION-GATE (2026-10-01): لو في ?bot_link=TOKEN →
            اعرض Dialog تأكيد ربط البوت بحساب المستخدم المسجّل. */}
        <BotLinkHandler />
        {/* P20-CENTRAL-ALERTS: الجرس المركزي — بيراقب /api/sniper/scan كل 60ث
            ويطلع صوت + toast للإشارات الجديدة/المتغيرة (مشروط بتفعيل التنبيهات) */}
        <CentralAlertMonitor />
        {/* إشعار تفعيل تنبيهات سطح المكتب بنظام الواتساب حتى لو الموقع مصغر */}
        <DesktopNotificationPrompt />
        {/* Trial expired modal — block كامل للـ free users بعد 14 يوم */}
        <TrialExpiredModal isExpired={trialExpired} />
        {/* Trial countdown banner — بانر تنبيهي بالأيام المتبقية في الفترة المجانية */}
        <TrialCountdownBanner
          daysLeft={trialDaysLeft ?? undefined}
          trialEndsAt={trialEndsAt}
          show={trialShowBanner}
        />
        <AppGuideAutoOpen />
        {/* TOPBAR: قائمة علوية مرتبة بدل الـ Sidebar الجانبي القديم */}
        <TopBar />
        <div className="flex-1 flex flex-col overflow-x-hidden">
          {/* Task PHASE5-SCREENS (Footer sticky-bottom fix): removed redundant min-h-screen
              from inner container — the parent (L846) already has min-h-screen flex flex-col.
              This ensures Footer stays at viewport bottom on short pages + pushed down on long pages. */}
          <div className="flex-1 min-w-0 w-full flex flex-col overflow-x-hidden">
            <main className="pb-24 lg:pb-8 flex-1 overflow-x-hidden">
              {/* N1: page transition animation — fade + slight slide for professional feel */}
              <motion.div
                key={currentView}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {renderView()}
              </motion.div>
            </main>
            <Footer />
          </div>
          <MobileNav />
        </div>
        {/* ROBO-ADVISOR-P2: زر التنبيهات الحية — عائم فوق الـ MobileNav على الموبايل */}
        <div className="fixed bottom-20 lg:bottom-4 left-4 z-40">
          <RoboNotifierToggle />
        </div>
      </div>
    </AuthGate>
  );
}

// ONBOARDING-033: Auto-open the Platform Guide on first visit (separate
// component so the hook only runs on the client, not during SSR).
function AppGuideAutoOpen() {
  const { open, setOpen } = usePlatformGuide();
  return <PlatformGuide open={open} onOpenChange={setOpen} />;
}

// ============================================================================
// BOT-SUBSCRIPTION-GATE (2026-10-01): BotLinkHandler
// ----------------------------------------------------------------------------
// When the user opens the website via a link that contains `?bot_link=TOKEN`
// (typically by tapping the "🔗 ربط حسابك في الموقع" button in the Telegram
// bot), and they're authenticated, we show a confirmation Dialog. On confirm
// we POST /api/bot/link-account with the token; the backend verifies the
// token, writes a `user_telegram_links` row, marks the token as used, and
// tells us the chat_id. We then show a "ارجع للبوت في تليجرام" success
// message.
//
// The component renders nothing visible if there is no `bot_link` token in
// the URL — so it's safe to mount unconditionally inside the authenticated
// AppShell.
// ============================================================================
type BotLinkState = 'idle' | 'confirming' | 'linking' | 'success' | 'error';

function BotLinkHandler() {
  const [token, setToken] = React.useState<string | null>(null);
  const [state, setState] = React.useState<BotLinkState>('idle');
  const [errorMsg, setErrorMsg] = React.useState<string>('');
  const [chatId, setChatId] = React.useState<number | null>(null);

  // 1. Read the ?bot_link token from the URL on mount.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('bot_link');
    if (t && t.length > 0 && t.length < 200) {
      setToken(t);
      setState('confirming');
    }
  }, []);

  // 2. On confirm → POST /api/bot/link-account
  const onConfirm = React.useCallback(async () => {
    if (!token) return;
    setState('linking');
    setErrorMsg('');
    try {
      const res = await fetch('/api/bot/link-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({ success: false, error: 'invalid_response' }));
      if (res.ok && data?.success) {
        setChatId(typeof data.chat_id === 'number' ? data.chat_id : null);
        setState('success');
      } else {
        const err = typeof data?.error === 'string' ? data.error : 'link_failed';
        const arMap: Record<string, string> = {
          token_not_found: 'رمز الربط غير صحيح أو منتهي. يرجى العودة إلى البوت وضغط زر الربط مرة أخرى.',
          token_expired: 'انتهت صلاحية رمز الربط (10 دقائق). يرجى العودة إلى البوت وضغط زر الربط مرة أخرى.',
          token_already_used: 'تم استخدام رمز الربط مسبقاً. يرجى العودة إلى البوت والبدء من /start.',
          invalid_token: 'رمز الربط غير صحيح.',
          link_failed: 'تعذّر ربط البوت بحسابك. حاول مرة أخرى.',
        };
        setErrorMsg(arMap[err] || `تعذّر ربط البوت بحسابك (${err}).`);
        setState('error');
      }
    } catch {
      setErrorMsg('حدثت مشكلة في الاتصال. يرجى المحاولة مرة أخرى.');
      setState('error');
    }
  }, [token]);

  // 3. Cleanup the URL after success/error so a refresh doesn't re-trigger.
  const cleanUrl = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('bot_link');
    window.history.replaceState({}, '', url.toString());
    setToken(null);
    setState('idle');
  }, []);

  if (state === 'idle' || !token) return null;

  const open = state === 'confirming' || state === 'linking' || state === 'success' || state === 'error';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) cleanUrl(); }}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>تأكيد ربط البوت بحسابك</span>
          </DialogTitle>
          <DialogDescription>
            {state === 'success'
              ? 'تم ربط البوت بحسابك بنجاح.'
              : 'تأكيد أن بوت تليجرام يمكنه استخدام اشتراكك الشهري.'}
          </DialogDescription>
        </DialogHeader>

        {state === 'success' ? (
          <div className="space-y-3 py-2 text-center">
            <div className="text-5xl">✅</div>
            <p className="text-base font-medium">تم ربط البوت بحسابك بنجاح!</p>
            {chatId !== null && (
              <p className="text-xs text-muted-foreground" dir="ltr">
                chat_id: {chatId}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              📲 ارجع إلى البوت في تليجرام واضغط /start — سيعمل البوت بشكل كامل.
            </p>
            <DialogFooter className="sm:justify-center pt-2">
              <Button onClick={cleanUrl}>تم</Button>
            </DialogFooter>
          </div>
        ) : state === 'error' ? (
          <div className="space-y-3 py-2 text-center">
            <div className="text-5xl">⚠️</div>
            <p className="text-sm text-destructive">{errorMsg}</p>
            <DialogFooter className="sm:justify-center pt-2">
              <Button variant="outline" onClick={cleanUrl}>إغلاق</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              اضغط &quot;تأكيد الربط&quot; ليبدأ البوت بالعمل. تربط هذه العملية
              حسابك في تليجرام بحسابك في الموقع — ويتطلب اشتراك Premium (أو تجربة مجانية نشطة) لاستخدام البوت.
            </p>
            <DialogFooter className="sm:justify-end gap-2 pt-2">
              <Button variant="outline" onClick={cleanUrl} disabled={state === 'linking'}>
                إلغاء
              </Button>
              <Button onClick={onConfirm} disabled={state === 'linking'}>
                {state === 'linking' ? (
                  <>
                    <span className="w-4 h-4 mr-2 rounded-full border-2 border-background/40 border-t-background animate-spin inline-block" />
                    جاري الربط...
                  </>
                ) : (
                  'تأكيد الربط'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  return <AppShell />;
}
