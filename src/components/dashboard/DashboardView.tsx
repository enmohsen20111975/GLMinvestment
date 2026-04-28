'use client';

import React, { useState, useEffect } from 'react';
import { Download, Zap } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { MarketSummary } from '@/components/dashboard/MarketSummary';
import { IndexCards } from '@/components/dashboard/IndexCards';
import { TopMovers } from '@/components/dashboard/TopMovers';
import { MarketSentiment } from '@/components/dashboard/MarketSentiment';
import { GoldMarket } from '@/components/dashboard/GoldMarket';
import { CurrencyExchange } from '@/components/dashboard/CurrencyExchange';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { ShareButton } from '@/components/share/ShareButton';
import { StockSelector } from '@/components/stocks/StockSelector';
import { toast } from 'sonner';

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

export function DashboardView() {
  const { isLoading, loadDashboard, marketOverview } = useAppStore();
  const [exporting, setExporting] = useState(false);

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
        filename: `egx_dashboard_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header
        title="لوحة التحكم"
        subtitle="نظرة عامة على سوق الأوراق المالية المصرية"
      />
      <div className="px-3 md:px-4 print:hidden">
        {/* Quick Stock Lookup */}
        <Card className="mb-3 py-0 gap-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold">بحث سريع عن سهم</span>
            </div>
            <StockSelector
              placeholder="ابحث بالرمز أو الاسم للانتقال مباشرة..."
              compact
            />
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <ShareButton
            iconOnly={false}
            variant="outline"
            size="sm"
            stockData={{
              ticker: 'EGX30',
              name: 'EGX 30 Index',
              nameAr: 'مؤشر EGX 30',
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

      <main className="flex-1">
        {isLoading ? (
          <DashboardSkeleton />
        ) : (
          <div id="dashboard-export" className="space-y-3 p-3 md:p-4" dir="rtl">
            {/* Market Summary Stats */}
            <section aria-label="ملخص السوق">
              <MarketSummary />
            </section>

            {/* Index Cards */}
            <section aria-label="المؤشرات">
              <IndexCards />
            </section>

            {/* Top Movers + Sentiment */}
            <section
              aria-label="الأكثر تحركاً ومؤشر المشاعر"
              className="grid grid-cols-1 lg:grid-cols-2 gap-3"
            >
              <TopMovers />
              <MarketSentiment />
            </section>
          </div>
        )}

        {/* Gold + Currency Exchange — always visible, independent loading */}
        <section
          aria-label="أسعار الذهب والعملات"
          className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-3 md:px-4 pb-4"
        >
          <GoldMarket />
          <CurrencyExchange />
        </section>
      </main>
    </div>
  );
}
