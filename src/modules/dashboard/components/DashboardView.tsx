'use client';

// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// Phase 0 already removed the MaestroWidget import. The two legacy comment
// lines below are retained for traceability — no maestro engine code remains
// in this file. Dashboard fetches go through unified API routes only.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Download, Zap, RefreshCw, Pin } from 'lucide-react';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { MarketSummary } from '@/modules/dashboard/components/MarketSummary';
import { IndexCards } from '@/modules/dashboard/components/IndexCards';
import { TopMovers } from '@/modules/dashboard/components/TopMovers';
import { RealtimeTicker } from '@/modules/dashboard/components/RealtimeTicker';

import { CryptoSignalsWidget } from '@/modules/dashboard/components/CryptoSignalsWidget';
import { SeasonalitySignalsWidget } from '@/modules/dashboard/components/SeasonalitySignalsWidget';
import { EidPredictionsWidget } from '@/components/eid-predictions-widget';
import { AutoAnalysisWidget } from '@/components/auto-analysis-widget';
// ─── PHASE-0 (Task UNIFICATION-PHASE-0) ──────────────────────────────────
// MaestroWidget import تم تعطيله (Rule 73: SINGLE-DISPLAY-SOURCE).
// Maestro محرك قرار مختلف الـ thresholds — مش canonical.
// import { MaestroWidget } from '@/modules/dashboard/components/MaestroWidget';
import { LiveStockTicker } from '@/modules/dashboard/components/LiveStockTicker';
import { MarketPulseWidget } from '@/modules/dashboard/components/MarketPulseWidget';
// SCR-001: VIP Live Signals Feed — أعلى الـ Dashboard (Bloomberg Terminal Feel)
import { VIPLiveSignalsFeed } from '@/components/shared/VIPLiveSignalsFeed';
// PORTFOLIO-INTEGRATION: ربط المحفظة بالدashboard — عمود من أعمدة المنصة
import { LiveMonitor } from '@/modules/dashboard/components/LiveMonitor';
// A11Y-FIX (2026-10-09, Team 8): wrap major widgets في ErrorBoundary
import { withErrorBoundary, ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { TimeHorizonBadge } from '@/components/shared/TimeHorizonBadge';
// MARKET-DEPTH-VIEW: InvestorsFlowPanel + LiquidityFlowPanel + IntradayPressurePanel
// اتشالوا من هنا واتنقلوا لشاشة #market-depth المنفصلة (Owner directive: شاشة
// منفصلة من قائمة الأعلى). الـ Dashboard دلوقتي نضيف بدونها.
// FOCUS-5-TASKS (2026-10-01): MyStocksBriefing — الـ widget الشخصي للعميل.
// بيجيب /api/portfolio/unified-watch (محفظة + توقعات + advice + exit_radar)
// + /api/news?tickers=... (أخبار مفلترة). بيتعرض في أول الـ dashboard للعميل
// المسجّل — عشان أول حاجة يشوفها الصبح هي: محفظته + تنبيهاته + أخباره.
import { MyStocksBriefing } from '@/modules/dashboard/components/MyStocksBriefing';
// FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): useTranslation hook.
import { useTranslation } from '@/lib/i18n-context';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { ShareButton } from '@/components/share/ShareButton';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockSelector } from '@/modules/stock-analysis/components/StockSelector';
import { toast } from 'sonner';
import { SafeWidget } from '@/modules/dashboard/components/SafeWidget';
import { VIPLiveSignalsFeed } from '@/components/shared/VIPLiveSignalsFeed';
import { DevelopmentNotice } from '@/modules/dashboard/components/DevelopmentNotice';
// MultiMarketWidget اتشال من هنا — بقى في شاشة #market-depth المنفصلة (Owner directive).
// Owner directive: "الأسواق المتعددة → عملات + ذهب فقط" بقت شاشة مستقلة مع حركة
// السيولة + تدفّق المستثمرين + ضغط الجلسة (عمق السوق من قائمة الأعلى).
import { AssetPreferenceOnboarding } from '@/modules/dashboard/components/AssetPreferenceOnboarding';
import { PinnableWidget } from '@/modules/dashboard/components/PinnableWidget';

