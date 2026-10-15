'use client';

import React, { useState, useEffect, useCallback } from 'react';
// P0-REDESIGN: استبدلنا SingleStockAnalysisView بـ ProfessionalTradingChart
// (تقرير مالي احترافي وفق مواصفات المالك الصارمة — 8 أقسام منظمة)
import { ProfessionalTradingChart } from './ProfessionalTradingChart';
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
      className="w-full min-h-screen overflow-y-auto stitch-canvas text-stitch-on-surface p-2 md:p-5 pb-28 space-y-5 dark:bg-surface-container-lowest dark:text-on-surface"
    >
      {/* ── SCR-004: Institutional Glass Panel (Bloomberg terminal feel) ── */}
      <div className="rounded-2xl border border-emerald-500/30/20 stitch-glass/80 backdrop-blur-sm shadow-lg overflow-hidden dark:bg-surface-container-low/80 dark:border dark:border-outline-variant/30">
        <div className="border-b border-emerald-500/30/10 bg-gradient-to-r from-emerald-500/5 via-transparent to-teal-500/5 px-4 py-4 md:px-5 md:py-5 dark:bg-surface-container dark:border-outline-variant/30 dark:bg-none">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-stitch-primary dark:text-primary">
                <LayoutGrid className="w-5 h-5" />
                <span className="text-xs font-bold tracking-[0.22em] uppercase dark:font-financial">غرفة التداول</span>
              </div>
              <h1 className="text-xl md:text-2xl font-black text-stitch-on-surface dark:text-on-surface dark:font-outfit">
                الشارت التفاعلي والتحليل المتقدم
              </h1>
              <p className="text-xs text-stitch-muted max-w-2xl dark:text-on-surface-variant">
                مقارنة فورية للأسهم مع تحليل السعر، مستويات الدعم والمقاومة، المخاطرة، ومؤشرات التوافق الفني.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ExchangeSelector compact className="h-9 text-xs rounded-xl border-border/60 stitch-glass dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface" />
              {marketOverview && (
                <div className="hidden lg:flex items-center gap-2 text-[10px]">
                  <Badge variant="outline" className="text-stitch-primary border-emerald-500/30 bg-emerald-50 px-2.5 py-1 stitch-num tabular-nums dark:text-primary dark:border-primary-container/40 dark:bg-primary-container/20 dark:font-financial">
                    <TrendingUp className="w-3 h-3 ml-0.5" />
                    ارتفاعات: {marketOverview.summary.gainers}
                  </Badge>
                  <Badge variant="outline" className="text-rose-600 border-rose-200 bg-rose-50 px-2.5 py-1 stitch-num tabular-nums dark:text-error dark:border-error-container/40 dark:bg-error-container/20 dark:font-financial">
                    <TrendingDown className="w-3 h-3 ml-0.5" />
                    خسائر: {marketOverview.summary.losers}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-4 md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex-1 min-w-0">
              <StockSearchSelector
                mode="add"
                placeholder="إدراج سهم آخر للتحليل..."
                onSelectStock={(ticker) => handleAddStock(ticker)}
                buttonClassName="w-full border-border/60 bg-secondary hover:stitch-glass text-stitch-on-surface rounded-xl shadow-sm dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-secondary p-1 rounded-xl border border-border/60 dark:bg-surface-container dark:border-outline-variant/30">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setColumns(1)}
                  className={cn(
                    'h-8 px-2.5 text-[11px] font-bold rounded-lg transition-all',
                    columns === 1 ? 'stitch-glass text-stitch-primary dark:text-stitch-primary dark:bg-primary-container dark:text-on-primary-container shadow-sm' : 'text-stitch-muted dark:text-on-surface-variant'
                  )}
                >
                  1 عمود
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setColumns(2)}
                  className={cn(
                    'h-8 px-2.5 text-[11px] font-bold rounded-lg transition-all',
                    columns === 2 ? 'stitch-glass text-stitch-primary dark:text-stitch-primary dark:bg-primary-container dark:text-on-primary-container shadow-sm' : 'text-stitch-muted dark:text-on-surface-variant'
                  )}
                >
                  2 عمود
                </Button>
              </div>

              <Badge className="stitch-num text-[11px] px-2.5 py-1 bg-emerald-50 text-stitch-primary border border-emerald-500/30 dark:bg-primary-container/20 dark:text-primary dark:border-primary-container/40 dark:font-financial">
                {selectedTickers.length} سهم
              </Badge>

              {selectedTickers.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetWorkspace}
                  className="h-8 px-2.5 text-[11px] text-rose-600 hover:bg-rose-50 gap-1.5 dark:text-error dark:hover:bg-error-container/20"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  إعادة تعيين
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={handlePublishAll}
                disabled={publishingAll || selectedTickers.length === 0}
                className="h-8 px-2.5 text-[11px] text-stitch-primary hover:bg-emerald-50 gap-1.5 dark:text-primary dark:hover:bg-primary-container/20"
              >
                {publishingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                نشر الكل
              </Button>
            </div>
          </div>

          {selectedTickers.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-border/60 dark:border-outline-variant/30">
              <span className="text-[10px] md:text-xs font-bold text-stitch-muted dark:text-on-surface-variant">الأوراق المعروضة:</span>
              {selectedTickers.map((tk, idx) => {
                const st = stocks.find((s) => s.ticker === tk);
                const isPrimary = idx === 0;
                return (
                  <Badge
                    key={tk}
                    variant={isPrimary ? 'secondary' : 'outline'}
                    className={cn(
                      'text-[11px] stitch-num py-1 px-2.5 flex items-center gap-1.5 rounded-full dark:font-financial',
                      isPrimary
                        ? 'bg-emerald-500/10 text-stitch-primary border border-emerald-500/30 dark:bg-primary-container/30 dark:text-on-primary-container dark:border-primary-container/40'
                        : 'stitch-glass text-stitch-on-surface border border-border/60 dark:bg-surface-container dark:text-on-surface dark:border-outline-variant/30'
                    )}
                  >
                    <span className="stitch-latin">{st?.name_ar || tk}</span>
                    <span className="text-[9px] text-stitch-muted font-bold stitch-latin dark:text-on-surface-variant">({tk})</span>
                    {!isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleRemoveStock(tk)}
                        className="hover:text-rose-500 transition-colors ml-0.5 dark:hover:text-error"
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
      </div>

      <div
        className={cn(
          'grid gap-6 w-full transition-all duration-300',
          columns === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'
        )}
      >
        {selectedTickers.map((tk) => (
          <ProfessionalTradingChart
            key={tk}
            initialTicker={tk}
          />
        ))}
      </div>
    </div>
  );
}
