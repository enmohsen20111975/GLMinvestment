'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { StocksView } from '@/components/stocks/StocksView';
import { PortfolioView } from '@/components/portfolio/PortfolioView';
import { WatchlistView } from '@/components/watchlist/WatchlistView';
import { EnhancedPortfolioView } from '@/components/portfolio/EnhancedPortfolioView';
import { EnhancedWatchlistView } from '@/components/watchlist/EnhancedWatchlistView';
import { RecommendationsView } from '@/components/recommendations/RecommendationsView';
import { ReportsView } from '@/components/reports/ReportsView';
import { LearningView } from '@/components/learning/LearningView';
import { SimulationView } from '@/components/simulation/SimulationView';
import { SettingsView } from '@/components/settings/SettingsView';
import { AdminView } from '@/components/admin/AdminView';
import { AuthView } from '@/components/auth/AuthView';
import { StockAnalysisDashboard } from '@/components/stocks/StockAnalysisDashboard';
import { SubscriptionView } from '@/components/subscription/SubscriptionView';
import { RealtimeTicker } from '@/components/dashboard/RealtimeTicker';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

/**
 * DbSchemaInit — ensures finance tables exist on first load (once per session)
 */
function DbSchemaInit() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('finance_schema_init_done')) return;
    fetch('/api/finance/schema', { method: 'POST', cache: 'no-store' })
      .then(() => sessionStorage.setItem('finance_schema_init_done', '1'))
      .catch(() => {});
  }, []);
  return null;
}
import { Footer } from '@/components/layout/Footer';

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

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'stocks':
      case 'stock-detail':
        return <StocksView />;
      case 'portfolio':
        return <EnhancedPortfolioView />;
      case 'watchlist':
        return <EnhancedWatchlistView />;
      case 'finance':
        return <EnhancedPortfolioView />;
      case 'recommendations':
        return <RecommendationsView />;
      case 'reports':
        return <ReportsView />;
      case 'learning':
        return <LearningView />;
      case 'simulation':
        return <SimulationView />;
      case 'settings':
        return <SettingsView />;
      case 'admin':
        return <AdminView />;
      case 'analysis':
        return <StockAnalysisDashboard />;
      case 'subscription':
        return <SubscriptionView />;
      case 'auth':
        return <AuthView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <DbSchemaInit />
      <SessionSync />
      <RealtimeTicker />
      <div className="flex-1 flex">
        <Sidebar />
        <div className="flex-1 min-w-0 lg:mr-64 transition-all duration-300">
          <main className="pb-20 lg:pb-4 min-h-screen">
            {renderView()}
          </main>
        </div>
        <MobileNav />
      </div>
      <Footer />
      <NotificationCenter />
      <Toaster position="top-center" dir="rtl" />
    </div>
  );
}

export default function Home() {
  return <AppShell />;
}
