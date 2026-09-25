'use client';
import { InvestorsFlowPanel } from './InvestorsFlowPanel';

import React, { useState, useEffect, useMemo } from 'react';
import { Download, Zap, RefreshCw, Pin } from 'lucide-react';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { MarketSummary } from '@/components/dashboard/MarketSummary';
import { IndexCards } from '@/components/dashboard/IndexCards';
import { TopMovers } from '@/components/dashboard/TopMovers';
import { MarketSentiment } from '@/components/dashboard/MarketSentiment';

import { CryptoSignalsWidget } from '@/components/dashboard/CryptoSignalsWidget';
import { SeasonalitySignalsWidget } from '@/components/dashboard/SeasonalitySignalsWidget';
import { EidPredictionsWidget } from '@/components/eid-predictions-widget';
import { AutoAnalysisWidget } from '@/components/auto-analysis-widget';
import { MaestroWidget } from '@/components/dashboard/MaestroWidget';
import { LiveStockTicker } from '@/components/dashboard/LiveStockTicker';
import { MarketPulseWidget } from '@/components/dashboard/MarketPulseWidget';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { ShareButton } from '@/components/share/ShareButton';
import { StockSelector } from '@/components/stocks/StockSelector';
import { toast } from 'sonner';
import { SafeWidget } from '@/components/dashboard/SafeWidget';
import { DevelopmentNotice } from '@/components/dashboard/DevelopmentNotice';
import { MultiMarketWidget } from '@/components/dashboard/MultiMarketWidget';
import { AssetPreferenceOnboarding } from '@/components/dashboard/AssetPreferenceOnboarding';
import { PinnableWidget } from '@/components/dashboard/PinnableWidget';

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
      <InvestorsFlowPanel />
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
  const { isLoading, loadDashboard, marketOverview, currentMarket, assetPreference, pinnedWidgets } = useAppStore();
  const [exporting, setExporting] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  // ---------- Widget registry (P5-MOBILE-UX Part B) ----------
  // Each entry controls (a) asset-preference visibility and (b) pin toggle.
  const widgets: WidgetDescriptor[] = useMemo(() => [
    {
      id: 'market-summary',
      title: 'ملخص السوق',
      visible: (p) => p !== 'crypto',
      render: () => <MarketSummary />,
    },
    {
      id: 'index-cards',
      title: 'المؤشرات',
      visible: (p) => p !== 'crypto',
      render: () => <IndexCards />,
    },
    {
      id: 'market-pulse',
      title: 'نبض السوق',
      visible: (p) => p !== 'crypto',
      render: () => <MarketPulseWidget />,
    },
    {
      id: 'market-sentiment',
      title: 'مؤشر المشاعر',
      visible: (p) => p !== 'crypto',
      render: () => <MarketSentiment />,
    },
    {
      id: 'eid-predictions',
      title: 'توقعات اليوم',
      visible: (p) => p !== 'crypto',
      render: () => <EidPredictionsWidget />,
    },
    {
      id: 'auto-analysis',
      title: 'التحليل الآلي',
      visible: (p) => p !== 'crypto',
      render: () => <AutoAnalysisWidget />,
    },
    {
      id: 'top-movers',
      title: 'الأكثر تحركاً',
      visible: (p) => p !== 'crypto',
      render: () => <TopMovers />,
    },
    {
      id: 'maestro',
      title: 'لوحة القيادة',
      visible: (p) => p !== 'crypto',
      render: () => <MaestroWidget />,
    },
    {
      id: 'crypto-signals',
      title: 'إشارات الكريبتو',
      visible: (p) => p === 'crypto' || p === 'all',
      render: () => <CryptoSignalsWidget />,
    },
    {
      id: 'seasonality',
      title: 'إشارات الموسمية',
      visible: (p) => p !== 'gold',
      render: () => <SeasonalitySignalsWidget />,
    },
    {
      id: 'multi-market',
      title: 'الأسواق المتعددة',
      visible: (p) => p !== 'gold',
      render: () => <MultiMarketWidget />,
    },
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

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* First-visit asset preference onboarding (P5-MOBILE-UX Part B.1) */}
      <AssetPreferenceOnboarding />

      <Header
        title="لوحة التحكم"
        subtitle={`نظرة عامة على ${marketNameAr}`}
      />
      <div className="px-3 md:px-4 print:hidden">
        {/* Quick Stock Lookup */}
        <Card className="mb-3 py-0 gap-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold">
                {currentMarket === 'CRYPTO' ? 'بحث سريع عن عملة' : 'بحث سريع عن سهم'}
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
            تحديث
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
              change: marketOverview?.indices?.[0]?.change ?? 0,
              recommendation: marketOverview?.market_status?.is_open ? 'السوق مفتوح' : 'السوق مغلق',
              recommendationAr: marketOverview?.market_status?.is_open ? 'السوق مفتوح' : 'السوق مغلق',
              sector: 'نظرة عامة على السوق',
            }}
          />
          <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" />
            {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
          </Button>
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
          <div id="dashboard-export" className="space-y-4 p-3 md:p-4" dir="rtl">
            {/* Pinned section — widgets the user pinned appear at the top */}
            {showPinnedSection && (
              <section aria-label="ودجات مثبتة" className="space-y-3">
                <div className="flex items-center gap-2 px-1" dir="rtl">
                  <Pin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
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

            {/* 1. ملخص وحالة السوق */}
            {(() => {
              const w = layout.find((x) => x.id === 'market-summary');
              if (!w || w.pinned) return null;
              return (
                <section aria-label="ملخص السوق">
                  {renderWrapped(w)}
                </section>
              );
            })()}

            {/* 2. المؤشرات */}
            {(() => {
              const w = layout.find((x) => x.id === 'index-cards');
              if (!w || w.pinned) return null;
              return (
                <section aria-label="المؤشرات">
                  {renderWrapped(w)}
                </section>
              );
            })()}

            {/* 3. نبض السوق والمشاعر اللحظية */}
            {(() => {
              const items = layout.filter((x) => x.id === 'market-pulse' || x.id === 'market-sentiment');
              const visible = items.filter((x) => !x.pinned);
              if (visible.length === 0) return null;
              return (
                <section
                  aria-label="نبض السوق ومؤشر المشاعر"
                  className="grid grid-cols-1 lg:grid-cols-2 gap-4"
                >
                  {visible.map((w) => (
                    <React.Fragment key={w.id}>{renderWrapped(w)}</React.Fragment>
                  ))}
                </section>
              );
            })()}

            {/* 4. توقعات اليوم والتحليل الآلي */}
            {(() => {
              const items = layout.filter((x) => x.id === 'eid-predictions' || x.id === 'auto-analysis');
              const visible = items.filter((x) => !x.pinned);
              if (visible.length === 0) return null;
              return (
                <section
                  aria-label="توقعات اليوم والتحليل الآلي"
                  className="grid grid-cols-1 lg:grid-cols-2 gap-4"
                >
                  {visible.map((w) => (
                    <React.Fragment key={w.id}>{renderWrapped(w)}</React.Fragment>
                  ))}
                </section>
              );
            })()}

            {/* 5. الأكثر تحركاً ولوحة القيادة */}
            {(() => {
              const items = layout.filter((x) => x.id === 'top-movers' || x.id === 'maestro');
              const visible = items.filter((x) => !x.pinned);
              if (visible.length === 0) return null;
              return (
                <section
                  aria-label="الأكثر تحركاً ولوحة القيادة"
                  className="grid grid-cols-1 lg:grid-cols-2 gap-4"
                >
                  {visible.map((w) => (
                    <React.Fragment key={w.id}>{renderWrapped(w)}</React.Fragment>
                  ))}
                </section>
              );
            })()}

            {/* 6. إشارات التداول والمواسم */}
            {(() => {
              const crypto = layout.find((x) => x.id === 'crypto-signals');
              const season = layout.find((x) => x.id === 'seasonality');
              const cryptoVisible = crypto && !crypto.pinned;
              const seasonVisible = season && !season.pinned;
              if (!cryptoVisible && !seasonVisible) return null;

              // Show crypto + seasonality side-by-side when both visible
              if (cryptoVisible && seasonVisible) {
                return (
                  <section
                    aria-label="إشارات التداول والمواسم"
                    className="grid grid-cols-1 lg:grid-cols-2 gap-4"
                  >
                    {renderWrapped(crypto!)}
                    {renderWrapped(season!)}
                  </section>
                );
              }
              return (
                <section aria-label="إشارات التداول والمواسم">
                  {cryptoVisible && renderWrapped(crypto!)}
                  {seasonVisible && renderWrapped(season!)}
                </section>
              );
            })()}

            {/* 7. الأسواق المتعددة والأخبار */}
            {(() => {
              const items = layout.filter((x) => x.id === 'multi-market');
              const visible = items.filter((x) => !x.pinned);
              if (visible.length === 0) return null;
              return (
                <section
                  aria-label="الأسواق المتعددة"
                  className="grid grid-cols-1 lg:grid-cols-2 gap-4"
                >
                  {visible.map((w) => (
                    <React.Fragment key={w.id}>{renderWrapped(w)}</React.Fragment>
                  ))}
                </section>
              );
            })()}

            {/* Empty-state when asset preference filters out everything */}
            {eligibleWidgets.length === 0 && (
              <section className="text-center py-12" dir="rtl">
                <p className="text-sm text-muted-foreground">
                  مفيش ودجات متاحة لتفضيل الأصول ده حالياً. تقدر تغيّر التفضيل من الإعدادات.
                </p>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
