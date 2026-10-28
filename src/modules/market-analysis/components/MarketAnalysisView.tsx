'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
// ALPHA-SCREENER-UNIFY: Tabs imports removed — no more outer Tabs wrapper
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, Layers, Target, History } from 'lucide-react';
import { useAppStore, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { useTranslation } from '@/lib/i18n-context';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
// BLUEPRINT Phase 1: unified component library
import { ActionMenu } from '@/components/shared/ui';
import { Share2, Copy, Image as ImageIcon, FileText } from 'lucide-react';
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
// ALPHA-PHASE4: ReportsView import removed — التقارير لها مسارها المستقل #reports
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
// • 19 helper functions (formatting, mapping, persona mixing, etc.)
// • 16 types/interfaces (StockData, PersonaData, StoredAnalysisItem, …)
// • 14 inline sub-components (MarketStatusTab, PersonaTab, SectorTrackingTab,
// PersonaCard, StockDetailPanel, CryptoPredictionsTab, MorningBellSection,
// LiveTrackingTab, TomorrowPredictionsPanel, …)
//
// All of that has been split into ./market-analysis/ submodules:
// • types.ts — interfaces & type aliases
// • helpers.ts — formatting utilities + MARKET_CODES + _isEgxIntradayNow
// • MarketStatusTab.tsx
// • PredictionsTab.tsx (PredictionsPerformanceChart, ProofPredictionsTableView,
// PreviousPredictionsArchive, PredictionsTab)
// • ExpertPredictionsTab.tsx (ExpertPredictionsTableView, ExpertPredictionsTab)
// • PersonaTab.tsx (PersonaCard, PersonaTableView, StockDetailPanel, PersonaTab)
// • CryptoPredictionsTab.tsx
// • SectorTrackingTab.tsx
// • MorningBellSection.tsx (HorizontalSectorsBar, MorningBellSection)
// • LiveTrackingTab.tsx (LiveTrackingTab, TomorrowPredictionsPanel + small tables)
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
 // ALPHA-SCREENER-UNIFY: activeTab removed — no more outer Tabs
 const _activeTab = 'predictions'; // legacy compat (some code may reference)
 const { currentMarket, setCurrentMarket } = useAppStore();
 const t = useTranslation();
 const marketCode = MARKET_CODES[currentMarket] === 'KSA' ? 'TADAWUL' : MARKET_CODES[currentMarket];
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

 // 🔥 v3.66.9 LIVE: countdown badge معزول في مكون منفصل لمنع re-render للـ parent كل ثانية
 const [isLive, setIsLive] = useState(_isEgxIntradayNow());
 useEffect(() => {
 const checkSession = setInterval(() => {
 setIsLive(_isEgxIntradayNow());
 }, 60000);
 return () => clearInterval(checkSession);
 }, []);

 return (
 <div className="space-y-4 p-4">
 <div className="flex items-center justify-between flex-wrap gap-2">
 <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
 <Target className="h-5 w-5 sm:h-6 sm:w-6 text-profit flex-shrink-0" />
 <span>{t('marketAnalysis.title')}</span>
 {/* v3.66.9 LIVE badge — بيتحدث تلقائياً خلال جلسة EGX */}
 {isLive && <LiveCountdownBadge />}
 </h2>
 <div className="flex items-center gap-2 flex-wrap">
 <RefreshAnalyticsButton variant="glow" size="default" />
 <MarketSelector size="default" />
 </div>
 </div>

 {/* 🔔 P17 جرس الصباح — أعلى 3 فرص EGX فوق التبويبات */}
 {/* MorningBellSection — UNIFIED-BALANCED-ONLY: متعطل */}
 <HorizontalSectorsBar marketCode={marketCode} />

 {/* ALPHA-SCREENER-UNIFY: إزالة الـ Tabs الخارجية العقيمة.
 كان فيه Tabs بـ trigger واحد بس (predictions) + باقي التابات محذوفة.
 الشاشة دلوقتي تفتح مباشرة على صيد القيعان (Golden Dip) + الصفقات الحية. */}
 <div className="mt-4">
 <UnifiedPredictionsTab market={currentMarket} />
 </div>

 {/* Social Share Footer — BLUEPRINT Phase 2: ActionMenu موحد */}
 <Card className="mt-4 bg-muted/50">
 <CardContent className="p-3">
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <p className="text-sm text-muted-foreground">{t('marketAnalysis.socialFollow')}</p>
 <ActionMenu
 triggerVariant="button"
 triggerLabel="خيارات المشاركة"
 items={[
 { id: 'share', label: 'مشاركة الرابط', icon: Share2 },
 { id: 'copy', label: 'نسخ النص', icon: Copy },
 { id: 'image', label: 'تصدير صورة', icon: ImageIcon },
 { id: 'text', label: 'تصدير نص', icon: FileText },
 ]}
 onSelect={(id) => {
 if (typeof window !== 'undefined') {
 if (id === 'share' && navigator.share) {
 navigator.share({ title: 'دليل الاستثمار', url: window.location.href }).catch(() => {});
 } else if (id === 'copy') {
 navigator.clipboard?.writeText(window.location.href).catch(() => {});
 }
 }
 }}
 />
 </div>
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

// ─── ALPHA-SMOOTH-UX: مكون عداد معزول — بيتحرك كل ثانية بدون إعادة render الـ parent ───
function LiveCountdownBadge() {
 const [liveCountdown, setLiveCountdown] = useState(60);
 useEffect(() => {
 const countdown = setInterval(() => {
 setLiveCountdown((prev) => (prev <= 1 ? 60 : prev - 1));
 }, 1000);
 return () => clearInterval(countdown);
 }, []);
 return (
 <span className="inline-flex items-center gap-1 text-xs sm:text-xs font-bold px-2 py-0.5 rounded-full bg-profit/10 text-profit animate-pulse">
 <Activity className="h-3 w-3" />
 LIVE · {liveCountdown}s
 </span>
 );
}
