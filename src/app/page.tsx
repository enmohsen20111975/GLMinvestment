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
import { PaywallListener } from '@/components/auth/PaywallListener';
import { RealtimeTicker } from '@/modules/dashboard/components/RealtimeTicker';
import { RoboNotifierToggle } from '@/components/notifications/RoboNotifierToggle';
import { CentralAlertMonitor } from '@/components/notifications/CentralAlertMonitor';
import { DesktopNotificationPrompt } from '@/components/notifications/DesktopNotificationPrompt';
import { TrialExpiredModal } from '@/modules/subscription/components/TrialExpiredModal';
import { TrialCountdownBanner } from '@/modules/subscription/components/TrialCountdownBanner';
import { DevLoginForm } from '@/modules/auth/components/DevLoginForm';
import { isGuestUser, isViewAllowedForGuest } from '@/lib/subscription-gate';

import { Footer } from '@/components/layout/Footer';
import { PlatformGuide, usePlatformGuide } from '@/components/help/PlatformGuide';
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';
import { SafeWidget } from '@/modules/dashboard/components/SafeWidget';
import { Header } from '@/components/layout/Header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, Lock } from 'lucide-react';
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
// ALPHA-UX-FIX-7: standalone routes (moved from #recommendations tabs to السوق nav)
const MarketStatusView = withErrorBoundary(
  dynamicImport(() => import('@/modules/market-analysis/components/MarketStatusTab').then(m => ({ default: m.MarketStatusTab })), { ssr: false, loading: () => <LazyTabLoader label="حالة السوق" /> }),
  'حالة السوق',
);
const HistoricalTradesView = withErrorBoundary(
  dynamicImport(() => import('@/modules/market-analysis/components/HistoricalTradesTable').then(m => ({ default: m.HistoricalTradesTable })), { ssr: false, loading: () => <LazyTabLoader label="الصفقات التاريخية" /> }),
  'الصفقات التاريخية',
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
  dynamicImport(() => import('@/components/shared/LiquidityRadarView').then(m => ({ default: m.LiquidityRadarView })), {
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
    } else if (status === 'unauthenticated' && user && !user.is_admin && user.subscription_tier !== 'admin') {
      // Session was cleared — reset store (preserve admin if authenticated via admin_session cookie)
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

// =====================================================================