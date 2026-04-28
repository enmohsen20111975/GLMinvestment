'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Download,
  FileBarChart,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Layers,
  Activity,
  Shield,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  ThumbsUp,
  ThumbsDown,
  Minus,
  CircleDot,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShareButton } from '@/components/share/ShareButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import type { AiInsights } from '@/types';
import { toast } from 'sonner';
import { DailyMarketReport } from './DailyMarketReport';
import { StockAnalysisReport } from './StockAnalysisReport';

/* ============================
   Sector Report Component
   ============================ */
function SectorReport() {
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.getAiInsights().catch(() => null);
      setInsights(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-4" dir="rtl">
        <div className="border-b-2 border-primary pb-4">
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Layers className="w-12 h-12 mb-3" />
        <p className="text-sm">لم يتم تحميل بيانات القطاعات</p>
      </div>
    );
  }

  const sectors = insights.top_sectors || [];
  const sortedSectors = [...sectors].sort((a, b) => b.avg_change_percent - a.avg_change_percent);
  const bestSector = sortedSectors[0];
  const worstSector = sortedSectors[sortedSectors.length - 1];
  const totalStocks = sectors.reduce((sum, s) => sum + s.count, 0);
  const avgChange = sectors.length > 0
    ? sectors.reduce((sum, s) => sum + s.avg_change_percent, 0) / sectors.length
    : 0;

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('sector-report-content');
      if (!element) {
        toast.error('لم يتم العثور على محتوى التقرير');
        return;
      }
      await exportToPdf(element, {
        filename: `sector_report_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="sector-report-content" className="space-y-6 print:space-y-4" dir="rtl">
      {/* Report Header */}
      <div className="border-b-2 border-primary pb-4 mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">منصة استثمار EGX</h1>
              <p className="text-xs text-muted-foreground">Egyptian Investment Platform</p>
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-lg font-bold">تقرير القطاعات</h2>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* PDF Export Button */}
      <div className="flex justify-start print:hidden">
        <Button onClick={handleExportPDF} disabled={exporting} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">عدد القطاعات</p>
            <p className="text-2xl font-bold text-primary">{sectors.length}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">إجمالي الأسهم</p>
            <p className="text-2xl font-bold">{totalStocks}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">متوسط التغير</p>
            <p className={cn('text-2xl font-bold', avgChange >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">درجة السوق</p>
            <p className="text-2xl font-bold">{insights.market_score}</p>
          </CardContent>
        </Card>
      </div>

      {/* Best & Worst Sectors */}
      {bestSector && worstSector && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border shadow-sm border-emerald-200 dark:border-emerald-900/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                أفضل قطاع
              </p>
              <p className="text-lg font-bold">{bestSector.name}</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">+{(bestSector.avg_change_percent ?? 0).toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-1">{bestSector.count} سهم</p>
            </CardContent>
          </Card>
          <Card className="border shadow-sm border-red-200 dark:border-red-900/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5 text-red-600" />
                أسوأ قطاع
              </p>
              <p className="text-lg font-bold">{worstSector.name}</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{(worstSector.avg_change_percent ?? 0).toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-1">{worstSector.count} سهم</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sector Comparison Table */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            مقارنة القطاعات
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-semibold">#</TableHead>
                  <TableHead className="text-xs font-semibold">القطاع</TableHead>
                  <TableHead className="text-xs font-semibold text-left">عدد الأسهم</TableHead>
                  <TableHead className="text-xs font-semibold text-left">متوسط التغير %</TableHead>
                  <TableHead className="text-xs font-semibold text-left">الأداء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSectors.map((sector, i) => {
                  const isUp = sector.avg_change_percent >= 0;
                  return (
                    <TableRow key={sector.name}>
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{sector.name}</TableCell>
                      <TableCell className="text-left tabular-nums text-sm">{sector.count}</TableCell>
                      <TableCell className={cn('text-left tabular-nums text-sm font-bold', isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {isUp ? '+' : ''}{(sector.avg_change_percent ?? 0).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', isUp ? 'bg-emerald-500' : 'bg-red-500')}
                            style={{ width: `${Math.min(Math.abs(sector.avg_change_percent) * 10, 100)}%` }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Sector Performance Bars */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            رسم بياني للأداء
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            {sortedSectors.map((sector) => {
              const isUp = sector.avg_change_percent >= 0;
              const barWidth = Math.min(Math.abs(sector.avg_change_percent) * 10, 100);
              return (
                <div key={sector.name} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate max-w-[55%]">{sector.name}</span>
                    <span className={cn('text-sm font-bold tabular-nums', isUp ? 'text-emerald-600' : 'text-red-600')}>
                      {isUp ? '+' : ''}{(sector.avg_change_percent ?? 0).toFixed(2)}%
                    </span>
                  </div>
                  <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', isUp ? 'bg-emerald-500' : 'bg-red-500')}
                      style={{ width: `${Math.max(barWidth, 3)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center pt-4 border-t text-xs text-muted-foreground">
        <p>تم إنشاء هذا التقرير تلقائياً بواسطة منصة استثمار EGX</p>
      </div>
    </div>
  );
}

/* ============================
   Recommendations Report
   ============================ */
function RecommendationsReport() {
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.getAiInsights().catch(() => null);
      setInsights(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-4" dir="rtl">
        <div className="border-b-2 border-primary pb-4">
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Shield className="w-12 h-12 mb-3" />
        <p className="text-sm">لم يتم تحميل بيانات التحليلات</p>
      </div>
    );
  }

  const stocks = insights.stock_statuses || [];

  // Categorize stocks by score
  const strongBuy = stocks.filter((s) => s.score >= 75);
  const buy = stocks.filter((s) => s.score >= 60 && s.score < 75);
  const accumulate = stocks.filter((s) => s.score >= 50 && s.score < 60);
  const hold = stocks.filter((s) => s.score >= 40 && s.score < 50);
  const sell = stocks.filter((s) => s.score >= 25 && s.score < 40);
  const strongSell = stocks.filter((s) => s.score < 25);

  // Score distribution for visualization
  const scoreBuckets = [
    { label: 'شراء قوي (≥75)', count: strongBuy.length, color: 'bg-emerald-600' },
    { label: 'شراء (60-74)', count: buy.length, color: 'bg-emerald-500' },
    { label: 'تجميع (50-59)', count: accumulate.length, color: 'bg-teal-500' },
    { label: 'احتفاظ (40-49)', count: hold.length, color: 'bg-amber-500' },
    { label: 'بيع (25-39)', count: sell.length, color: 'bg-red-500' },
    { label: 'بيع قوي (<25)', count: strongSell.length, color: 'bg-red-600' },
  ];

  const maxBucket = Math.max(...scoreBuckets.map((b) => b.count), 1);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('recommendations-report-content');
      if (!element) {
        toast.error('لم يتم العثور على محتوى التقرير');
        return;
      }
      await exportToPdf(element, {
        filename: `recommendations_report_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="recommendations-report-content" className="space-y-6 print:space-y-4" dir="rtl">
      {/* Report Header */}
      <div className="border-b-2 border-primary pb-4 mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">منصة استثمار EGX</h1>
              <p className="text-xs text-muted-foreground">Egyptian Investment Platform</p>
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-lg font-bold">تقرير التحليلات</h2>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* PDF Export Button */}
      <div className="flex justify-start print:hidden">
        <Button onClick={handleExportPDF} disabled={exporting} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
        </Button>
      </div>

      {/* Market Summary */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <PieChart className="w-5 h-5 text-primary" />
            ملخص السوق والتحليل
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="text-center p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">درجة السوق</p>
              <p className="text-2xl font-bold">{insights.market_score}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">المشاعر</p>
              <Badge variant="secondary" className={cn('font-bold', insights.market_sentiment === 'bullish' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : insights.market_sentiment === 'bearish' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300')}>
                {insights.market_sentiment === 'bullish' ? 'إيجابي' : insights.market_sentiment === 'bearish' ? 'سلبي' : 'محايد'}
              </Badge>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">إجمالي الأسهم المحللة</p>
              <p className="text-2xl font-bold">{stocks.length}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">مستوى المخاطر</p>
              <Badge variant="secondary" className={cn('font-bold', insights.risk_assessment === 'low' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : insights.risk_assessment === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300')}>
                {insights.risk_assessment === 'low' ? 'منخفض' : insights.risk_assessment === 'medium' ? 'متوسط' : 'مرتفع'}
              </Badge>
            </div>
          </div>

          {/* Market Sentiment Bar */}
          <div className="flex items-center gap-1 mb-3 h-6 rounded-lg overflow-hidden">
            <div
              className="bg-emerald-500 h-full flex items-center justify-center transition-all"
              style={{ width: `${((strongBuy.length + buy.length + accumulate.length) / Math.max(stocks.length, 1)) * 100}%` }}
            >
              <span className="text-[10px] text-white font-bold">
                {strongBuy.length + buy.length + accumulate.length}
              </span>
            </div>
            <div
              className="bg-amber-500 h-full flex items-center justify-center transition-all"
              style={{ width: `${(hold.length / Math.max(stocks.length, 1)) * 100}%` }}
            >
              <span className="text-[10px] text-white font-bold">{hold.length}</span>
            </div>
            <div
              className="bg-red-500 h-full flex items-center justify-center transition-all"
              style={{ width: `${((sell.length + strongSell.length) / Math.max(stocks.length, 1)) * 100}%` }}
            >
              <span className="text-[10px] text-white font-bold">
                {sell.length + strongSell.length}
              </span>
            </div>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>إيجابي / تجميع</span>
            <span>احتفاظ</span>
            <span>بيع</span>
          </div>
        </CardContent>
      </Card>

      {/* Score Distribution */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            توزيع الدرجات
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {scoreBuckets.map((bucket) => (
              <div key={bucket.label} className="flex items-center gap-3">
                <span className="text-xs font-medium w-28 truncate">{bucket.label}</span>
                <div className="flex-1 h-5 bg-muted rounded-md overflow-hidden">
                  <div
                    className={cn('h-full rounded-md flex items-center justify-end px-2 transition-all', bucket.color)}
                    style={{ width: `${Math.max((bucket.count / maxBucket) * 100, bucket.count > 0 ? 8 : 0)}%` }}
                  >
                    {bucket.count > 0 && <span className="text-[10px] text-white font-bold">{bucket.count}</span>}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground w-10 text-left tabular-nums">
                  {stocks.length > 0 ? ((bucket.count / stocks.length) * 100).toFixed(0) : 0}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Buy / Strong Buy */}
      <Card className="overflow-hidden border shadow-sm border-emerald-200 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <ThumbsUp className="w-5 h-5" />
            أسهم شراء وشراء قوي ({strongBuy.length + buy.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent sticky top-0 bg-background">
                  <TableHead className="text-xs font-semibold">#</TableHead>
                  <TableHead className="text-xs font-semibold">السهم</TableHead>
                  <TableHead className="text-xs font-semibold">القطاع</TableHead>
                  <TableHead className="text-xs font-semibold text-left">السعر</TableHead>
                  <TableHead className="text-xs font-semibold text-left">التغيير</TableHead>
                  <TableHead className="text-xs font-semibold text-left">الدرجة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...strongBuy, ...buy].map((stock, i) => {
                  const price = Number(stock.current_price) || 0;
                  const chg = Number(stock.price_change) || 0;
                  return (
                  <TableRow key={stock.ticker}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell>
                      <p className="text-sm font-semibold">{stock.name_ar}</p>
                      <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                    </TableCell>
                    <TableCell className="text-xs">{stock.sector}</TableCell>
                    <TableCell className="text-left tabular-nums text-sm">{(price || 0).toFixed(2)}</TableCell>
                    <TableCell className={cn('text-left tabular-nums text-sm', chg >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {chg >= 0 ? '+' : ''}{(chg || 0).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-left">
                      <Badge variant="secondary" className={cn('font-bold', (stock.score ?? 0) >= 75 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300')}>
                        {(stock.score ?? 0).toFixed(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {strongBuy.length + buy.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">
                      لا توجد تحليلات شراء حالياً
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Hold / Accumulate */}
      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <CircleDot className="w-5 h-5" />
            أسهم تجميع واحتفاظ ({accumulate.length + hold.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent sticky top-0 bg-background">
                  <TableHead className="text-xs font-semibold">#</TableHead>
                  <TableHead className="text-xs font-semibold">السهم</TableHead>
                  <TableHead className="text-xs font-semibold">القطاع</TableHead>
                  <TableHead className="text-xs font-semibold text-left">السعر</TableHead>
                  <TableHead className="text-xs font-semibold text-left">التغيير</TableHead>
                  <TableHead className="text-xs font-semibold text-left">الدرجة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...accumulate, ...hold].map((stock, i) => {
                  const price = Number(stock.current_price) || 0;
                  const chg = Number(stock.price_change) || 0;
                  return (
                  <TableRow key={stock.ticker}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell>
                      <p className="text-sm font-semibold">{stock.name_ar}</p>
                      <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                    </TableCell>
                    <TableCell className="text-xs">{stock.sector}</TableCell>
                    <TableCell className="text-left tabular-nums text-sm">{price.toFixed(2)}</TableCell>
                    <TableCell className={cn('text-left tabular-nums text-sm', chg >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-left">
                      <Badge variant="secondary" className={cn('font-bold', stock.score >= 50 ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300')}>
                        {(stock.score ?? 0).toFixed(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {accumulate.length + hold.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">
                      لا توجد تحليلات تجميع أو احتفاظ حالياً
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Sell / Strong Sell */}
      <Card className="overflow-hidden border shadow-sm border-red-200 dark:border-red-900/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-red-700 dark:text-red-400">
            <ThumbsDown className="w-5 h-5" />
            أسهم بيع وبيع قوي ({sell.length + strongSell.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent sticky top-0 bg-background">
                  <TableHead className="text-xs font-semibold">#</TableHead>
                  <TableHead className="text-xs font-semibold">السهم</TableHead>
                  <TableHead className="text-xs font-semibold">القطاع</TableHead>
                  <TableHead className="text-xs font-semibold text-left">السعر</TableHead>
                  <TableHead className="text-xs font-semibold text-left">التغيير</TableHead>
                  <TableHead className="text-xs font-semibold text-left">الدرجة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...sell, ...strongSell].map((stock, i) => {
                  const price = Number(stock.current_price) || 0;
                  const chg = Number(stock.price_change) || 0;
                  return (
                  <TableRow key={stock.ticker}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell>
                      <p className="text-sm font-semibold">{stock.name_ar}</p>
                      <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                    </TableCell>
                    <TableCell className="text-xs">{stock.sector}</TableCell>
                    <TableCell className="text-left tabular-nums text-sm">{price.toFixed(2)}</TableCell>
                    <TableCell className={cn('text-left tabular-nums text-sm', chg >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-left">
                      <Badge variant="secondary" className={cn('font-bold', stock.score >= 35 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-red-200 text-red-800 dark:bg-red-800/40 dark:text-red-200')}>
                        {(stock.score ?? 0).toFixed(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {sell.length + strongSell.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">
                      لا توجد تحليلات بيع حالياً
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center pt-4 border-t text-xs text-muted-foreground">
        <p>تم إنشاء هذا التقرير تلقائياً بواسطة منصة استثمار EGX</p>
        <p>البيانات لأغراض تعليمية ومعلوماتية فقط وليست نصيحة استثمارية</p>
      </div>
    </div>
  );
}

/* ============================
   Main ReportsView Component
   ============================ */
export function ReportsView() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 mr-auto">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <FileBarChart className="w-5 h-5 text-primary" />
              التقارير المهنية
            </h2>
            <p className="text-xs text-muted-foreground">تقارير شاملة لسوق الأوراق المالية المصرية</p>
            <p className="text-[10px] text-muted-foreground/70 italic mt-0.5">
              ⚠️ المحتوى لأغراض تعليمية وتحليلية فقط وليس توصية استثمارية
            </p>
          </div>
          <ShareButton
            iconOnly={false}
            variant="outline"
            size="sm"
            stockData={{
              ticker: 'EGX-REPORT',
              name: 'EGX Market Reports',
              nameAr: 'تقارير سوق الأوراق المالية المصرية',
              price: 0,
              recommendation: 'تقارير مهنية',
              recommendationAr: 'تقارير مهنية',
              sector: 'التقارير',
            }}
          />
        </div>
      </header>

      <main className="flex-1 print:p-0">
        <div className="p-4 md:p-6">
          <Tabs defaultValue="daily" dir="rtl" className="w-full">
            <TabsList className="mb-6 w-full flex h-auto flex-wrap gap-1 bg-muted/50 p-1 rounded-xl print:hidden">
              <TabsTrigger
                value="daily"
                className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg py-2"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                تقرير السوق اليومي
              </TabsTrigger>
              <TabsTrigger
                value="stock"
                className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg py-2"
              >
                <Activity className="w-3.5 h-3.5" />
                تحليل الأسهم
              </TabsTrigger>
              <TabsTrigger
                value="sector"
                className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg py-2"
              >
                <Layers className="w-3.5 h-3.5" />
                تقرير القطاعات
              </TabsTrigger>
              <TabsTrigger
                value="recommendations"
                className="flex items-center gap-1.5 text-xs sm:text-sm flex-1 min-w-[100px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg py-2"
              >
                <Shield className="w-3.5 h-3.5" />
                تقرير التحليلات
              </TabsTrigger>
            </TabsList>

            <TabsContent value="daily">
              <DailyMarketReport />
            </TabsContent>

            <TabsContent value="stock">
              <StockAnalysisReport />
            </TabsContent>

            <TabsContent value="sector">
              <SectorReport />
            </TabsContent>

            <TabsContent value="recommendations">
              <RecommendationsReport />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
