'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type Time,
  LineSeries,
} from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, X, RefreshCw, TrendingUp, TrendingDown, LayoutGrid, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OhlcvPoint } from './chartIndicators';

// ألوان متميزة وجذابة للمنحنيات المختلفة
const LINE_COLORS = [
  '#a855f7', // بنفسجي
  '#f97316', // برتقالي
  '#06b6d4', // سماوي/تيل
  '#10b981', // زمردي/أخضر
  '#f43f5e', // وردي/أحمر
  '#3b82f6', // أزرق
  '#eab308', // أصفر
  '#ec4899', // وردي غامق
  '#8b5cf6', // بنفجسي مزرق
  '#0ea5e9', // لبني
];

export interface StockListItem {
  ticker: string;
  name: string;
  name_ar: string;
  sector?: string | null;
  current_price?: number | null;
  price_change?: number | null;
  volume?: number | null;
}

interface ComparisonChartCardProps {
  tickers: string[];
  allStocks: StockListItem[];
  timeframe: string;
  timeframeDays: number;
  isDark: boolean;
  onRemoveTicker: (ticker: string) => void;
  onAddTicker: (ticker: string) => void;
  onClearAll: () => void;
}

export function ComparisonChartCard({
  tickers,
  allStocks,
  timeframe,
  timeframeDays,
  isDark,
  onRemoveTicker,
  onAddTicker,
  onClearAll,
}: ComparisonChartCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // البيانات التاريخية لكل الأسهم
  const [histories, setHistories] = useState<Record<string, OhlcvPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // حالة التحويم الحيوي لمعرفة النسبة المئوية لكل سهم تحت مؤشر الماوس
  const [hoverPercentages, setHoverPercentages] = useState<Record<string, number> | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // البحث المحلي داخل الكارت لإضافة سهم
  const [compareSearch, setCompareSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // جلب البيانات التاريخية لجميع الأسهم المحددة بالتوازي
  useEffect(() => {
    if (tickers.length === 0) {
      setHistories({});
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchAllHistories() {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          tickers.map(async (ticker) => {
            try {
              let isIntraday = false;
              let res;
              if (timeframe === '1W' || timeframe === '1M') {
                const periodStr = timeframe.toLowerCase();
                res = await fetch(`/api/chart/${ticker}?period=${periodStr}&asset=stock`);
                isIntraday = true;
              } else {
                res = await fetch(`/api/stocks/${ticker}/history?days=${timeframeDays}`);
              }
              if (!res.ok) throw new Error();
              const json = await res.json();
              if (json.success && Array.isArray(json.data)) {
                const parsedData = json.data.map((d: any) => {
                  let ts = 0;
                  const rawTs = d.timestamp ?? d.date;
                  if (rawTs !== undefined && rawTs !== null) {
                    if (typeof rawTs === 'number') {
                      ts = rawTs;
                    } else {
                      const s = String(rawTs).trim();
                      const asNum = Number(s);
                      if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
                        ts = Math.floor(asNum);
                      } else {
                        const parsed = Date.parse(s.replace(' ', 'T'));
                        ts = isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
                      }
                    }
                  }
                  return {
                    ...d,
                    date: (isIntraday ? ts : d.date) as any,
                    open: Number(d.open) || Number(d.price),
                    high: Number(d.high) || Number(d.price),
                    low: Number(d.low) || Number(d.price),
                    close: Number(d.close) || Number(d.price),
                    volume: Number(d.volume) || 0,
                  };
                });
                
                const sorted = parsedData.sort((a: any, b: any) => {
                  if (typeof a.date === 'number' && typeof b.date === 'number') {
                    return a.date - b.date;
                  }
                  return new Date(a.date).getTime() - new Date(b.date).getTime();
                });
                return { ticker, data: sorted, error: false };
              }
              return { ticker, data: [], error: true };
            } catch {
              return { ticker, data: [], error: true };
            }
          })
        );

        if (cancelled) return;

        const newHistories: Record<string, OhlcvPoint[]> = {};
        let hasErrors = false;
        let successfulFetches = 0;

        results.forEach(({ ticker, data, error }) => {
          if (!error && data.length > 0) {
            newHistories[ticker] = data;
            successfulFetches++;
          } else {
            hasErrors = true;
          }
        });

        setHistories(newHistories);
        if (successfulFetches === 0 && tickers.length > 0) {
          setError('فشل تحميل البيانات التاريخية لجميع الأسهم المحددة');
        }
      } catch (err) {
        if (!cancelled) {
          setError('حدث خطأ أثناء الاتصال بالخادم لجلب البيانات التاريخية');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchAllHistories();

    return () => {
      cancelled = true;
    };
  }, [tickers, timeframeDays, refreshKey]);

  // رسم وتحديث الشارت
  useEffect(() => {
    if (!containerRef.current || loading || Object.keys(histories).length === 0) return;

    // تنظيف الشارت السابق
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 450,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#11131c' : '#ffffff' },
        textColor: isDark ? '#94a3b8' : '#64748b',
        fontFamily: 'Inter, sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: isDark ? '#1e293b' : '#f1f5f9' },
        horzLines: { color: isDark ? '#1e293b' : '#f1f5f9' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isDark ? '#475569' : '#cbd5e1',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isDark ? '#334155' : '#475569',
        },
        horzLine: {
          color: isDark ? '#475569' : '#cbd5e1',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isDark ? '#334155' : '#475569',
        },
      },
      rightPriceScale: {
        borderColor: isDark ? '#334155' : '#e2e8f0',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: isDark ? '#334155' : '#e2e8f0',
        timeVisible: timeframe === '1W' || timeframe === '1M',
        secondsVisible: false,
        rightOffset: 4,
      },
      localization: (timeframe === '1W' || timeframe === '1M') ? {
        timeFormatter: (time: number) => {
          const date = new Date(time * 1000);
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const hour = String(date.getHours()).padStart(2, '0');
          const minute = String(date.getMinutes()).padStart(2, '0');
          return `${day}/${month} ${hour}:${minute}`;
        },
      } : undefined,
    });
    chartRef.current = chart;

    tickers.forEach((ticker, index) => {
      const data = histories[ticker];
      if (!data || data.length === 0) return;

      const basePrice = data[0].close || 1;
      const color = LINE_COLORS[index % LINE_COLORS.length];

      const series = chart.addSeries(LineSeries, {
        color: color,
        lineWidth: 2,
        priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(2)}%` },
      });

      series.setData(data.map((p) => ({
        time: p.date as Time,
        value: ((p.close - basePrice) / basePrice) * 100,
      })));
    });

    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.point) {
        setHoverPercentages(null);
        setHoverDate(null);
        return;
      }

      const timeStr =
        typeof param.time === 'string'
          ? param.time
          : param.time instanceof Date
            ? param.time.toISOString().split('T')[0]
            : typeof param.time === 'number'
              ? param.time
              : new Date((param.time as any) * 1000).toISOString().split('T')[0];

      const hoverVals: Record<string, number> = {};

      tickers.forEach((ticker) => {
        const data = histories[ticker];
        if (!data) return;
        const point = data.find((p) => p.date === timeStr || p.date === param.time);
        if (point) {
          const basePrice = data[0].close || 1;
          hoverVals[ticker] = ((point.close - basePrice) / basePrice) * 100;
        }
      });

      setHoverPercentages(hoverVals);
      
      // تنسيق التاريخ المقروء
      try {
        const dateObj =
          typeof timeStr === 'number'
            ? new Date(timeStr * 1000)
            : new Date(timeStr);
        if (!isNaN(dateObj.getTime())) {
          const day = String(dateObj.getDate()).padStart(2, '0');
          const month = String(dateObj.getMonth() + 1).padStart(2, '0');
          const hour = String(dateObj.getHours()).padStart(2, '0');
          const minute = String(dateObj.getMinutes()).padStart(2, '0');
          setHoverDate(`${day}/${month} ${hour}:${minute}`);
        } else {
          setHoverDate(timeStr);
        }
      } catch {
        setHoverDate(timeStr);
      }
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [histories, isDark, loading, tickers]);

  // حساب النسبة المئوية الحالية (الأخيرة) لكل سهم لعرضها بشكل افتراضي
  const currentPercentages = useMemo(() => {
    const percentages: Record<string, number> = {};
    tickers.forEach((ticker) => {
      const data = histories[ticker];
      if (data && data.length > 0) {
        const basePrice = data[0].close || 1;
        const lastPrice = data[data.length - 1].close;
        percentages[ticker] = ((lastPrice - basePrice) / basePrice) * 100;
      } else {
        percentages[ticker] = 0;
      }
    });
    return percentages;
  }, [histories, tickers]);

  // تصفية الاقتراحات للبحث المحلي
  const filteredSuggestions = useMemo(() => {
    const q = compareSearch.toLowerCase().trim();
    if (!q) return [];
    return allStocks
      .filter((stock) => {
        const alreadyAdded = tickers.includes(stock.ticker);
        const matchesQuery =
          stock.ticker.toLowerCase().includes(q) ||
          (stock.name || '').toLowerCase().includes(q) ||
          (stock.name_ar || '').toLowerCase().includes(q);
        return matchesQuery && !alreadyAdded;
      })
      .slice(0, 6);
  }, [allStocks, compareSearch, tickers]);

  const handleAddLocalStock = (ticker: string) => {
    onAddTicker(ticker);
    setCompareSearch('');
    setShowSuggestions(false);
  };

  return (
    <Card className="overflow-hidden border border-border bg-card shadow-lg flex flex-col h-full min-h-[500px]">
      {/* رأس الكارت الرئيسي */}
      <div className="flex flex-col md:flex-row md:items-center justify-between p-4 border-b border-border bg-muted/20 gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">شارت المقارنة للأداء النسبي</h2>
            <p className="text-[10px] text-muted-foreground">
              مقارنة أداء الأسهم بالنسبة المئوية (%) من بداية الفترة المحددة ({timeframe})
            </p>
          </div>
        </div>

        {/* أدوات البحث والإضافة */}
        <div className="flex items-center gap-2">
          {/* محرك بحث محلي مبسط */}
          <div className="relative w-48 sm:w-60">
            <div className="relative">
              <Search className="absolute right-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="إضافة سهم للمقارنة..."
                className="pr-8 h-7.5 text-xs font-semibold"
                value={compareSearch}
                onChange={(e) => {
                  setCompareSearch(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
              />
              {compareSearch && (
                <button
                  className="absolute left-2 top-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setCompareSearch('');
                    setShowSuggestions(false);
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* قائمة اقتراحات البحث المحلي */}
            {showSuggestions && compareSearch && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSuggestions(false)} />
                <div className="absolute right-0 left-0 mt-1 z-50 rounded-lg border border-border bg-popover shadow-xl max-h-48 overflow-y-auto p-1">
                  {filteredSuggestions.length > 0 ? (
                    filteredSuggestions.map((stock) => (
                      <button
                        key={stock.ticker}
                        onClick={() => handleAddLocalStock(stock.ticker)}
                        className="w-full text-right px-2.5 py-1.5 text-xs rounded hover:bg-accent hover:text-accent-foreground flex items-center justify-between transition-colors min-h-[30px]"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-foreground">{stock.ticker}</span>
                          <span className="text-muted-foreground truncate max-w-[120px]">
                            {stock.name_ar || stock.name}
                          </span>
                        </div>
                        <Plus className="w-3 h-3 text-muted-foreground" />
                      </button>
                    ))
                  ) : (
                    <div className="p-2 text-center text-xs text-muted-foreground">لا توجد نتائج مطابقة</div>
                  )}
                </div>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="تحديث البيانات"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7.5 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/5"
            onClick={onClearAll}
            disabled={tickers.length === 0}
          >
            مسح الكل
          </Button>
        </div>
      </div>

      {/* لوحة تفاعلية (Legend) لعرض منحنيات الأسهم والنسب المئوية */}
      <div className="px-4 py-2 border-b border-border bg-muted/5 flex flex-wrap gap-2 items-center text-xs">
        <span className="text-muted-foreground font-medium shrink-0">
          {hoverDate ? `القيمة في ${hoverDate}:` : 'الأسهم المقارنة (الأداء الكلي):'}
        </span>
        {tickers.map((ticker, index) => {
          const color = LINE_COLORS[index % LINE_COLORS.length];
          const stock = allStocks.find((s) => s.ticker === ticker);
          const percent = hoverPercentages ? hoverPercentages[ticker] : currentPercentages[ticker];
          const isUp = percent >= 0;

          return (
            <div
              key={ticker}
              className="flex items-center gap-1 bg-card border border-border rounded-lg pl-1.5 pr-2.5 py-1 text-[11px] font-medium shadow-sm transition-all"
            >
              {/* مؤشر لون المنحنى */}
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="font-bold text-foreground ml-1">{ticker}</span>
              <span className="text-muted-foreground text-[10px] hidden sm:inline max-w-[80px] truncate">
                {stock?.name_ar || stock?.name || ''}
              </span>
              
              {/* النسبة المئوية */}
              {percent !== undefined ? (
                <span
                  className={cn(
                    'font-bold ml-1.5 tabular-nums text-[10px]',
                    isUp ? 'text-emerald-600' : 'text-rose-600'
                  )}
                  dir="ltr"
                >
                  {isUp ? '+' : ''}
                  {percent.toFixed(2)}%
                </span>
              ) : (
                <span className="text-muted-foreground">..</span>
              )}

              {/* زر الحذف */}
              <button
                onClick={() => onRemoveTicker(ticker)}
                className="text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5 rounded p-0.5 transition-colors"
                title="إزالة من المقارنة"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* منطقة الرسم البياني */}
      <div className="flex-1 min-h-0 relative bg-card">
        {loading && (
          <div className="absolute inset-0 flex flex-col gap-2 p-6 justify-center items-center z-10 bg-background/50 backdrop-blur-xs">
            <Skeleton className="w-full h-4/5 rounded-xl" />
            <div className="flex w-full justify-between px-2">
              <Skeleton className="w-1/5 h-3" />
              <Skeleton className="w-1/4 h-3" />
              <Skeleton className="w-1/6 h-3" />
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex flex-col justify-center items-center text-center p-6 z-10 bg-background/80">
            <span className="text-xs text-destructive mb-3 font-semibold">{error}</span>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              إعادة المحاولة
            </Button>
          </div>
        )}

        {tickers.length === 0 && !loading && (
          <div className="absolute inset-0 flex flex-col justify-center items-center text-center p-6 z-10 text-muted-foreground">
            <LayoutGrid className="w-10 h-10 text-muted-foreground/40 mb-2" />
            <h3 className="text-sm font-bold text-foreground">لا توجد أسهم مقارنة</h3>
            <p className="text-xs max-w-xs mt-1">
              استخدم محرك البحث بالأعلى أو أضف سهمًا من قائمة المراقبة للبدء في مقارنة الأداء.
            </p>
          </div>
        )}

        <div ref={containerRef} className="w-full h-[450px]" />
      </div>

      {/* تذييل الكارت التوضيحي */}
      <div className="px-4 py-2 border-t border-border bg-muted/10 text-[10px] text-muted-foreground text-left">
        * يتم حساب التغير النسبي (%) ديناميكيًا مقارنة بسعر إغلاق أول يوم متاح في الفترة المحددة ({timeframe})، ليبدأ جميع الأسهم عند نقطة الصفر (0%) في أقصى يسار الرسم البياني.
      </div>
    </Card>
  );
}

export default ComparisonChartCard;
