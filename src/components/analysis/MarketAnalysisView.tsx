'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Layers, Radar, Target } from 'lucide-react';
import { useAppStore, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { OFFICIAL_LINKS } from '@/lib/official-links';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { PredictionTrackingDashboard } from '@/components/predictions/PredictionTrackingDashboard';
import { MakerRadarTab } from '@/components/predictions/MakerRadarTab';
import { ExecutiveReportView } from '@/components/reports/ExecutiveReportView';
import { HorizontalSectorsBar } from '@/components/analysis/market-analysis/MorningBellSection';
import { MARKET_CODES, _isEgxIntradayNow } from '@/components/analysis/market-analysis/helpers';
import type { MarketAnalysisViewProps } from '@/components/analysis/market-analysis/types';

// PHASE3-BUNDLE-OPT: tab contents extracted to market-analysis/ submodules and
// lazy-loaded with next/dynamic so each tab is split into its own chunk.
// This dramatically reduces the initial bundle of MarketAnalysisView: instead
// of downloading the entire god-component upfront (≈9.4MB), the browser now
// only fetches the active tab's code on demand.
const MarketStatusTab = dynamic(
  () => import('@/components/analysis/market-analysis/MarketStatusTab').then(m => ({ default: m.MarketStatusTab })),
  { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> }
);

const PersonaTab = dynamic(
  () => import('@/components/analysis/market-analysis/PersonaTab').then(m => ({ default: m.PersonaTab })),
  { ssr: false, loading: () => <Skeleton className='h-[500px] w-full rounded-xl' /> }
);

const SectorTrackingTab = dynamic(
  () => import('@/components/analysis/market-analysis/SectorTrackingTab').then(m => ({ default: m.SectorTrackingTab })),
  { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> }
);

// ============================================================================
// MarketAnalysisView — thin orchestrator (PHASE3-BUNDLE-OPT).
//
// Before this refactor, this file was a 7753-line "god component" containing:
//   • 19 helper functions (formatting, mapping, persona mixing, etc.)
//   • 16 types/interfaces (StockData, PersonaData, StoredAnalysisItem, …)
//   • 14 inline sub-components (MarketStatusTab, PersonaTab, SectorTrackingTab,
//     PersonaCard, StockDetailPanel, CryptoPredictionsTab, MorningBellSection,
//     LiveTrackingTab, TomorrowPredictionsPanel, …)
//
// All of that has been split into ./market-analysis/ submodules:
//   • types.ts       — interfaces & type aliases
//   • helpers.ts     — formatting utilities + MARKET_CODES + _isEgxIntradayNow
//   • MarketStatusTab.tsx
//   • PredictionsTab.tsx (PredictionsPerformanceChart, ProofPredictionsTableView,
//     PreviousPredictionsArchive, PredictionsTab)
//   • ExpertPredictionsTab.tsx (ExpertPredictionsTableView, ExpertPredictionsTab)
//   • PersonaTab.tsx (PersonaCard, PersonaTableView, StockDetailPanel, PersonaTab)
//   • CryptoPredictionsTab.tsx
//   • SectorTrackingTab.tsx
//   • MorningBellSection.tsx (HorizontalSectorsBar, MorningBellSection)
//   • LiveTrackingTab.tsx (LiveTrackingTab, TomorrowPredictionsPanel + small tables)
//
// The three heaviest tabs (MarketStatusTab, PersonaTab, SectorTrackingTab) are
// lazy-loaded so each ships as its own JS chunk instead of being merged into
// the main MarketAnalysisView bundle.
//
// This file now only contains the tab container + routing (~200 lines).
// ============================================================================

export function MarketAnalysisView({ initialMarket }: MarketAnalysisViewProps = {}) {
  const [activeTab, setActiveTab] = useState('balanced');
  const { currentMarket, setCurrentMarket } = useAppStore();
  const marketCode = MARKET_CODES[currentMarket];
  // V40.4 §5: derive the currency label dynamically (EGP/SAR/KWD/QAR/USDT)
  // so the same shell renders the correct currency for every market.
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket];

  // V40.4 §5 UI Mirror Protocol: sync the initialMarket prop → store so all
  // sub-tabs (MarketStatusTab, PersonaTab, PredictionTrackingDashboard, …)
  // inherit the market automatically. Runs once on mount.
  useEffect(() => {
    if (initialMarket && initialMarket !== currentMarket) {
      setCurrentMarket(initialMarket);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarket]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const doPrefetch = async (force = false) => {
      const cache = useAnalysisStore.getState();
      // v3.66.9: لو force=true (session auto-refresh)، نتخطى الـ cache
      if (!force && cache.market === marketCode && cache.stocks && Date.now() - cache.lastFetched < 300000) {
        return;
      }

      useAnalysisStore.getState().setFetching(true);
      useAnalysisStore.getState().setMarket(marketCode);

      try {
        const [stocksRes, predsRes, storedRes] = await Promise.all([
          fetch(`/api/stocks?market=${marketCode}&limit=500`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ stocks: [] })),
          fetch(`/api/unified/predictions?market=${marketCode}&limit=50`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ predictions: [], closed_predictions: [] })),
          fetch(`/api/stored-analysis/results?market=${marketCode}&limit=100`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ data: [] })),
        ]);

        if (cancelled) return;
        useAnalysisStore.getState().setStocks(stocksRes.stocks || []);
        useAnalysisStore.getState().setPredictions(predsRes.predictions || [], predsRes.closed_predictions || []);
        useAnalysisStore.getState().setStoredAnalysis(storedRes.data || []);
      } finally {
        if (!cancelled) {
          useAnalysisStore.getState().setFetching(false);
          // 🔥 v3.66.9 LIVE: خلال جلسة EGX، اعادة جدولة كل 60 ثانية تلقائياً
          // (مش محتاج liveMode). بعد الجلسة: كل 5 دقايق لو liveMode مفعّل،
          // ولا حاجة لو مقفول. ده بيخلي الشاشة كلها حية خلال وقت التداول.
          const inSession = _isEgxIntradayNow();
          if (inSession) {
            timer = setTimeout(() => doPrefetch(true), 60000); // 60s during session
          } else if (useAnalysisStore.getState().liveMode) {
            timer = setTimeout(doPrefetch, 300000); // 5min after session if live
          }
        }
      }
    };

    doPrefetch();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [marketCode]);

  // 🔥 v3.66.9 LIVE: countdown badge لإظهار التحديث التلقائي القادم
  const [liveCountdown, setLiveCountdown] = useState(60);
  const [isLive, setIsLive] = useState(_isEgxIntradayNow());
  useEffect(() => {
    const checkSession = setInterval(() => {
      setIsLive(_isEgxIntradayNow());
    }, 60000);
    const countdown = setInterval(() => {
      setLiveCountdown((prev) => (prev <= 1 ? 60 : prev - 1));
    }, 1000);
    return () => {
      clearInterval(checkSession);
      clearInterval(countdown);
    };
  }, []);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Target className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-600 flex-shrink-0" />
          <span>متابعة التوقعات</span>
          {/* v3.66.9 LIVE badge — بيتحدث تلقائياً خلال جلسة EGX */}
          {isLive && (
            <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 animate-pulse">
              <Activity className="h-3 w-3" />
              LIVE · {liveCountdown}s
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <RefreshAnalyticsButton variant="glow" size="default" />
          <MarketSelector size="default" />
        </div>
      </div>

      {/* 🔔 P17 جرس الصباح — أعلى 3 فرص EGX فوق التبويبات */}
      {/* MorningBellSection — UNIFIED-BALANCED-ONLY: متعطل */}
      <HorizontalSectorsBar marketCode={marketCode} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex w-full overflow-x-auto sm:grid sm:grid-cols-3 lg:grid-cols-6 h-auto gap-1">
          {/* التبويب الأول: متابعة التوقعات — كل تفاصيل التوقعات السابقة */}
          <TabsTrigger value="tracking" className="flex items-center gap-1">
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline">متابعة التوقعات</span>
          </TabsTrigger>
          <TabsTrigger value="executive-report" className="flex items-center gap-1">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">ملخص التوقعات</span>
          </TabsTrigger>
          <TabsTrigger value="status" className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">حالة السوق</span>
          </TabsTrigger>
          {/* التوقعات الحية أثناء الجلسة + توقعات لحظية + متابعة حية */}
          <TabsTrigger value="balanced" className="flex items-center gap-1">
            <span className="text-base">⚖️</span>
            <span className="hidden sm:inline">التوقعات</span>
          </TabsTrigger>
          {/* Phase P5: تتبع حركة القطاعات */}
          <TabsTrigger value="sectors-tracking" className="flex items-center gap-1">
            <Layers className="h-4 w-4 text-teal-600" />
            <span className="hidden sm:inline">تتبع القطاعات</span>
          </TabsTrigger>
          {/* PHASE-2: رادار الميكرز — قائمة أسهم تحت الميكروسكوب + موجة انفجارية + اختراق مبكر */}
          <TabsTrigger value="maker-radar" className="flex items-center gap-1">
            <Radar className="h-4 w-4 text-emerald-600" />
            <span className="hidden sm:inline">رادار الميكرز</span>
          </TabsTrigger>
        </TabsList>

        {/* تبويب متابعة التوقعات — PredictionTrackingDashboard (كل التوقعات + من جاب الهدف + وقف الخسارة) */}
        <TabsContent value="tracking" className="mt-4">
          <PredictionTrackingDashboard market={currentMarket} />
        </TabsContent>

        <TabsContent value="executive-report" className="mt-4">
          <ExecutiveReportView market={currentMarket} />
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          <MarketStatusTab market={currentMarket} />
        </TabsContent>

        {/* تبويب التوقعات — PersonaTab (التوقعات الحية + اللحظية + المتابعة) */}
        <TabsContent value="balanced" className="mt-4">
          <PersonaTab market={currentMarket} persona="balanced" />
        </TabsContent>

        {/* Phase P5: تتبع حركة القطاعات */}
        <TabsContent value="sectors-tracking" className="mt-4">
          <SectorTrackingTab market={currentMarket} />
        </TabsContent>

        {/* PHASE-2: رادار الميكرز */}
        <TabsContent value="maker-radar" className="mt-4">
          <MakerRadarTab market={currentMarket === 'CRYPTO' ? 'EGX' : currentMarket} />
        </TabsContent>
      </Tabs>

      {/* Social Share Footer */}
      <Card className="mt-4 bg-muted/50">
        <CardContent className="p-3 text-center text-sm text-muted-foreground">
          <p>📍 تابع أحدث تحليلات السوق على</p>
          <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
            <a href={OFFICIAL_LINKS.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              invist.m2y.net
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.android} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Android
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.telegram} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Telegram
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.facebook} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Facebook
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.whatsapp} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              WhatsApp
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default MarketAnalysisView;
