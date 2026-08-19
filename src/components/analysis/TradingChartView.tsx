'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SingleStockAnalysisView } from './SingleStockAnalysisView';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LayoutGrid,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Columns,
  RefreshCw,
  X,
  Search,
  Send,
  Loader2,
  Check,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ExchangeSelector } from '@/components/layout/ExchangeSelector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';

interface TradingChartViewProps {
  initialTicker?: string;
}

export function TradingChartView({ initialTicker }: TradingChartViewProps) {
  const { stocks, loadStocks, storeLoading, marketOverview, currentMarket } = useAppStore();
  const isCrypto = currentMarket === 'CRYPTO';
  const defaultTicker = (initialTicker || (isCrypto ? 'BTC' : 'PHDC')).toUpperCase();
  const [columns, setColumns] = useState<1 | 2>(1);
  const [selectedStockToAdd, setSelectedStockToAdd] = useState('');
  const [publishingAll, setPublishingAll] = useState(false);

  // ─── قائمة الأسهم المعروضة في اللوحة (لكل سهم شاشته الشاملة بالكامل) ───
  const [selectedTickers, setSelectedTickers] = useState<string[]>(() => {
    return [defaultTicker];
  });

  useEffect(() => {
    loadStocks('');
  }, [loadStocks]);

  // ─── إضافة سهم جديد للوحة ───
  const handleAddStock = (tickerToAdd?: string) => {
    const targetTicker = (tickerToAdd || selectedStockToAdd).trim().toUpperCase();
    if (!targetTicker) {
      toast.info('اختر سهمًا أولاً لإضافته للتحليل');
      return;
    }

    if (selectedTickers.includes(targetTicker)) {
      toast.info(`السهم ${targetTicker} مضاف بالفعل في اللوحة`);
      return;
    }

    if (selectedTickers.length >= 6) {
      toast.warning('يمكنك إضافة حتى 6 أسهم كحد أقصى للوحة التحليل');
      return;
    }

    setSelectedTickers((prev) => [...prev, targetTicker]);
    setSelectedStockToAdd('');
    toast.success(`تمت إضافة الشارت والتحليل الشامل لـ ${targetTicker}`);
  };

  // ─── إزالة سهم من اللوحة ───
  const handleRemoveStock = (tickerToRemove: string) => {
    if (selectedTickers.length <= 1) {
      toast.info('يجب الإبقاء على سهم واحد على الأقل في اللوحة');
      return;
    }
    setSelectedTickers((prev) => prev.filter((t) => t !== tickerToRemove));
  };

  // ─── إعادة تعيين اللوحة ───
  const handleResetWorkspace = () => {
    setSelectedTickers([defaultTicker]);
    toast.success('تمت إعادة التعيين للسهم الرئيسي');
  };

  // ─── نشر جميع الشارتات على تيليجرام ───
  const handlePublishAll = useCallback(async () => {
    setPublishingAll(true);
    try {
      const cards = Array.from(document.querySelectorAll('[id^="chart-card-"]'));
      if (cards.length === 0) {
        toast.error('لا توجد شارتات للنشر');
        return;
      }

      let successCount = 0;
      for (const card of cards) {
        try {
          const dataUrl = await toPng(card as HTMLElement, {
            quality: 0.95,
            pixelRatio: 2,
            backgroundColor: '#ffffff',
            cacheBust: true,
            skipFonts: true,
            style: {
              transform: 'scale(1)',
              transformOrigin: 'top right',
            },
          });

          const ticker = (card as HTMLElement).id.replace('chart-card-', '');
          const res = await fetch('/api/market/publish-status-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: dataUrl,
              market: isCrypto ? 'CRYPTO' : 'EGX',
              caption: `📊 تحليل شامل لسهم ${ticker}\n${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })}`,
            }),
          });

          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success) {
            successCount++;
          }
        } catch (err) {
          console.error('Failed to publish chart:', err);
        }
      }

      if (successCount > 0) {
        toast.success(`تم نشر ${successCount} من ${cards.length} شارت بنجاح`);
      } else {
        toast.error('فشل في نشر الشارتات');
      }
    } finally {
      setPublishingAll(false);
    }
  }, []);

  return (
    <div
      dir="rtl"
      className="w-full min-h-screen overflow-y-auto bg-background text-foreground p-2 md:p-6 pb-28 space-y-6"
    >
      {/* ─── 1. Header Control Bar ─── */}
      <div className="flex flex-col gap-3 p-3 md:p-4 rounded-xl border border-border/80 bg-card shadow-sm">
        {/* Row 1: Title & Market Badges */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-2.5">
          <div>
            <h1 className="text-lg md:text-xl font-black text-foreground flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-emerald-500" />
              الشارت التفاعلي والتحليل المتقدم للأسهم
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              يمكنك إضافة أي عدد من الأسهم لمقارنة الشارت التفاعلي والتحليلات الشاملة (Score Card, Trade Plan, SMC) لكل سهم بشكل مستقل.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <ExchangeSelector compact className="h-7 text-xs" />
            {marketOverview && (
              <div className="hidden lg:flex items-center gap-1.5 text-[10px]">
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                  <TrendingUp className="w-3 h-3 ml-0.5" />
                  ارتفاعات: {marketOverview.summary.gainers}
                </Badge>
                <Badge variant="outline" className="text-rose-500 border-rose-500/30">
                  <TrendingDown className="w-3 h-3 ml-0.5" />
                  خسائر: {marketOverview.summary.losers}
                </Badge>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Add Stock Dropdown + Layout Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Add Stock Selector */}
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-lg">
            <StockSearchSelector
              mode="add"
              placeholder="+ إدراج سهم آخر للتحليل والبحث (جميع الأسهم)..."
              onSelectStock={(ticker) => handleAddStock(ticker)}
              buttonClassName="flex-1 border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            />

            {/* Presets */}
            <div className="hidden sm:flex items-center gap-1">
              {(isCrypto ? ['BTC', 'ETH', 'SOL', 'BNB'] : ['COMI', 'JUFO', 'SWDY', 'MFPC']).map((tk) => (
                <Button
                  key={tk}
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddStock(tk)}
                  className="h-8 px-2 text-[10px] font-mono font-bold"
                >
                  +{tk}
                </Button>
              ))}
            </div>
          </div>

          {/* Layout Columns Control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-bold hidden sm:inline">أعمدة العرض:</span>
            <div className="flex bg-muted/60 p-0.5 rounded-lg border border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setColumns(1)}
                className={cn(
                  'h-7 px-2.5 text-xs font-bold rounded-md transition-all',
                  columns === 1
                    ? 'bg-background text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title="عرض شاشة تحليل كاملة عريضة لكل سهم"
              >
                1 عمود (رأسي)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setColumns(2)}
                className={cn(
                  'h-7 px-2.5 text-xs font-bold rounded-md transition-all',
                  columns === 2
                    ? 'bg-background text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title="عرض شاشات التحليل مجاورة في شبكة"
              >
                2 عمود (شبكة)
              </Button>
            </div>

            <Badge variant="secondary" className="font-mono text-xs px-2 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              {selectedTickers.length} {selectedTickers.length === 1 ? 'سهم' : 'أسهم'}
            </Badge>

            {/* P16-DELAY-COMPENSATION: بادج معلوماتية عن سياسة تعويض تأخير البيانات */}
            <Badge
              className="text-[10px] font-semibold cursor-help bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/40 dark:border-amber-800/40 hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
              title="بسبب تأخر بيانات السوق 5 دقائق، بتطبّق المنصة تعويض تلقائي على توصيات الشراء أثناء جلسة EGX: توسيع الهدف +5% وتضييق وقف الخسارة -15%."
              onClick={() => toast.info('⚠️ سياسة تعويض تأخير البيانات (5 دقايق)', {
                description: 'أثناء جلسة تداول EGX (10:00-14:30)، بتطبّق المنصة تعويض تلقائي على توصيات الشراء:\n\n• توسيع الهدف +5% (نعوّض الـ slippage)\n• تضييق وقف الخسارة -15% (نحميك لو السهم رجع)\n\nينصح بالتنفيذ عند ارتداد السعر للدعم وليس عند صعوده السريع. هتلاقي بادج "⚠️ تعويض تأخير" على كل توصية متأثرة.',
                duration: 8000,
              })}
            >
              ⚠️ تعويض تأخير 5 دقايق
            </Badge>

            {selectedTickers.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetWorkspace}
                className="h-8 px-2 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 gap-1"
                title="إعادة التعيين لسهم واحد"
              >
                <RefreshCw className="w-3 h-3" />
                إعادة تعيين
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={handlePublishAll}
              disabled={publishingAll || selectedTickers.length === 0}
              className="h-8 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 gap-1"
              title="نشر جميع الشارتات على تيليجرام"
            >
              {publishingAll ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              نشر الكل
            </Button>
          </div>
        </div>

        {/* Selected Stock Badges Bar */}
        {selectedTickers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-border/40">
            <span className="text-[10px] md:text-xs font-bold text-muted-foreground">
              الأسهم المعروضة للتحليل ({selectedTickers.length}):
            </span>
            {selectedTickers.map((tk, idx) => {
              const st = stocks.find((s) => s.ticker === tk);
              const isPrimary = idx === 0;
              return (
                <Badge
                  key={tk}
                  variant={isPrimary ? 'secondary' : 'outline'}
                  className={cn(
                    'text-xs font-mono py-0.5 px-2 flex items-center gap-1.5',
                    isPrimary
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-400 font-bold'
                      : 'bg-background border-border'
                  )}
                >
                  <span>{st?.name_ar || tk}</span>
                  <span className="text-[10px] text-muted-foreground font-bold">({tk})</span>
                  {!isPrimary && (
                    <button
                      type="button"
                      onClick={() => handleRemoveStock(tk)}
                      className="hover:text-rose-500 transition-colors ml-0.5 p-0.5"
                      title={`إزالة ${tk}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── 2. Multi-Stock Full Analysis Cards (Native Smooth Scrolling) ─── */}
      <div
        className={cn(
          'grid gap-8 w-full transition-all duration-300',
          columns === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
        )}
      >
        {selectedTickers.map((tk) => (
          <SingleStockAnalysisView
            key={tk}
            initialTicker={tk}
            canRemove={selectedTickers.length > 1}
            onRemove={() => handleRemoveStock(tk)}
            onTickerChange={(newTk) => {
              setSelectedTickers((prev) =>
                prev.map((t) => (t === tk ? newTk : t))
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}
