import { StockDetailSheet } from '@/components/shared/StockDetailSheet';
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Layers, Target, History, Trophy, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { useAppStore, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { useTranslation } from '@/lib/i18n-context';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
// FOCUS-AUDIT-FIX (2026-10-01): UnifiedPredictionsTab بديل الـ 3 تابات المنفصلة
// (متابعة + ملخص + التوقعات) — كلهم بيقرأوا من نفس المصدر فدمجناهم في تاب واحد
// بـ 3 sub-views (الحالية / الأداء / الملخص) → بيانات متوافقة 100%.
import { UnifiedPredictionsTab } from '@/modules/market-analysis/components/UnifiedPredictionsTab';
// حافظنا على PredictionTrackingDashboard + ExecutiveReportView imports للتوثيق التاريخي
// بس الـ rendering دلوقتي بيمر عبر UnifiedPredictionsTab.
import { ExecutiveReportView } from '@/modules/reports/components/ExecutiveReportView';
import { HorizontalSectorsBar } from '@/modules/market-analysis/components/MorningBellSection';
import { MARKET_CODES, _isEgxIntradayNow } from '@/modules/market-analysis/components/helpers';
import type { MarketAnalysisViewProps } from '@/modules/market-analysis/components/types';
// Task 9-B Step 2: The 5 radar tabs (exit-radar / weekly-report /
// multi-market-radar / radar-accuracy / personalized-radar) have been MOVED
// from #recommendations (here) INTO #liquidity-radar (MakerRadarTab) as
// internal sub-tabs. They no longer belong in MarketAnalysisView. NetPicksTab
// stays here as the canonical "صافى التوقعات" view — it is no longer rendered
// inside MakerRadarTab (duplicate removed).
const NetPicksTab = dynamic(
  () => import('@/modules/radar/components/NetPicksTab').then(m => ({ default: m.NetPicksTab })),
  { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> }
);

// P1 #19 tabs (LiveTracking/ExpertPredictions/CryptoPredictions) REMOVED on 2026-09-28 per user request — caused UX clutter

const HistoricalTradesTable = dynamic(
  () => import('@/modules/market-analysis/components/HistoricalTradesTable').then(m => ({ default: m.HistoricalTradesTable })),
  { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> },
);

// PHASE3-BUNDLE-OPT: tab contents extracted to market-analysis/ submodules and
// lazy-loaded with next/dynamic so each tab is split into its own chunk.
// This dramatically reduces the initial bundle of MarketAnalysisView: instead
// of downloading the entire god-component upfront (≈9.4MB), the browser now
// only fetches the active tab's code on demand.
const MarketStatusTab = dynamic(
  () => import('@/modules/market-analysis/components/MarketStatusTab').then(m => ({ default: m.MarketStatusTab })),
  { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> }
);
// PersonaTab + PredictionTrackingDashboard + ExecutiveReportView دلوقتي بيتعرضوا
// جوّه UnifiedPredictionsTab (3 sub-views) — مش كـ tabs منفصلة.

const SectorTrackingTab = dynamic(
  () => import('@/modules/market-analysis/components/SectorTrackingTab').then(m => ({ default: m.SectorTrackingTab })),
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
  // FOCUS-AUDIT-FIX (2026-10-01): default tab بقى 'predictions' (التاب الموحّد)
  // بدل 'balanced' (اللي كان تاب منفصل). الـ 3 تابات القديمة (tracking + executive-report
  // + balanced) ادمجوا في تاب واحد بـ 3 sub-views.
  const [selectedSheetTicker, setSelectedSheetTicker] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('predictions');
  const { currentMarket, setCurrentMarket } = useAppStore();
  const t = useTranslation();
  const marketCode = MARKET_CODES[currentMarket];
  // V40.4 §5: derive the currency label dynamically (EGP/SAR/KWD/QAR/USDT)
  // so the same shell renders the correct currency for every market.
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket];

  // ── SCR-007: Track Record banner data from /api/v2/commercial-feed ──
  // (Rule 20: كل الأرقام من Python — لا حسابات في الواجهة)
  const [trackStats, setTrackStats] = useState<{
    winRate: number | null;
    totalClosed: number | null;
    wins: number | null;
    losses: number | null;
    profitFactor: number | null;
    avgReturn: number | null;
    activeCount: number | null;
    top5Count: number | null;
  }>({
    winRate: null, totalClosed: null, wins: null, losses: null,
    profitFactor: null, avgReturn: null, activeCount: null, top5Count: null,
  });

  const fetchTrackStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(currentMarket)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;
      const s = json.summary || {};
      const ap = s.audited_performance || {};
      setTrackStats({
        winRate: ap.win_rate ?? null,
        totalClosed: ap.total_closed ?? null,
        wins: ap.wins ?? null,
        losses: ap.losses ?? null,
        profitFactor: ap.profit_factor ?? null,
        avgReturn: ap.avg_return ?? null,
        activeCount: s.active_count ?? null,
        top5Count: s.top_5_count ?? null,
      });
    } catch {
      // silent — لا نعرض أخطاء للمستخدم (Rule 27 NO-FAKE-DATA)
    }
  }, [currentMarket]);

  useEffect(() => { fetchTrackStats(); }, [fetchTrackStats]);

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
          fetch(`/api/unified/predictions?market=${marketCode}&limit=5`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ predictions: [], closed_predictions: [] })),
          fetch(`/api/stored-analysis/results?market=${marketCode}&limit=100`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ data: [] })),
        ]);

        if (cancelled) return;
        useAnalysisStore.getState().setStocks((stocksRes.stocks || []) as Record<string, unknown>[]);
        useAnalysisStore.getState().setPredictions(
          (predsRes.predictions || []) as Record<string, unknown>[],
          (predsRes.closed_predictions || []) as Record<string, unknown>[],
        );
        useAnalysisStore.getState().setStoredAnalysis((storedRes.data || []) as unknown as Record<string, unknown>[]);
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
    <div className="stitch-canvas space-y-4 p-4 relative">
      <div className="relative z-10 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="stitch-latin text-xl sm:text-2xl font-bold flex items-center gap-2 text-stitch-on-surface">
          <Target className="h-5 w-5 sm:h-6 sm:w-6 text-stitch-primary flex-shrink-0" />
          <span>{t('marketAnalysis.title')}</span>
          {/* v3.66.9 LIVE badge — بيتحدث تلقائياً خلال جلسة EGX */}
          {isLive && (
            <span className="stitch-num inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-stitch-primary animate-pulse">
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

      {/* ── SCR-007: Track Record Banner (أرقام حقيقية من Python) ── */}
      {trackStats.totalClosed !== null && trackStats.totalClosed > 0 && (
        <Card className="stitch-glass overflow-hidden">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
              {/* Win Rate */}
              <div className="text-center">
                <div className="stitch-ar flex items-center justify-center gap-1 text-[10px] text-stitch-muted mb-1">
                  <Trophy className="w-3 h-3" />
                  <span>نسبة النجاح</span>
                </div>
                <p className="stitch-num text-lg sm:text-xl font-bold text-stitch-primary">
                  {trackStats.winRate !== null ? `${trackStats.winRate}%` : '—'}
                </p>
              </div>
              {/* Total Closed */}
              <div className="text-center">
                <div className="stitch-ar flex items-center justify-center gap-1 text-[10px] text-stitch-muted mb-1">
                  <BarChart3 className="w-3 h-3" />
                  <span>الصفقات المغلقة</span>
                </div>
                <p className="stitch-num text-lg sm:text-xl font-bold text-stitch-on-surface">
                  {trackStats.totalClosed ?? '—'}
                </p>
              </div>
              {/* Wins */}
              <div className="text-center">
                <div className="stitch-ar flex items-center justify-center gap-1 text-[10px] text-stitch-muted mb-1">
                  <TrendingUp className="w-3 h-3 text-stitch-primary" />
                  <span>رابحة</span>
                </div>
                <p className="stitch-num text-lg sm:text-xl font-bold text-stitch-primary">
                  {trackStats.wins ?? '—'}
                </p>
              </div>
              {/* Losses */}
              <div className="text-center">
                <div className="stitch-ar flex items-center justify-center gap-1 text-[10px] text-stitch-muted mb-1">
                  <TrendingDown className="w-3 h-3 text-rose-400" />
                  <span>خاسرة</span>
                </div>
                <p className="stitch-num text-lg sm:text-xl font-bold text-rose-400">
                  {trackStats.losses ?? '—'}
                </p>
              </div>
              {/* Profit Factor */}
              <div className="text-center">
                <div className="stitch-ar flex items-center justify-center gap-1 text-[10px] text-stitch-muted mb-1">
                  <Target className="w-3 h-3" />
                  <span>معامل الربحية</span>
                </div>
                <p className="stitch-num text-lg sm:text-xl font-bold text-stitch-on-surface">
                  {trackStats.profitFactor !== null ? trackStats.profitFactor : '—'}
                </p>
              </div>
              {/* Active + Top 5 */}
              <div className="text-center">
                <div className="stitch-ar flex items-center justify-center gap-1 text-[10px] text-stitch-muted mb-1">
                  <Activity className="w-3 h-3" />
                  <span>صفقات نشطة</span>
                </div>
                <p className="stitch-num text-lg sm:text-xl font-bold text-stitch-on-surface">
                  {trackStats.activeCount ?? '—'}
                  {trackStats.top5Count !== null && (
                    <span className="stitch-ar text-[10px] text-stitch-muted ms-1">(أقوى {trackStats.top5Count})</span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="stitch-glass flex w-full overflow-x-auto sm:grid sm:grid-cols-2 h-auto gap-1">
          <TabsTrigger value="predictions" className="stitch-ar flex items-center gap-1 text-stitch-muted data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
            <Target className="h-4 w-4 text-stitch-primary" />
            <span className="hidden sm:inline">غرفة الصفقات والأداء</span>
          </TabsTrigger>
          <TabsTrigger value="status" className="stitch-ar flex items-center gap-1 text-stitch-muted data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">حالة السوق ونبضه</span>
          </TabsTrigger>
        </TabsList>

        {/* T-ALPHA-A20: UnifiedPredictionsTab يحتوي على 4 sub-views:
            ⚡ الصفقات الحية | 📊 الأداء الموثق | 🏭 حركة القطاعات | 📋 الملخص */}
        <TabsContent value="predictions" className="mt-4">
          <UnifiedPredictionsTab market={currentMarket} />
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          <MarketStatusTab market={currentMarket} />
        </TabsContent>
      </Tabs>

      {/* Social Share Footer */}
      <Card className="stitch-glass mt-4">
        <CardContent className="p-3 text-center text-sm text-stitch-muted stitch-ar">
          <p>{t('marketAnalysis.socialFollow')}</p>
          <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
            <a href={OFFICIAL_LINKS.website} target="_blank" rel="noopener noreferrer" className="text-stitch-primary hover:underline">
              invist.m2y.net
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.android} target="_blank" rel="noopener noreferrer" className="text-stitch-primary hover:underline">
              Android
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.telegram} target="_blank" rel="noopener noreferrer" className="text-stitch-primary hover:underline">
              Telegram
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.facebook} target="_blank" rel="noopener noreferrer" className="text-stitch-primary hover:underline">
              Facebook
            </a>
            <span>|</span>
            <a href={OFFICIAL_LINKS.whatsapp} target="_blank" rel="noopener noreferrer" className="text-stitch-primary hover:underline">
              WhatsApp
            </a>
          </div>
        </CardContent>
      </Card>
      </div>
    
      <StockDetailSheet
        ticker={selectedSheetTicker}
        stockData={null}
        onClose={() => setSelectedSheetTicker(null)}
      />
</div>
  );
}

export default MarketAnalysisView;
