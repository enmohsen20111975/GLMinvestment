'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { AuthGate } from '@/components/auth/AuthGate';
import { RealtimeTicker } from '@/components/dashboard/RealtimeTicker';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { RoboNotifierToggle } from '@/components/notifications/RoboNotifierToggle';
import { CentralAlertMonitor } from '@/components/notifications/CentralAlertMonitor';
import { Toaster } from '@/components/ui/sonner';
import { FloatingAssistant } from '@/components/ai/FloatingAssistant';
import { Footer } from '@/components/layout/Footer';
import { PlatformGuide, usePlatformGuide } from '@/components/help/PlatformGuide';
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';

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
const StocksView = dynamic(() => import('@/components/stocks/StocksView').then(m => ({ default: m.StocksView })), { ssr: false, loading: () => <LazyTabLoader label="الأسهم" /> });
const EnhancedPortfolioView = withErrorBoundary(
  dynamic(() => import('@/components/portfolio/EnhancedPortfolioView').then(m => ({ default: m.EnhancedPortfolioView })), { ssr: false, loading: () => <LazyTabLoader label="المحفظة" /> }),
  'المحفظة',
);
const EnhancedWatchlistView = withErrorBoundary(
  dynamic(() => import('@/components/watchlist/EnhancedWatchlistView').then(m => ({ default: m.EnhancedWatchlistView })), { ssr: false, loading: () => <LazyTabLoader label="قائمة المتابعة" /> }),
  'قائمة المتابعة',
);
const MarketAnalysisView = withErrorBoundary(
  dynamic(() => import('@/components/analysis/MarketAnalysisView').then(m => ({ default: m.MarketAnalysisView })), { ssr: false, loading: () => <LazyTabLoader label="التحليل" /> }),
  'التحليل',
);
const ReportsView = withErrorBoundary(
  dynamic(() => import('@/components/reports/ReportsView').then(m => ({ default: m.ReportsView })), { ssr: false, loading: () => <LazyTabLoader label="التقارير" /> }),
  'التقارير',
);
const LearningView = withErrorBoundary(
  dynamic(() => import('@/components/learning/LearningView').then(m => ({ default: m.LearningView })), { ssr: false, loading: () => <LazyTabLoader label="التعلّم" /> }),
  'التعلّم',
);
const SimulationView = withErrorBoundary(
  dynamic(() => import('@/components/simulation/SimulationView').then(m => ({ default: m.SimulationView })), { ssr: false, loading: () => <LazyTabLoader label="المحاكاة" /> }),
  'المحاكاة',
);
const AcademyView = withErrorBoundary(
  dynamic(() => import('@/components/academy/AcademyView').then(m => ({ default: m.AcademyView })), { ssr: false, loading: () => <LazyTabLoader label="أكاديمية M2y" /> }),
  'أكاديمية M2y',
);
const SettingsView = withErrorBoundary(
  dynamic(() => import('@/components/settings/SettingsView').then(m => ({ default: m.SettingsView })), { ssr: false, loading: () => <LazyTabLoader label="الإعدادات" /> }),
  'الإعدادات',
);
const AdminView = withErrorBoundary(
  dynamic(() => import('@/components/admin/AdminView').then(m => ({ default: m.AdminView })), { ssr: false, loading: () => <LazyTabLoader label="لوحة الأدمن" /> }),
  'لوحة الأدمن',
);
const AuthView = dynamic(() => import('@/components/auth/AuthView').then(m => ({ default: m.AuthView })), { ssr: false });
const SubscriptionView = dynamic(() => import('@/components/subscription/SubscriptionView').then(m => ({ default: m.SubscriptionView })), { ssr: false });
// UI-MIRROR PROTOCOL (Complete Mirror):
// CryptoView, LiveCryptoTable, CryptoWatchlistView REMOVED.
// Crypto now uses the SAME components as stocks:
//   crypto           -> DashboardView (same widgets/layout, crypto data)
//   crypto-live      -> StocksView    (same table/columns/presets/search)
//   crypto-watchlist -> EnhancedWatchlistView (same watchlist UX)
// The Sidebar sets currentMarket='CRYPTO' on crypto nav clicks, which makes
// these stock components load crypto data automatically.
const CryptoPortfolioView = withErrorBoundary(
  dynamic(() => import('@/components/crypto/CryptoPortfolioView').then(m => ({ default: m.CryptoPortfolioView })), { ssr: false }),
  'محفظة الكريبتو',
);
const ZakatView = withErrorBoundary(
  dynamic(() => import('@/components/zakat/ZakatView').then(m => ({ default: m.ZakatView })), { ssr: false }),
  'الزكاة',
);
const TithesView = withErrorBoundary(
  dynamic(() => import('@/components/tithes/TithesView').then(m => ({ default: m.TithesView })), { ssr: false }),
  'العشور',
);
// StoredAnalysisView REMOVED — advanced-analysis features distributed to
// #recommendations (متابعة التوقعات) + #specialist-analysis (تحليل المتخصصين).
// The file still exists for reference but is no longer routed.
const SpecialistAnalysisView = withErrorBoundary(
  dynamic(() => import('@/components/advanced-analysis/SpecialistAnalysisView').then(m => ({ default: m.SpecialistAnalysisView })), { ssr: false }),
  'التحليل التخصصي',
);
const PredictionPerformanceView = dynamic(() => import('@/components/performance/PredictionPerformanceView').then(m => ({ default: m.PredictionPerformanceView })), { ssr: false });
const PredictionCredibilityTable = dynamic(() => import('@/components/performance/PredictionCredibilityTable').then(m => ({ default: m.PredictionCredibilityTable })), { ssr: false });
const AdvancedPortfolioManager = withErrorBoundary(
  dynamic(() => import('@/components/portfolio/AdvancedPortfolioManager').then(m => ({ default: m.AdvancedPortfolioManager })), { ssr: false }),
  'المحفظة المتقدمة',
);
const SeasonalityDashboard = withErrorBoundary(
  dynamic(() => import('@/components/seasonality/SeasonalityDashboard').then(m => ({ default: m.SeasonalityDashboard })), { ssr: false }),
  'لوحة الموسمية',
);
const AlertsCenterView = withErrorBoundary(
  dynamic(() => import('@/components/alerts/AlertsCenterView').then(m => ({ default: m.AlertsCenterView })), { ssr: false }),
  'مركز التنبيهات',
);
const UserPublishingView = withErrorBoundary(
  dynamic(() => import('@/components/publishing/UserPublishingView').then(m => ({ default: m.UserPublishingView })), { ssr: false }),
  'منصة النشر',
);
const TradingMemoryView = withErrorBoundary(
  dynamic(() => import('@/components/memory/TradingMemoryView').then(m => ({ default: m.TradingMemoryView })), { ssr: false }),
  'ذاكرة التداول',
);
const TradingJournalView = withErrorBoundary(
  dynamic(() => import('@/components/journal/TradingJournalView').then(m => ({ default: m.TradingJournalView })), { ssr: false }),
  'يوميات التداول',
);
const UnifiedAnalysisView = withErrorBoundary(
  dynamic(() => import('@/components/analysis/UnifiedAnalysisView'), { ssr: false }),
  'التحليل الموحّد',
);
const SmartConfluenceView = withErrorBoundary(
  dynamic(() => import('@/components/smart-assistant/SmartConfluenceView').then(m => ({ default: m.SmartConfluenceView })), { ssr: false }),
  'المساعد الذكي',
);
const PredictionTrackingView = withErrorBoundary(
  dynamic(() => import('@/components/predictions/PredictionTrackingView').then(m => ({ default: m.PredictionTrackingView })), { ssr: false }),
  'تتبّع التوقعات',
);
const PicksManagementView = withErrorBoundary(
  dynamic(() => import('@/components/predictions/PicksManagementView').then(m => ({ default: m.PicksManagementView })), { ssr: false, loading: () => <LazyTabLoader label="إدارة التوصيات" /> }),
  'إدارة التوصيات',
);
const LiveMonitor = withErrorBoundary(
  dynamic(() => import('@/components/dashboard/LiveMonitor'), { ssr: false }),
  'المراقبة الحية',
);
const WealthCharts = withErrorBoundary(
  dynamic(() => import('@/components/admin/WealthCharts').then(m => ({ default: m.WealthCharts })), { ssr: false }),
  'رسوم الثروة',
);
const IterativeLearningView = withErrorBoundary(
  dynamic(() => import('@/components/backtesting/IterativeLearningView').then(m => ({ default: m.IterativeLearningView })), { ssr: false }),
  'التعلّم التكراري',
);
const EGXBacktestDashboard = withErrorBoundary(
  dynamic(() => import('@/components/backtesting/EGXBacktestDashboard').then(m => ({ default: m.EGXBacktestDashboard })), { ssr: false }),
  'لوحة الـ Backtest',
);
const SimpleRecommendationsView = withErrorBoundary(
  dynamic(() => import('@/components/recommendations/SimpleRecommendationsView').then(m => ({ default: m.SimpleRecommendationsView })), { ssr: false }),
  'التوصيات',
);
const TradingChartView = withErrorBoundary(
  dynamic(() => import('@/components/analysis/TradingChartView').then(m => ({ default: m.TradingChartView })), { ssr: false, loading: () => <LazyTabLoader label="الشارت التفاعلي" height="h-[600px]" /> }),
  'الشارت التفاعلي',
  { height: 'h-[600px]' },
);
const AboutView = dynamic(() => import('@/components/about/AboutView').then(m => ({ default: m.AboutView })), { ssr: false });
// SniperView removed — merged into MarketAnalysisView persona tabs

