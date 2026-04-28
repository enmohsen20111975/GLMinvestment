'use client';

import React, { Component, useState, useRef, useCallback, type ReactNode } from 'react';
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  BarChart3,
  DollarSign,
  Activity,
  Shield,
  Zap,
  BookmarkPlus,
  AlertTriangle,
  RefreshCw,
  Clock,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { cn, safeToFixed } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { SimpleStockChart } from './SimpleStockChart';
import { DeepAnalysis } from './DeepAnalysis';
import { StockNews } from './StockNews';
import { CalculationBreakdown } from './CalculationBreakdown';
import { ShareButton } from '@/components/share/ShareButton';
import { SmartTip } from '@/components/smart-tips/SmartTip';

// Simple error boundary to prevent child component crashes from breaking the whole page
class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-red-200 dark:border-red-900/50">
          <CardContent className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <p className="text-sm font-bold text-foreground mb-1">
              حدث خطأ في عرض البيانات
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {this.props.title || 'المحتوى'} غير متاح حالياً
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => this.setState({ hasError: false })}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return safeToFixed(num / 1_000_000_000, 1) + 'B';
  if (num >= 1_000_000) return safeToFixed(num / 1_000_000, 1) + 'M';
  if (num >= 1_000) return safeToFixed(num / 1_000, 1) + 'K';
  return safeToFixed(num);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return safeToFixed(vol / 1_000_000) + 'M';
  if (vol >= 1_000) return safeToFixed(vol / 1_000, 1) + 'K';
  return vol.toLocaleString();
}

interface PriceInfoCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  className?: string;
}

