'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Download,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Minus,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  PieChart,
} from 'lucide-react';
import { ShareButton } from '@/components/share/ShareButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import type { MarketOverview, AiInsights } from '@/types';
import { toast } from 'sonner';

interface DailyMarketReportProps {
  printMode?: boolean;
}

/* ========== Report Header ========== */
function ReportHeader() {
  const today = new Date();
  const dateStr = today.toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="border-b-2 border-primary pb-4 mb-6 print:mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <BarChart3 className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">منصة استثمار EGX</h1>
            <p className="text-xs text-muted-foreground">Egyptian Investment Platform</p>
          </div>
        </div>
        <div className="text-left">
          <h2 className="text-lg font-bold text-foreground">تقرير السوق اليومي</h2>
          <p className="text-sm text-muted-foreground">{dateStr}</p>
        </div>
      </div>
    </div>
  );
}

/* ========== Stat Card ========== */
function StatCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
  subtext,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  subtext?: string;
}) {
  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
            <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
            {subtext && (
              <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
            )}
          </div>
          <div className={cn('flex-shrink-0 p-2.5 rounded-xl', bg)}>
            <Icon className={cn('w-5 h-5', color)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Index Performance Table ========== */
function IndexTable({
  indices,
}: {
  indices: MarketOverview['indices'];
}) {
  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          أداء المؤشرات
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-semibold">المؤشر</TableHead>
                <TableHead className="text-xs font-semibold text-left">القيمة</TableHead>
                <TableHead className="text-xs font-semibold text-left">التغيير</TableHead>
                <TableHead className="text-xs font-semibold text-left">النسبة %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {indices.map((idx) => {
                const val = Number(idx.value) || 0;
                const chg = Number(idx.change) || 0;
                const chgPct = Number(idx.change_percent) || 0;
                const isUp = chg >= 0;
                return (
                  <TableRow key={idx.symbol}>
                    <TableCell className="font-medium text-sm">{idx.name_ar}</TableCell>
                    <TableCell className="text-left tabular-nums text-sm font-semibold">
                      {val.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className={cn('text-left tabular-nums text-sm font-medium', isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      <span className="inline-flex items-center gap-1">
                        {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {Math.abs(chg).toLocaleString('ar-EG', { maximumFractionDigits: 2 })}
                      </span>
                    </TableCell>
                    <TableCell className={cn('text-left tabular-nums text-sm font-bold', isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      <Badge variant="secondary" className={cn('font-bold text-xs', isUp ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300')}>
                        {isUp ? '+' : ''}{chgPct.toFixed(2)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Top Movers Table ========== */
function TopMoversTable({
  title,
  stocks,
  type,
}: {
  title: string;
  stocks: MarketOverview['top_gainers'] | MarketOverview['top_losers'];
  type: 'gainers' | 'losers';
}) {
  const isGainer = type === 'gainers';
  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          {isGainer ? (
            <TrendingUp className="w-5 h-5 text-emerald-600" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-600" />
          )}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-semibold">#</TableHead>
                <TableHead className="text-xs font-semibold">السهم</TableHead>
                <TableHead className="text-xs font-semibold text-left">السعر</TableHead>
                <TableHead className="text-xs font-semibold text-left">التغيير</TableHead>
                <TableHead className="text-xs font-semibold text-left">الحجم</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stocks.slice(0, 5).map((stock, i) => {
                const price = Number(stock.current_price) || 0;
                const priceChg = Number(stock.price_change) || 0;
                const vol = Number(stock.volume) || 0;
                const prevPrice = price - priceChg;
                const chgPct = prevPrice > 0 ? ((priceChg / prevPrice) * 100) : 0;
                return (
                <TableRow key={stock.ticker}>
                  <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-semibold">{stock.name_ar}</p>
                      <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-left tabular-nums text-sm font-medium">
                    {price.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={cn('text-left tabular-nums text-sm font-bold', isGainer ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {priceChg !== 0 && (
                      <span className="inline-flex items-center gap-1">
                        {priceChg >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {Math.abs(priceChg).toFixed(2)} ({priceChg >= 0 ? '+' : ''}{chgPct.toFixed(2)}%)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-left tabular-nums text-xs text-muted-foreground">
                    {vol ? (vol >= 1000000 ? `${(vol / 1000000).toFixed(2)}M` : vol.toLocaleString()) : '—'}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Sector Performance ========== */
function SectorPerformance({ insights }: { insights: AiInsights }) {
  if (!insights.top_sectors || insights.top_sectors.length === 0) return null;

  const maxChange = Math.max(...insights.top_sectors.map((s) => Math.abs(s.avg_change_percent)), 1);

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" />
          أداء القطاعات
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {insights.top_sectors.map((sector) => {
            const isUp = sector.avg_change_percent >= 0;
            const barWidth = Math.max((Math.abs(sector.avg_change_percent) / maxChange) * 100, 2);
            return (
              <div key={sector.name} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate max-w-[60%]">{sector.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{sector.count} سهم</span>
                    <span className={cn('text-sm font-bold tabular-nums', isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {isUp ? '+' : ''}{(sector.avg_change_percent ?? 0).toFixed(2)}%
                    </span>
                  </div>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      isUp ? 'bg-emerald-500' : 'bg-red-500'
                    )}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Market Breadth ========== */
function MarketBreadth({
  gainers,
  losers,
  unchanged,
}: {
  gainers: number;
  losers: number;
  unchanged: number;
}) {
  const total = gainers + losers + unchanged || 1;
  const gainPct = ((gainers / total) * 100).toFixed(1);
  const losePct = ((losers / total) * 100).toFixed(1);
  const unchPct = ((unchanged / total) * 100).toFixed(1);
  const breadthRatio = losers > 0 ? (gainers / losers).toFixed(2) : '∞';

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <PieChart className="w-5 h-5 text-primary" />
          عرض السوق
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1 mb-4 h-6 rounded-lg overflow-hidden">
          <div
            className="bg-emerald-500 h-full flex items-center justify-center"
            style={{ width: `${gainPct}%` }}
          >
            {Number(gainPct) > 8 && <span className="text-[10px] text-white font-bold">{gainPct}%</span>}
          </div>
          <div
            className="bg-gray-400 dark:bg-gray-600 h-full flex items-center justify-center"
            style={{ width: `${unchPct}%` }}
          >
            {Number(unchPct) > 8 && <span className="text-[10px] text-white font-bold">{unchPct}%</span>}
          </div>
          <div
            className="bg-red-500 h-full flex items-center justify-center"
            style={{ width: `${losePct}%` }}
          >
            {Number(losePct) > 8 && <span className="text-[10px] text-white font-bold">{losePct}%</span>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
            <p className="text-xs text-muted-foreground">مرتفع</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{gainers}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-900/40">
            <p className="text-xs text-muted-foreground">بدون تغيير</p>
            <p className="text-lg font-bold text-gray-600 dark:text-gray-400">{unchanged}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/40">
            <p className="text-xs text-muted-foreground">منخفض</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{losers}</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
          <span className="text-sm font-medium">نسبة العرض</span>
          <span className={cn('text-lg font-bold', Number(breadthRatio) >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
            {breadthRatio} : 1
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Volume Analysis ========== */
function VolumeAnalysis({ overview }: { overview: MarketOverview }) {
  const activeStocks = overview.most_active || [];
  const totalVolume = activeStocks.reduce((sum, s) => sum + (s.volume || 0), 0);

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          تحليل التداول
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 p-3 rounded-lg border bg-muted/30">
          <p className="text-xs text-muted-foreground mb-1">إجمالي حجم التداول (الأسهم الأكثر نشاطاً)</p>
          <p className="text-xl font-bold tabular-nums">
            {totalVolume >= 1000000000
              ? `${(totalVolume / 1000000000).toFixed(2)} مليار`
              : totalVolume >= 1000000
                ? `${(totalVolume / 1000000).toFixed(2)} مليون`
                : totalVolume.toLocaleString()}
          </p>
        </div>

        <div className="space-y-2">
          {activeStocks.slice(0, 5).map((stock) => {
            const vol = stock.volume || 0;
            const volPct = totalVolume > 0 ? (vol / totalVolume) * 100 : 0;
            return (
              <div key={stock.ticker} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{stock.name_ar}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {vol >= 1000000 ? `${(vol / 1000000).toFixed(2)}M` : vol.toLocaleString()}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/70 transition-all duration-500"
                    style={{ width: `${Math.max(volPct, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Loading Skeleton ========== */
function ReportSkeleton() {
  return (
    <div className="space-y-6" dir="rtl">
      <div className="border-b-2 border-primary pb-4">
        <div className="flex items-center gap-3 mb-2">
          <Skeleton className="w-12 h-12 rounded-xl" />
          <div>
            <Skeleton className="h-6 w-36 mb-1" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

/* ========== Main Component ========== */
export function DailyMarketReport({ printMode = false }: DailyMarketReportProps) {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewData, insightsData] = await Promise.all([
        apiClient.getMarketOverview().catch(() => null),
        apiClient.getAiInsights().catch(() => null),
      ]);
      setOverview(overviewData);
      setInsights(insightsData);
    } catch {
      // keep loading false on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('daily-market-report-content');
      if (!element) {
        toast.error('لم يتم العثور على محتوى التقرير');
        return;
      }
      await exportToPdf(element, {
        filename: `daily_market_report_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <ReportSkeleton />;

  if (!overview) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <BarChart3 className="w-12 h-12 mb-3" />
        <p className="text-sm">لم يتم تحميل بيانات السوق</p>
      </div>
    );
  }

  const { summary, indices, top_gainers, top_losers } = overview;

  return (
    <div id="daily-market-report-content" className="space-y-6 print:space-y-4" dir="rtl">
      {/* Report Header */}
      <ReportHeader />

      {/* Legal Disclaimer */}
      <p className="text-[11px] text-muted-foreground/80 italic text-center mb-6 print:mb-4">
        ⚠️ المنصة لأغراض تعليمية وتحليلية فقط. المحتوى لا يُعد توصية استثمارية أو نصيحة مالية. جميع التحليلات مبينة على بيانات تاريخية وقد لا تعكس الأداء المستقبلي.
      </p>

      {/* Print button - hidden when printing */}
      {!printMode && (
        <div className="flex justify-start gap-2 print:hidden">
          <Button onClick={handleExportPDF} disabled={exporting} variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
          </Button>
          <ShareButton
            stockData={{
              ticker: 'EGX-MARKET',
              name: 'Daily Market Report',
              nameAr: `تقرير السوق اليومي - ${new Date().toLocaleDateString('ar-EG')}`,
              price: summary?.total_stocks || 0,
              change: overview?.indices?.[0]?.change_percent || 0,
              recommendation: insights?.market_sentiment === 'bullish' ? 'إيجابي' : insights?.market_sentiment === 'bearish' ? 'سلبي' : 'محايد',
              recommendationAr: insights?.market_sentiment === 'bullish' ? 'سوق إيجابي' : insights?.market_sentiment === 'bearish' ? 'سوق سلبي' : 'سوق محايد',
              confidence: insights?.market_score || 50,
              sector: `${summary?.gainers || 0} مرتفع | ${summary?.losers || 0} منخفض`,
            }}
          />
        </div>
      )}

      {/* Market Summary Stats */}
      <section aria-label="ملخص السوق">
        <h3 className="text-sm font-bold text-muted-foreground mb-3 flex items-center gap-2">
          <Minus className="w-4 h-4" />
          ملخص السوق
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="إجمالي الأسهم"
            value={summary.total_stocks}
            icon={BarChart3}
            color="text-primary"
            bg="bg-primary/10"
            subtext={`${summary.gainers + summary.losers + summary.unchanged} سهم متداول`}
          />
          <StatCard
            label="المرتفعة"
            value={summary.gainers}
            icon={TrendingUp}
            color="text-emerald-600 dark:text-emerald-400"
            bg="bg-emerald-50 dark:bg-emerald-950/40"
            subtext={`${((summary.gainers / (summary.total_stocks || 1)) * 100).toFixed(1)}% من السوق`}
          />
          <StatCard
            label="المنخفضة"
            value={summary.losers}
            icon={TrendingDown}
            color="text-red-600 dark:text-red-400"
            bg="bg-red-50 dark:bg-red-950/40"
            subtext={`${((summary.losers / (summary.total_stocks || 1)) * 100).toFixed(1)}% من السوق`}
          />
          <StatCard
            label="بدون تغيير"
            value={summary.unchanged}
            icon={Minus}
            color="text-amber-600 dark:text-amber-400"
            bg="bg-amber-50 dark:bg-amber-950/40"
            subtext={`${((summary.unchanged / (summary.total_stocks || 1)) * 100).toFixed(1)}% من السوق`}
          />
        </div>
      </section>

      {/* Index Performance */}
      <section aria-label="المؤشرات">
        <h3 className="text-sm font-bold text-muted-foreground mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          أداء المؤشرات الرئيسية
        </h3>
        <IndexTable indices={indices} />
      </section>

      {/* Top Gainers & Losers */}
      <section aria-label="الأكثر تحركاً" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopMoversTable title="أكثر الأسهم ارتفاعاً" stocks={top_gainers} type="gainers" />
        <TopMoversTable title="أكثر الأسهم انخفاضاً" stocks={top_losers} type="losers" />
      </section>

      {/* Sector Performance & Market Breadth */}
      <section aria-label="القطاعات والعرض" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {insights && <SectorPerformance insights={insights} />}
        <MarketBreadth
          gainers={summary.gainers}
          losers={summary.losers}
          unchanged={summary.unchanged}
        />
      </section>

      {/* Volume Analysis */}
      <section aria-label="التداول">
        <h3 className="text-sm font-bold text-muted-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          تحليل التداول
        </h3>
        <VolumeAnalysis overview={overview} />
      </section>

      {/* Market Sentiment Summary */}
      {insights && (
        <section aria-label="ملخص المشاعر">
          <Card className="overflow-hidden border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <PieChart className="w-5 h-5 text-primary" />
                ملخص المشاعر
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">مشاعر السوق</p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'font-bold text-sm',
                      insights.market_sentiment === 'bullish'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : insights.market_sentiment === 'bearish'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    )}
                  >
                    {insights.market_sentiment === 'bullish'
                      ? 'إيجابي'
                      : insights.market_sentiment === 'bearish'
                        ? 'سلبي'
                        : 'محايد'}
                  </Badge>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">درجة السوق</p>
                  <p className="text-xl font-bold tabular-nums">{insights.market_score}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">مؤشر التقلب</p>
                  <p className="text-xl font-bold tabular-nums">{insights.volatility_index}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">مستوى المخاطر</p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'font-bold text-sm',
                      insights.risk_assessment === 'low'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : insights.risk_assessment === 'medium'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    )}
                  >
                    {insights.risk_assessment === 'low'
                      ? 'منخفض'
                      : insights.risk_assessment === 'medium'
                        ? 'متوسط'
                        : 'مرتفع'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Footer */}
      <div className="text-center pt-4 border-t text-xs text-muted-foreground print:pt-2">
        <p>تم إنشاء هذا التقرير تلقائياً بواسطة منصة استثمار EGX</p>
        <p>البيانات لأغراض تعليمية ومعلوماتية فقط وليست نصيحة استثمارية</p>
      </div>
    </div>
  );
}