// Crypto additional views - loaded as a batch
// V40.4 §6 Phase 6: CryptoRecommendationsView + CryptoAnalysisView removed
// (archived to _archived_v404/) — the unified MarketAnalysisView now
// handles #crypto-recommendations + #crypto-analysis via initialMarket prop.
let CryptoLearningView: React.ComponentType | null = null;
let CryptoSimulationView: React.ComponentType | null = null;

// Lazy load crypto views
const cryptoViewsPromise = import('@/components/crypto/CryptoAdditionalViews').then(m => {
  CryptoLearningView = m.CryptoLearningView;
  CryptoSimulationView = m.CryptoSimulationView;
});

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

  // Valid views for URL hash
  const validViews = [
    // EGX
    'dashboard', 'stocks', 'screener', 'portfolio', 'watchlist', 'recommendations', 'reports',
    'learning', 'simulation', 'academy', 'advanced-analysis', 'unified-analysis', 'specialist-analysis',
    // prediction-performance + prediction-credibility moved to Admin panel only
    // (under development — data quality issues being fixed via backtesting loop)
    'advanced-portfolio', 'seasonality',
    'prediction-tracking',
    'picks-management',
    // Smart Assistant
    'smart-confluence',
    // Intelligence
    'alerts-center', 'trading-memory',
    'live-monitor', 'wealth',
    // Trading Journal
    'trading-journal',
    // Publishing
    'publishing',
    // Crypto
    'crypto', 'crypto-live', 'crypto-portfolio', 'crypto-watchlist', 'crypto-recommendations',
    'crypto-analysis', 'crypto-learning', 'crypto-simulation',
    // Islamic
    'zakat', 'tithes',
    // Other
    'subscription', 'settings', 'auth', 'admin',
    // Trading Chart (interactive)
    'trading-chart',
    // Hidden/Legacy
    'finance', 'backtesting', 'analysis', 'v2-analysis'
  ];

  // Initialize from URL hash on mount
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash = window.location.hash.slice(1); // Remove #
    if (hash && validViews.includes(hash)) {
      setCurrentViewFromHash(hash as typeof currentView);
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

  // Direct hash → view sync (robust fallback that survives hydration errors)
  // Reads URL hash on mount and on hashchange, sets the current view directly.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const VALID_VIEWS = new Set([
      'dashboard', 'stocks', 'screener', 'portfolio', 'watchlist', 'recommendations', 'reports',
      'learning', 'simulation', 'academy', 'advanced-analysis', 'unified-analysis', 'specialist-analysis',
      'advanced-portfolio', 'seasonality', 'prediction-tracking', 'picks-management', 'smart-confluence',
      'alerts-center', 'trading-memory', 'live-monitor', 'wealth', 'trading-journal',
      'publishing', 'crypto', 'crypto-live', 'crypto-portfolio', 'crypto-watchlist',
      'crypto-recommendations', 'crypto-analysis', 'crypto-learning', 'crypto-simulation',
      'zakat', 'tithes', 'subscription', 'settings', 'auth', 'admin', 'trading-chart',
      'about', 'finance', 'backtesting', 'analysis', 'v2-analysis',
    ]);

    const applyHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash && VALID_VIEWS.has(hash)) {
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
      case 'picks-management':
        return <PicksManagementView />;
      case 'reports':
        return <ReportsView />;
      case 'learning':
        return <LearningView />;
      case 'simulation':
        return <SimulationView />;
      case 'academy':
        return <AcademyView />;
      case 'advanced-portfolio':
        return <AdvancedPortfolioManager />;
      case 'seasonality':
        return <SeasonalityDashboard />;
      // sniper merged into analysis
      
      // === المساعد المالي الذكي (Smart Assistant) ===
      case 'smart-confluence':
        return <SmartConfluenceView />;
      
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
      
      // === العملات الرقمية (Crypto) — COMPLETE UI MIRROR ===
      // Carbon copy of stocks: same DashboardView / StocksView / Watchlist,
      // only the data source changes (currentMarket='CRYPTO' is set by the
      // Sidebar when a crypto nav item is clicked).
      case 'crypto':
        return <DashboardView />;
      case 'crypto-live':
        return <StocksView />;
      case 'crypto-portfolio':
        return <CryptoPortfolioView />;
      case 'crypto-watchlist':
        return <EnhancedWatchlistView />;
      case 'crypto-recommendations':
        // V40.4 §5 UI Mirror Protocol: crypto views use the SAME unified
        // MarketAnalysisView shell as stocks, with initialMarket="CRYPTO".
        return <MarketAnalysisView initialMarket="CRYPTO" />;
      case 'crypto-analysis':
        return <MarketAnalysisView initialMarket="CRYPTO" />;
      case 'crypto-learning':
        return CryptoLearningView ? <CryptoLearningView /> : <div className="p-4">Loading...</div>;
      case 'crypto-simulation':
        return CryptoSimulationView ? <CryptoSimulationView /> : <div className="p-4">Loading...</div>;
      
      // === حسابات دينية ===
      case 'zakat':
        return <ZakatView />;
      case 'tithes':
        return <TithesView />;
       
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

      default:
        return <DashboardView />;
    }
  };

  const isChartView = currentView === 'trading-chart' || currentView === 'screener';

  return (
    <AuthGate>
      <div className="min-h-screen flex flex-col bg-background">
        <DbSchemaInit />
        <SessionSync />
        <UrlHashSync />
        <RealtimeTicker />
        {/* P20-CENTRAL-ALERTS: الجرس المركزي — بيراقب /api/sniper/scan كل 60ث
            ويطلع صوت + toast للإشارات الجديدة/المتغيرة (مشروط بتفعيل التنبيهات) */}
        <CentralAlertMonitor />
        <AppGuideAutoOpen />
        <div className="flex-1 flex flex-col lg:flex-row">
          <Sidebar />
          <div className="flex-1 min-w-0 w-full lg:mr-64 transition-all duration-300 flex flex-col">
            <main className="pb-24 lg:pb-8 flex-1 min-h-screen overflow-y-auto">
              {renderView()}
            </main>
            <Footer />
          </div>
          <MobileNav />
        </div>
        <FloatingAssistant />
        {/* ROBO-ADVISOR-P2: زر التنبيهات الحية — عائم في أسفل اليسار */}
        <div className="fixed bottom-4 left-4 z-40">
          <RoboNotifierToggle />
        </div>
        <NotificationCenter />
        <Toaster position="top-center" dir="rtl" />
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

export default function Home() {
  return <AppShell />;
}