function PriceInfoCard({ label, value, icon, className }: PriceInfoCardProps) {
  return (
    <Card className={cn('py-3 px-4 gap-2', className)}>
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground">{icon}</div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-sm font-bold tabular-nums" dir="ltr">{value}</p>
    </Card>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          highlight && 'text-emerald-600 dark:text-emerald-400'
        )}
        dir="ltr"
      >
        {value}
      </span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" dir="rtl">
      {/* Header Skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
      {/* Price Info Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      {/* Chart Skeleton */}
      <Skeleton className="h-72 w-full rounded-xl" />
      {/* Metrics Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function StockDetail() {
  const {
    selectedStock,
    isLoading,
    setSelectedTicker,
    setCurrentView,
    watchlist,
    addToWatchlist,
  } = useAppStore();
  const [exporting, setExporting] = useState(false);
  const [addingToWatchlist, setAddingToWatchlist] = useState(false);
  const watchlistCooldown = useRef(false);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const element = document.getElementById('stock-detail-export');
      if (!element) {
        toast.error('لم يتم العثور على محتوى السهم');
        return;
      }
      await exportToPdf(element, {
        filename: `stock_analysis_${new Date().toISOString().split('T')[0]}.pdf`,
      });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء تصدير PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleBack = () => {
    setSelectedTicker(null);
    setCurrentView('stocks');
  };

  const handleAddToWatchlist = useCallback(async () => {
    if (!selectedStock || watchlistCooldown.current || addingToWatchlist) return;

    // Check if stock already exists in watchlist
    const alreadyExists = watchlist.some(
      (item) =>
        item.stock_id === selectedStock.id ||
        (selectedStock.ticker && item.stock?.ticker === selectedStock.ticker)
    );

    if (alreadyExists) {
      toast.error(`${selectedStock.ticker} موجود بالفعل في قائمة المراقبة`, {
        description: selectedStock.name_ar,
        duration: 3000,
      });
      return;
    }

    // Prevent double-clicks
    watchlistCooldown.current = true;
    setAddingToWatchlist(true);
    setTimeout(() => {
      watchlistCooldown.current = false;
    }, 2000);

    const success = await addToWatchlist(selectedStock.ticker);
    setAddingToWatchlist(false);

    if (success) {
      toast.success(`تمت إضافة ${selectedStock.ticker} إلى قائمة المراقبة`, {
        description: `${selectedStock.name_ar} - ${safeToFixed(selectedStock.current_price)} ج.م`,
        duration: 3000,
      });
    } else {
      toast.error('حدث خطأ أثناء الإضافة', {
        description: 'يرجى المحاولة مرة أخرى لاحقاً',
        duration: 3000,
      });
    }
  }, [selectedStock, watchlist, addToWatchlist, addingToWatchlist]);

  if (isLoading && !selectedStock) {
    return <DetailSkeleton />;
  }

  if (!selectedStock) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" dir="rtl">
        <BarChart3 className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm font-medium mb-1">لم يتم اختيار سهم</p>
        <p className="text-xs">اختر سهماً من قائمة الأسهم لعرض التفاصيل</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={() => setCurrentView('stocks')}
        >
          <ArrowRight className="w-3.5 h-3.5" />
          تصفح الأسهم
        </Button>
      </div>
    );
  }

  const stock = selectedStock;
  const change = stock.price_change || 0;
  const isPositive = change >= 0;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Back Button */}
      <Button
        variant="ghost"
        onClick={handleBack}
        className="text-muted-foreground hover:text-foreground gap-2 px-0"
      >
        <ArrowRight className="w-4 h-4" />
        <span className="text-sm">العودة لقائمة الأسهم</span>
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {stock.ticker}
            </h1>
            {/* Index Membership Badges */}
            <div className="flex gap-1.5">
              {stock.egx30_member && (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 border-0 text-[11px] px-2">
                  EGX 30
                </Badge>
              )}
              {stock.egx70_member && (
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/60 border-0 text-[11px] px-2">
                  EGX 70
                </Badge>
              )}
              {stock.egx100_member && (
                <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border-0 text-[11px] px-2">
                  EGX 100
                </Badge>
              )}
            </div>
          </div>
          <h2 className="text-lg font-semibold">{stock.name_ar}</h2>
          <p className="text-sm text-muted-foreground">{stock.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">
              {stock.sector}
            </Badge>
            {stock.compliance_status === 'halal' && (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 text-[11px] gap-1">
                <Shield className="w-3 h-3" />
                متوافق شرعاً
              </Badge>
            )}
            {stock.compliance_status === 'doubtful' && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0 text-[11px] gap-1">
                <Shield className="w-3 h-3" />
                غير مؤكد
              </Badge>
            )}
          </div>
        </div>

        {/* Price & Change */}
        <div className="text-left flex-shrink-0">
          <p className="text-3xl font-bold tabular-nums" dir="ltr">
            {safeToFixed(stock.current_price)}
          </p>
          <div className="flex items-center gap-1.5 justify-end">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
            )}
            <span
              className={cn(
                'text-sm font-bold tabular-nums',
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              )}
              dir="ltr"
            >
              {change >= 0 ? '+' : ''}
              {safeToFixed(change)}%
            </span>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              dir="ltr"
            >
              ({stock.current_price - stock.previous_close > 0 ? '+' : ''}
              {safeToFixed(stock.current_price - stock.previous_close)})
            </span>
          </div>
        </div>
      </div>

      {/* Add to Watchlist + Export Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleAddToWatchlist}
          disabled={addingToWatchlist}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 disabled:opacity-60"
        >
          <BookmarkPlus className={cn('w-4 h-4', addingToWatchlist && 'animate-pulse')} />
          {addingToWatchlist ? 'جارٍ الإضافة...' : 'إضافة للقائمة المراقبة'}
        </Button>
        <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2 print:hidden">
          <Download className="w-4 h-4" />
          {exporting ? 'جارٍ التصدير...' : 'تصدير PDF'}
        </Button>
        <ShareButton
          stockData={{
            ticker: stock.ticker,
            name: stock.name,
            nameAr: stock.name_ar,
            price: stock.current_price,
            change: stock.price_change,
            recommendation: undefined,
            metrics: {
              pe: stock.pe_ratio,
              roe: stock.roe,
              pb: stock.pb_ratio,
              dividendYield: stock.dividend_yield,
              eps: stock.eps,
              debtToEquity: stock.debt_to_equity,
            },
            sector: stock.sector,
          }}
        />
      </div>

      {/* Price Info Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <PriceInfoCard
          label="الافتتاح"
          value={safeToFixed(stock.open_price)}
          icon={<Activity className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الأعلى"
          value={safeToFixed(stock.high_price)}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الأدنى"
          value={safeToFixed(stock.low_price)}
          icon={<TrendingDown className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الإغلاق"
          value={safeToFixed(stock.previous_close)}
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="الحجم"
          value={formatVolume(stock.volume)}
          icon={<Zap className="w-4 h-4" />}
        />
        <PriceInfoCard
          label="القيمة السوقية"
          value={formatNumber(stock.market_cap) + ' EGP'}
          icon={<DollarSign className="w-4 h-4" />}
        />
      </div>

      {/* Stock Chart */}
      <ErrorBoundary title="الرسم البياني">
        <SimpleStockChart ticker={stock.ticker} stockName={stock.name_ar} />
      </ErrorBoundary>

      {/* Smart Investment Tip */}
      <SmartTip trigger="stock_detail" category={change < -3 ? 'psychology' : undefined} />

      {/* Financial & Technical Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Financial Metrics */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              المؤشرات المالية
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <MetricRow label="مضاعف الربحية (P/E)" value={safeToFixed(stock.pe_ratio, 1)} />
            <Separator />
            <MetricRow label="مضاعف القيمة الدفترية (P/B)" value={safeToFixed(stock.pb_ratio, 1)} />
            <Separator />
            <MetricRow
              label="عائد التوزيعات"
              value={safeToFixed(stock.dividend_yield, 1) + '%'}
              highlight={stock.dividend_yield > 3}
            />
            <Separator />
            <MetricRow label="ربحية السهم (EPS)" value={safeToFixed(stock.eps) + ' EGP'} />
            <Separator />
            <MetricRow
              label="العائد على حقوق الملكية (ROE)"
              value={safeToFixed(stock.roe, 1) + '%'}
              highlight={stock.roe > 15}
            />
            <Separator />
            <MetricRow
              label="الدين/حقوق الملكية"
              value={safeToFixed(stock.debt_to_equity)}
            />
          </CardContent>
        </Card>

        {/* Technical Indicators */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              المؤشرات الفنية
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <MetricRow
              label="RSI"
              value={safeToFixed(stock.rsi, 1)}
              highlight={stock.rsi < 35 || stock.rsi > 65}
            />
            <Separator />
            <MetricRow label="المتوسط المتحرك (50)" value={safeToFixed(stock.ma_50)} />
            <Separator />
            <MetricRow label="المتوسط المتحرك (200)" value={safeToFixed(stock.ma_200)} />
            <Separator />
            <MetricRow
              label="مستوى الدعم"
              value={safeToFixed(stock.support_level)}
              highlight
            />
            <Separator />
            <MetricRow
              label="مستوى المقاومة"
              value={safeToFixed(stock.resistance_level)}
            />
            <Separator />
            <MetricRow
              label="القيمة المتداولة"
              value={formatNumber(stock.value_traded || 0) + ' EGP'}
            />
          </CardContent>
        </Card>
      </div>

      {/* Last Updated Indicator */}
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground" dir="rtl">
        <Clock className="w-3 h-3" />
        <span>آخر تحديث: {stock.last_update ? new Date(stock.last_update).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'غير محدد'}</span>
      </div>

      {/* Calculation Breakdown */}
      <ErrorBoundary title="تفاصيل الحساب"><CalculationBreakdown /></ErrorBoundary>

      {/* Deep Analysis */}
      <ErrorBoundary title="التحليل العميق"><DeepAnalysis /></ErrorBoundary>

      {/* Stock News */}
      <ErrorBoundary title="أخبار السهم"><StockNews /></ErrorBoundary>
    </div>
  );
}