function DashboardSkeleton() {
  return (
    <div className="space-y-3 p-3 md:p-4" dir="rtl">
      {/* Summary skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-3">
            <Skeleton className="h-3 w-14 mb-1.5" />
            <Skeleton className="h-6 w-10 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Index cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-3">
            <Skeleton className="h-4 w-12 mb-2" />
            <Skeleton className="h-3 w-20 mb-1" />
            <Skeleton className="h-5 w-24 mb-1.5" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Bottom section skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border p-3">
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-7 w-7 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-14 mb-0.5" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="flex justify-center mb-3">
            <Skeleton className="h-28 w-28 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Widget descriptor. Each major dashboard widget is registered here so the
 * pin/personalization layer can reorder, filter, and wrap them uniformly.
 */
interface WidgetDescriptor {
  id: string;
  title: string;
  /**
   * Whether the widget should be visible for the given asset preference.
   * Defaults to true for 'all'.
   */
  visible: (pref: 'stocks' | 'crypto' | 'gold' | 'all') => boolean;
  render: () => React.ReactNode;
}

export function DashboardView() {
  const { isLoading, loadDashboard, marketOverview, currentMarket, assetPreference, pinnedWidgets, stocks, v2Data } = useAppStore();
  // FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): translator hook.
  const t = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('dashboard-export');
      if (!element) {
        toast.error('لم يتم العثور على محتوى لوحة التحكم');
        return;
      }
      await exportToPdf(element, {
        filename: `${currentMarket.toLowerCase()}_dashboard_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  // Get market name for subtitle
  const marketNameAr = MARKET_NAMES_AR[currentMarket];

  // نص المشاركة للوححة التحكم — ينتج تلقائياً من حالة السوق الحالية.
  const dashboardShareText = useMemo(() => {
    const idxVal = marketOverview?.indices?.[0]?.value;
    const idxChg = marketOverview?.indices?.[0]?.change_percent;
    const isOpen = marketOverview?.market_status?.is_open;
    const lines: string[] = [
      `📊 لوحة تحكم ${marketNameAr}`,
      '',
      idxVal != null ? `قيمة المؤشر: ${idxVal.toLocaleString('ar-EG')}` : '',
      idxChg != null ? `التغير: ${idxChg >= 0 ? '+' : ''}${idxChg.toFixed(2)}%` : '',
      `حالة السوق: ${isOpen ? 'مفتوح' : 'مغلق'}`,
      '',
      '🔔 تابع تحليلات السوق المصرية لحظياً عبر منصة دليل الاستثمار.',
    ].filter(Boolean);
    return lines.join('\n');
  }, [marketOverview, marketNameAr]);

  // ---------- Widget registry ----------
  // Owner directive (2026-10-05): تنظيف شامل للوحة التحكم
  // 1. دمج نبض السوق + مؤشر المشاعر → مكون واحد
  // 2. توقعات اليوم تتبع السوق المختار
  // 3. شيل التحليل الآلي (مش مفيد)
  // 4. الأكثر تحركاً تتبع السوق
  // 5. الأسواق المتعددة → عملات + ذهب فقط
  // 6. دمج ملخص السوق + المؤشرات
  // 7. حركة السيولة + المستثمرين + ضغط الجلسة → شاشة منفصلة (EGX)
  // 9. إشارات الكريبتو → CRYPTO فقط
  // 10. شيل إشارات الموسمية
  const widgets: WidgetDescriptor[] = useMemo(() => [
    // 6. ملخص السوق + المؤشرات (مدموج — Owner directive)
    // FIX (Task MARKET-SEPARATION): إخفاء مؤشرات EGX في الأسواق التانية
    // EGX30/70/100 ملهاش معنى في السوق الأمريكي أو الكريبتو.
    {
      id: 'market-summary',
      title: 'ملخص السوق والمؤشرات',
      visible: () => currentMarket === 'EGX',
      render: () => (
        <div className="space-y-3">
          <MarketSummary />
          <IndexCards />
        </div>
      ),
    },
    // 1. نبض السوق + مؤشر المشاعر (مدموج — Owner directive)
    // FIX (Task MARKET-SEPARATION): MarketPulse + Sentiment للـ EGX فقط
    // (بيجيبوا EGX30/70 data من /api/market-pulse).
    {
      id: 'market-pulse',
      title: 'نبض السوق والمشاعر',
      visible: () => currentMarket === 'EGX',
      render: () => (
        // T-ALPHA-3: Removed dead <MarketSentiment /> (was showing 50 neutral + 0/0).
        // <MarketPulseWidget /> now takes full width — it's the real, working pulse gauge.
        <ErrorBoundary title="نبض السوق">
          <MarketPulseWidget />
        </ErrorBoundary>
      ),
    },
    // 2. توقعات اليوم (تتبع السوق المختار — Owner directive)
    {
      id: 'eid-predictions',
      title: 'توقعات اليوم',
      visible: () => true,
      render: () => <EidPredictionsWidget />,
    },
    // 3. التحليل الآلي — تم إزالته (Owner directive: "مش شايفله أي لزمة")
    // 4. الأكثر تحركاً (تتبع السوق — Owner directive)
    {
      id: 'top-movers',
      title: 'الأكثر تحركاً',
      visible: () => true,
      render: () => <TopMovers />,
    },
    // 5. الأسواق المتعددة (عملات + ذهب) — اتشال من Dashboard (Owner directive:
    // "شاشة منفصلة من قائمة الأعلى"). الـ widget ده بقى في #market-depth مع
    // حركة السيولة + تدفّق المستثمرين + ضغط الجلسة.
    // محفظتي
    {
      id: 'live-monitor',
      title: 'محفظتي',
      visible: () => true,
      render: () => <ErrorBoundary title="المراقبة اللحظية"><LiveMonitor /></ErrorBoundary>,
    },
    // 9. إشارات الكريبتو → CRYPTO فقط (Owner directive)
    {
      id: 'crypto-signals',
      title: 'إشارات الكريبتو',
      visible: (p) => p === 'crypto',
      render: () => <ErrorBoundary title="إشارات الكريبتو"><CryptoSignalsWidget /></ErrorBoundary>,
    },
    // 10. إشارات الموسمية — تم إزالتها (Owner directive: "شيلها خالص")
  ], []);

  // Effective preference: when the active market is CRYPTO, force crypto
  // widgets so the dashboard mirrors the stocks experience with crypto data.
  // This makes the crypto overview a true "carbon copy" of the stocks dashboard
  // — same layout, same widgets, only the data source differs.
  const effectivePref = currentMarket === 'CRYPTO' ? 'crypto' : assetPreference;

  // Eligible widgets (after effective-preference filter)
  const eligibleWidgets = useMemo(
    () => widgets.filter((w) => w.visible(effectivePref)),
    [widgets, effectivePref]
  );

  // Partition into pinned (top section) vs. normal (rest of layout)
  const pinnedSet = useMemo(() => new Set(pinnedWidgets), [pinnedWidgets]);
  const pinnedList = useMemo(
    () => eligibleWidgets.filter((w) => pinnedSet.has(w.id)),
    [eligibleWidgets, pinnedSet]
  );
  const isPinned = (id: string) => pinnedSet.has(id);

  // Section layout: original 7 sections, each now conditionally hides
  // widgets that are pinned (already shown at the top). Sections that
  // end up empty are skipped entirely.
  type LaidOutWidget = WidgetDescriptor & { pinned: boolean };
  const layout: LaidOutWidget[] = eligibleWidgets.map((w) => ({ ...w, pinned: pinnedSet.has(w.id) }));

  // Helper to render a widget wrapped in PinnableWidget + SafeWidget
  const renderWrapped = (w: WidgetDescriptor) => (
    <PinnableWidget id={w.id} title={w.title}>
      <SafeWidget name={w.title}>{w.render()}</SafeWidget>
    </PinnableWidget>
  );

  const showPinnedSection = mounted && pinnedList.length > 0;

  // ─── UNIFIED-MARKET-VIEW (Task 1): market-driven panels ─────────────────
  // InvestorsFlowPanel + LiquidityFlowPanel + IntradayPressurePanel اتشالوا
  // من الـ Dashboard واتنقلوا لشاشة #market-depth المنفصلة (MARKET-DEPTH-VIEW).
  // ما عدناش محتاجين showMarketFlowPanels flag في الـ dashboard نفسه.

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* First-visit asset preference onboarding (P5-MOBILE-UX Part B.1) */}
      <AssetPreferenceOnboarding />

      <Header
        title={t('dashboard.title')}
        subtitle={`${t('dashboard.subtitle')} — ${marketNameAr}`}
      />
      <div className="px-3 md:px-4 print:hidden">
        {/* Quick Stock Lookup */}
        <Card className="mb-3 py-0 gap-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
              <span className="text-xs font-semibold">
                {currentMarket === 'CRYPTO' ? t('dashboard.quickLookup') : t('dashboard.quickLookup')}
              </span>
            </div>
            <StockSelector
              placeholder="ابحث بالرمز أو الاسم للانتقال مباشرة..."
              compact
            />
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => loadDashboard()}
          >
            <RefreshCw className="w-4 h-4" />
            {t('common.refresh')}
          </Button>
          <ShareButton
            iconOnly={false}
            variant="outline"
            size="sm"
            stockData={{
              ticker: currentMarket === 'CRYPTO' ? 'BTC' : `${currentMarket}30`,
              name: currentMarket === 'CRYPTO' ? 'Bitcoin' : `${currentMarket} 30 Index`,
              nameAr: marketNameAr,
              price: marketOverview?.indices?.[0]?.value ?? 0,
              change: marketOverview?.indices?.[0]?.change_percent ?? 0,
              recommendation: marketOverview?.market_status?.is_open ? 'السوق مفتوح' : 'السوق مغلق',
              recommendationAr: marketOverview?.market_status?.is_open ? 'السوق مفتوح' : 'السوق مغلق',
              sector: 'نظرة عامة على السوق',
            }}
          />
          <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" />
            {exporting ? t('common.loading') : t('dashboard.exportPdf')}
          </Button>
          <UnifiedPublishButton
            content={dashboardShareText}
            title={`لوحة تحكم ${marketNameAr}`}
            image={dashboardRef}
            filename={`dashboard_${currentMarket}_${new Date().toISOString().slice(0, 10)}`}
            hashtags={['EGX', 'بورصة', 'توقعات']}
            variant="outline"
            size="sm"
          />
        </div>
      </div>

      {/* Development Notice for non-EGX markets */}
      <div className="px-3 md:px-4 print:hidden">
        <DevelopmentNotice />
      </div>
      {/* Live Stock Ticker - شريط الأسعار الحي (EGX فقط — مخفي في وضع الكريبتو) */}
      {currentMarket !== 'CRYPTO' && (
        <div className="px-3 md:px-4 print:hidden">
          <LiveStockTicker />
        </div>
      )}

      <main className="flex-1">
        {!mounted || isLoading ? (
          <DashboardSkeleton />
        ) : (
          <div id="dashboard-export" ref={dashboardRef} className="space-y-4 p-3 md:p-4" dir="rtl">

            {/* ═══════════════════════════════════════════════════════════════
                🏛️ SCR-001: VIP Live Signals Feed (Bloomberg Terminal Feel)
                أعلى الـ Dashboard — أفضل 5 فرص استثمارية لحظية + محول الأسواق
                (EGX, TADAWUL, KSE, QSE). Glassmorphism + emerald/amber palette.
                SafeWidget يمنع كراش الواجهة لو API فشل
                ═══════════════════════════════════════════════════════════════ */}
            <SafeWidget name="VIP Live Signals" fallback={null}>
              <VIPLiveSignalsFeed market={currentMarket} />
            </SafeWidget>

            {/* ═══════════════════════════════════════════════════════════════
                🎯 فرص جاهزة الآن (Top 3-5 opportunities for investors)
                Owner directive: "لوحة فرص حقيقية" — فوق كل حاجة
                ═══════════════════════════════════════════════════════════════ */}
            {v2Data?.stocks && v2Data.stocks.length > 0 && (() => {
              // T-ALPHA-A11: أفضل 3 فرص حقيقية فقط (Top 3) — بدون إزعاج أو أخطاء
              const opportunities = v2Data.stocks
                .filter(s => s.recommendation === 'Strong Buy' || s.recommendation === 'Buy')
                .sort((a, b) => b.compositeScore - a.compositeScore)
                .slice(0, 3);
              if (opportunities.length === 0) return null;
              return (
                <section aria-label="فرص جاهزة الآن" className="space-y-2">
                  <div className="flex items-center gap-2 px-1" dir="rtl">
                    <Zap className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      فرص جاهزة الآن ({opportunities.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {opportunities.map((stock) => {
                      const entry = stock.entryPrice || stock.currentPrice;
                      const stop = stock.exitStrategy?.stopLoss || 0;
                      const target = stock.exitStrategy?.targetPrice || 0;
                      // SCR-001: targetPrice2 may not exist on ExitStrategy type — cast safely
                      const target2 = (stock.exitStrategy as unknown as Record<string, unknown> | undefined)?.targetPrice2 as number | undefined || 0;
                      // UNIFY-FIX (Rule 20): R:R من Python (stock.rrRatio) — لا حساب client-side
                      const rr = (stock as unknown as Record<string, unknown>).rrRatio as number | undefined;
                      const rrDisplay = rr != null ? rr.toFixed(2) : '—';
                      const isStrong = stock.recommendation === 'Strong Buy';
                      return (
                        <Card
                          key={stock.ticker}
                          className={`border-r-4 ${isStrong ? 'border-r-emerald-500' : 'border-r-primary'} cursor-pointer hover:shadow-md transition-shadow`}
                          onClick={() => useAppStore.getState().setCurrentView('stock-detail') || useAppStore.getState().setSelectedTicker(stock.ticker)}
                          className={`glass-panel border-r-4 ${isStrong ? 'border-r-emerald-500' : 'border-r-teal-500'} cursor-pointer hover:shadow-md transition-shadow`}
                          onClick={() => { useAppStore.getState().setCurrentView('stock-detail'); useAppStore.getState().setSelectedTicker(stock.ticker); }}
                        >
                          <CardContent className="p-3 space-y-2">
                            {/* Header: ticker + signal */}
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-mono font-bold text-sm">{stock.ticker}</div>
                                <div className="text-xs text-muted-foreground truncate max-w-[120px]">{stock.nameAr || stock.name}</div>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isStrong ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-primary dark:bg-slate-800/40 dark:text-slate-300'}`}>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isStrong ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'}`}>
                                {stock.recommendationAr || stock.recommendation}
                              </span>
                            </div>
                            {/* Entry / Stop / Target */}
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div>
                                <div className="text-muted-foreground">دخول</div>
                                <div className="font-mono font-semibold">{entry > 0 ? (entry ?? 0).toFixed(2) : '—'}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">وقف</div>
                                <div className="font-mono font-semibold text-red-600 dark:text-red-400">{stop > 0 ? (stop ?? 0).toFixed(2) : '—'}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">هدف</div>
                                <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{target > 0 ? (target ?? 0).toFixed(2) : '—'}</div>
                              </div>
                            </div>
                            {/* R:R + Confidence */}
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">R/R: <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{rrDisplay}</span></span>
                              <span className="text-muted-foreground">ثقة: <span className="font-bold">{stock.confidence?.toFixed(0) || '—'}%</span></span>
                            </div>
                            {/* T-ALPHA-A1: Time Horizon Glowing Badge */}
                            {(stock as Record<string, unknown>).persona ? (
                              <TimeHorizonBadge persona={String((stock as Record<string, unknown>).persona)} size="sm" />
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            {/* ═══════════════════════════════════════════════════════════════
                📊 حالة السوق (one sentence — owner directive)
                ═══════════════════════════════════════════════════════════════ */}
            {v2Data?.market && (() => {
              const regime = v2Data.market.regime as unknown as Record<string, unknown> | undefined;
              // SCR-001: cast regime to Record for flexible property access (MarketRegime type varies)
              const trend = String(regime?.trend ?? regime?.regime ?? 'neutral');
              const isDefensive = trend === 'bear' || trend === 'distribution';
              const regimeText = String(regime?.regimeAr ?? regime?.regime_ar ?? trend ?? 'محايد');
              const advice = String(regime?.advice_ar ?? regime?.adviceAr ?? '')
                || (isDefensive
                  ? 'السوق دفاعي — قلل الحجم وركّز على وقف الخسارة'
                  : trend === 'bull'
                  ? 'السوق صاعد — ركّز على الأسهم ذات الـ RS العالي'
                  : 'السوق عرضي — انتظر فرص أوضح');
              return (
                <section aria-label="حالة السوق">
                  <div className={`rounded-lg border p-3 ${isDefensive ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30' : 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'}`}>
                    <div className="flex items-center gap-2">
                      {isDefensive ? (
                        <span className="text-red-600 dark:text-red-400 font-bold text-sm">⚠️ {advice}</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-300 font-bold text-sm">📊 {advice}</span>
                      )}
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* FOCUS-5-TASKS: تنبيهات أسهمك الشخصية — Owner directive: "تبقى أصغر أو في جانب" */}
            {/* خليها collapsible عشان مش تزحم الفرص فوق */}
            <details className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/10">
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300 select-none flex items-center gap-2">
                🔔 تنبيهات أسهمك الشخصية
              </summary>
              <div className="p-4 pt-0">
                <ErrorBoundary title="تنبيهات المحفظة">
                  <MyStocksBriefing />
                </ErrorBoundary>
              </div>
            </details>

            {/* Pinned section — widgets the user pinned appear at the top */}
            {showPinnedSection && (
              <section aria-label="ودجات مثبتة" className="space-y-3">
                <div className="flex items-center gap-2 px-1" dir="rtl">
                  <Pin className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-500 dark:text-emerald-300">
                  مثبتة ({pinnedList.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {pinnedList.map((w) => (
                    <React.Fragment key={w.id}>{renderWrapped(w)}</React.Fragment>
                  ))}
                </div>
              </section>
            )}

            {/* 1. ملخص السوق والمؤشرات (مدموج — Owner directive) */}
            {(() => {
              const w = layout.find((x) => x.id === 'market-summary');
              if (!w || w.pinned) return null;
              return (
                <section aria-label="ملخص السوق والمؤشرات">
                  {renderWrapped(w)}
                </section>
              );
            })()}

            {/* 2. نبض السوق والمشاعر (مدموج — Owner directive) */}
            {(() => {
              const w = layout.find((x) => x.id === 'market-pulse');
              if (!w || w.pinned) return null;
              return (
                <section aria-label="نبض السوق والمشاعر">
                  {renderWrapped(w)}
                </section>
              );
            })()}

            {/* 3. توقعات اليوم */}
            {(() => {
              const w = layout.find((x) => x.id === 'eid-predictions');
              if (!w || w.pinned) return null;
              return (
                <section aria-label="توقعات اليوم">
                  {renderWrapped(w)}
                </section>
              );
            })()}

            {/* 4. الأكثر تحركاً */}
            {(() => {
              const w = layout.find((x) => x.id === 'top-movers');
              if (!w || w.pinned) return null;
              return (
                <section aria-label="الأكثر تحركاً">
                  {renderWrapped(w)}
                </section>
              );
            })()}

            {/* 5. العملات والذهب — اتشال (نقل لشاشة #market-depth المنفصلة) */}

            {/* 6. إشارات الكريبتو (CRYPTO فقط — Owner directive) */}
            {(() => {
              const w = layout.find((x) => x.id === 'crypto-signals');
              if (!w || w.pinned) return null;
              return (
                <section aria-label="إشارات الكريبتو">
                  {renderWrapped(w)}
                </section>
              );
            })()}

            {/* 7. حركة المستثمرين + السيولة + ضغط الجلسة — اتشالوا (نقلوا لشاشة
                #market-depth المنفصلة من قائمة الأعلى — Owner directive). الـ Dashboard
                بقى نضيف بدونهم. للوصول: قائمة السوق ← عمق السوق. */}

            {/* Empty-state when asset preference filters out everything */}
            {eligibleWidgets.length === 0 && (
              <section className="text-center py-12" dir="rtl">
                <p className="text-sm text-muted-foreground">
                  لا توجد ودجات متاحة لتفضيل الأصول هذا حالياً. يمكنك تغيير التفضيل من الإعدادات.
                </p>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
