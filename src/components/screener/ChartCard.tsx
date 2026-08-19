'use client';

/**
 * ChartCard — بطاقة شارت واحدة لشاشة Screener متعددة الشارتلات.
 *
 * الميزات:
 * - شموع يابانية (افتراضي) أو مساحة
 * - Volume histogram في الأسفل
 * - MA20 (خط أصفر) + MA50 (خط أزرق) كـ overlays
 * - خطوط دعم/مقاومة مكتشفة تلقائيًا
 * - Crosshair مع tooltip يعرض O/H/L/C/Vol
 * - أزرار: إغلاق/تكبير/تحديث
 * - سحب للترتيب (drag handle)
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  AreaSeries,
  HistogramSeries,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Trash2,
  Maximize2,
  Minimize2,
  RefreshCw,
  ExternalLink,
  GripVertical,
  TrendingUp,
  TrendingDown,
  BarChart3,
} from 'lucide-react';
import { StockIcon } from '@/components/stocks/StockIcon';
import { cn } from '@/lib/utils';
import {
  calcSMA,
  detectSupportResistance,
  formatPrice,
  formatVolume,
  type OhlcvPoint,
} from './chartIndicators';

// ─── الثوابت ──────────────────────────────────────────────────────────────

const UP_COLOR = '#10b981';
const DOWN_COLOR = '#f43f5e';
const MA20_COLOR = '#eab308'; // أصفر
const MA50_COLOR = '#3b82f6'; // أزرق
const SUPPORT_COLOR = '#10b981';
const RESISTANCE_COLOR = '#f43f5e';

// ─── الخصائص (Props) ──────────────────────────────────────────────────────

export interface ChartCardProps {
  ticker: string;
  name: string;
  nameAr: string;
  sector?: string;
  currentPrice: number;
  priceChange: number;
  timeframe: string;
  timeframeDays: number;
  chartType: 'area' | 'candlestick';
  isDark: boolean;
  isMaximized?: boolean;
  onRemove: () => void;
  onNavigate: () => void;
  onToggleMaximize?: () => void;
  onSelect?: () => void;
  onOpenChart?: () => void;
  draggableHandleProps?: Record<string, unknown>;
}

// ─── المكوّن ──────────────────────────────────────────────────────────────

export function ChartCard({
  ticker,
  name,
  nameAr,
  sector,
  currentPrice,
  priceChange,
  timeframe,
  timeframeDays,
  chartType,
  isDark,
  isMaximized = false,
  onRemove,
  onNavigate,
  onToggleMaximize,
  onSelect,
  onOpenChart,
  draggableHandleProps,
}: ChartCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<'Line'>[]>([]);

  const [history, setHistory] = useState<OhlcvPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoverData, setHoverData] = useState<OhlcvPoint | null>(null);
  const [livePrice, setLivePrice] = useState<{ price: number; change: number; changePct: number; volume: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // ─── تحميل بيانات التاريخ ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        let isIntraday = false;
        let res;
        
        if (timeframe === '1D' || timeframe === '1W' || timeframe === '1M') {
          const periodStr = timeframe.toLowerCase();
          res = await fetch(`/api/chart/${ticker}?period=${periodStr}&asset=stock`);
          isIntraday = true;
        } else {
          res = await fetch(`/api/stocks/${ticker}/history?days=${timeframeDays}`);
        }
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        
        if (json.success && Array.isArray(json.data)) {
          if (!cancelled) {
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
            setHistory(sorted);
          }
        } else {
          throw new Error(json.error || 'لا توجد بيانات تاريخية');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'فشل تحميل البيانات');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [ticker, timeframe, timeframeDays, refreshKey]);

  // ─── تحديث لحظي للسعر (Real-time polling كل 30 ثانية) ────────────────
  // بيجيب آخر سعر + change% من /api/stocks/<ticker> ويحدّث الـ chart
  useEffect(() => {
    let cancelled = false;

    async function fetchLivePrice() {
      try {
        const res = await fetch(`/api/stocks/${ticker}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.success) return;

        const stock = json.stock || json;
        const price = parseFloat(stock.current_price || stock.price || 0);
        const changePct = parseFloat(stock.change_percent || stock.change_pct || 0);
        const volume = parseFloat(stock.volume || 0);
        const prevPrice = price > 0 && changePct !== 0 ? price / (1 + changePct / 100) : price;
        const change = price - prevPrice;

        if (price > 0) {
          setLivePrice({ price, change, changePct, volume });
          setLastUpdate(new Date());

          // حدّث آخر شمعة في الـ chart (آخر يوم)
          setHistory(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const last = updated[updated.length - 1];
            // حدّث الـ close بس (السعر اللحظي)
            updated[updated.length - 1] = {
              ...last,
              close: price,
              high: Math.max(last.high, price),
              low: Math.min(last.low, price),
              volume: volume > 0 ? volume : last.volume,
            };
            return updated;
          });
        }
      } catch {
        // تجاهل الأخطاء في الـ polling — مش حرج
      }
    }

    // أول تحميل فوري
    fetchLivePrice();
    // بعدها كل 5 دقايق
    const interval = setInterval(fetchLivePrice, 300_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ticker]);

  // ─── رسم الشارت ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || history.length === 0 || loading) return;

    // تنظيف الشارت السابق
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRefs.current = [];
    }

    const container = containerRef.current;
    const chartHeight = container.clientHeight || 400;
    const chartWidth = container.clientWidth || 600;
    const chart = createChart(container, {
      width: chartWidth,
      height: chartHeight,
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
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: isDark ? '#334155' : '#e2e8f0',
        timeVisible: timeframe === '1D' || timeframe === '1W' || timeframe === '1M',
        secondsVisible: false,
        rightOffset: 4,
        tickMarkFormatter: (timeVal: any) => {
          let date: Date | null = null;
          if (typeof timeVal === 'number') {
            date = new Date(timeVal > 1e11 ? timeVal : timeVal * 1000);
          } else if (typeof timeVal === 'string') {
            const num = Number(timeVal);
            date = !isNaN(num) && /^\d+(\.\d+)?$/.test(timeVal) ? new Date(num > 1e11 ? num : num * 1000) : new Date(timeVal);
          } else if (timeVal && typeof timeVal === 'object' && 'year' in timeVal) {
            date = new Date(timeVal.year, timeVal.month - 1, timeVal.day);
          } else {
            date = new Date(timeVal);
          }
          if (!date || isNaN(date.getTime())) return typeof timeVal === 'string' ? timeVal : '';
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
          const hour = String(date.getHours()).padStart(2, '0');
          const minute = String(date.getMinutes()).padStart(2, '0');
          
          if (timeframe === '1D' || timeframe === '1W' || timeframe === '1M') {
             return `${day}/${month} ${hour}:${minute}`;
          }
          return `${day}/${month}/${year}`;
        },
      },
      localization: (timeframe === '1D' || timeframe === '1W' || timeframe === '1M') ? {
        timeFormatter: (timeVal: any) => {
          let date: Date | null = null;
          if (typeof timeVal === 'number') {
            date = new Date(timeVal > 1e11 ? timeVal : timeVal * 1000);
          } else if (typeof timeVal === 'string') {
            const num = Number(timeVal);
            date = !isNaN(num) && /^\d+(\.\d+)?$/.test(timeVal) ? new Date(num > 1e11 ? num : num * 1000) : new Date(timeVal);
          } else if (timeVal && typeof timeVal === 'object' && 'year' in timeVal) {
            date = new Date(timeVal.year, timeVal.month - 1, timeVal.day);
          } else {
            date = new Date(timeVal);
          }
          if (!date || isNaN(date.getTime())) return typeof timeVal === 'string' ? timeVal : '';
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const hour = String(date.getHours()).padStart(2, '0');
          const minute = String(date.getMinutes()).padStart(2, '0');
          return `${day}/${month} ${hour}:${minute}`;
        },
      } : undefined,
    });
    chartRef.current = chart;

    const closes = history.map(p => Number(p.close) || 0);
    const times = history.map(p => p.date as Time);

    // ── السلسلة الرئيسية ──
    if (chartType === 'candlestick') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
        priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      });
      candleSeries.setData(
        history.map(p => ({
          time: p.date as Time,
          open: Number(p.open) || 0,
          high: Number(p.high) || 0,
          low: Number(p.low) || 0,
          close: Number(p.close) || 0,
        })).filter(p => p.open > 0 && p.close > 0) // شيل القيم الفاضية
      );
    } else {
      const lastClose = closes[closes.length - 1];
      const firstClose = closes[0];
      const isUp = lastClose >= firstClose;
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: isUp ? UP_COLOR : DOWN_COLOR,
        topColor: isUp ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)',
        bottomColor: isUp ? 'rgba(16, 185, 129, 0.02)' : 'rgba(244, 63, 94, 0.02)',
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      });
      areaSeries.setData(
        history.map(p => ({
          time: p.date as Time,
          value: Number(p.close) || 0,
        })).filter(p => p.value > 0)
      );
    }

    // ── Volume histogram ──
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeries.setData(
      history.map(p => ({
        time: p.date as Time,
        value: Number(p.volume) || 0,
        color: Number(p.close) >= Number(p.open) ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
      }))
    );

    // ── MA20 ──
    const ma20 = calcSMA(closes, 20);
    const ma20Series = chart.addSeries(LineSeries, {
      color: MA20_COLOR,
      lineWidth: 1,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      title: 'MA20',
    });
    ma20Series.setData(
      ma20
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter(Boolean) as { time: Time; value: number }[]
    );
    seriesRefs.current.push(ma20Series);

    // ── MA50 ──
    const ma50 = calcSMA(closes, 50);
    const ma50Series = chart.addSeries(LineSeries, {
      color: MA50_COLOR,
      lineWidth: 1,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      title: 'MA50',
    });
    ma50Series.setData(
      ma50
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter(Boolean) as { time: Time; value: number }[]
    );
    seriesRefs.current.push(ma50Series);

    // ── خطوط الدعم والمقاومة ──
    const { supports, resistances } = detectSupportResistance(history, 3, 2);
    const firstTime = times[0];
    const lastTime = times[times.length - 1];
    [...supports.map(v => ({ v, color: SUPPORT_COLOR, title: 'دعم' })),
     ...resistances.map(v => ({ v, color: RESISTANCE_COLOR, title: 'مقاومة' }))]
      .forEach(({ v, color, title }) => {
        const srSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          title,
        });
        srSeries.setData([
          { time: firstTime, value: v },
          { time: lastTime, value: v },
        ]);
        seriesRefs.current.push(srSeries);
      });

    // ── Crosshair move handler ──
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point) {
        setHoverData(null);
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

      const point = history.find(b => b.date === timeStr || b.date === param.time);
      if (point) {
        setHoverData(point);
      }
    });

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = [];
    };
  }, [history, chartType, isDark, loading]);

  const isUp = priceChange >= 0;
  const displayPrice = hoverData?.close ?? currentPrice;

  return (
    <Card
      className={cn(
        'overflow-hidden border border-border bg-card shadow-md flex flex-col h-full group relative',
        isMaximized && 'h-[calc(100vh-12rem)]'
      )}
      onClick={onSelect}
    >
      {/* رأس البطاقة — معلومات السهم + أزرار التحكم */}
      <div className="flex items-center justify-between p-2.5 border-b border-border bg-muted/30 gap-2">
        {/* Drag handle + معلومات السهم */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            {...(draggableHandleProps || {})}
            className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-muted-foreground touch-none"
            aria-label="اسحب لإعادة الترتيب"
            title="اسحب لإعادة الترتيب"
            onClick={e => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <StockIcon
            ticker={ticker}
            name={name}
            sector={sector}
            size="sm"
            className="w-7 h-7 rounded bg-muted/40 shrink-0"
          />
          <div className="min-w-0 leading-tight cursor-pointer" onClick={(e) => { e.stopPropagation(); onNavigate(); }}>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-foreground truncate hover:underline">
                {nameAr || name}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 font-bold rounded bg-muted text-muted-foreground uppercase">
                {ticker}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground truncate block">
              {sector || '—'}
            </span>
          </div>
        </div>

        {/* أزرار التحكم */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); setRefreshKey(k => k + 1); }}
            title="تحديث"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {onOpenChart && (
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onOpenChart(); }}
              title="فتح شارت تفصيلي"
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </Button>
          )}
          {onToggleMaximize && (
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
              title={isMaximized ? 'تصغير' : 'تكبير'}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            title="فتح تفاصيل السهم"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 rounded-md text-muted-foreground hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="حذف من الشاشة"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* شريط الإحصائيات: السعر + التغير + hover OHLC + Live indicator */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border bg-muted/10 text-xs gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold tabular-nums text-sm text-foreground" dir="ltr">
            {formatPrice(livePrice?.price ?? displayPrice)}
          </span>
          <span
            className={cn(
              'font-semibold flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5',
              (livePrice?.changePct ?? priceChange) >= 0
                ? 'text-emerald-600 bg-emerald-500/10'
                : 'text-rose-600 bg-rose-500/10'
            )}
            dir="ltr"
          >
            {(livePrice?.changePct ?? priceChange) >= 0
              ? <TrendingUp className="w-2.5 h-2.5" />
              : <TrendingDown className="w-2.5 h-2.5" />}
            {(livePrice?.changePct ?? priceChange) >= 0 ? '+' : ''}
            {(livePrice?.changePct ?? priceChange ?? 0).toFixed(2)}%
          </span>
          {/* Live indicator — بيبان إن في تحديث لحظي */}
          {livePrice && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-600">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              LIVE
            </span>
          )}
          {/* آخر تحديث */}
          {lastUpdate && (
            <span className="text-[8px] text-muted-foreground hidden sm:inline" dir="ltr">
              {lastUpdate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {/* مؤشرات Overlay */}
          <div className="hidden md:flex items-center gap-1.5 text-[9px]">
            <span className="flex items-center gap-0.5">
              <span className="w-2 h-0.5 inline-block" style={{ background: MA20_COLOR }} />
              <span className="text-muted-foreground">MA20</span>
            </span>
            <span className="flex items-center gap-0.5">
              <span className="w-2 h-0.5 inline-block" style={{ background: MA50_COLOR }} />
              <span className="text-muted-foreground">MA50</span>
            </span>
          </div>
        </div>

        {/* Live hover OHLC info */}
        {hoverData ? (
          <div className="text-[9px] text-muted-foreground flex gap-1.5" dir="ltr">
            <span>O:<span className="text-foreground">{hoverData?.open?.toFixed(2) ?? '—'}</span></span>
            <span>H:<span className="text-emerald-500">{hoverData?.high?.toFixed(2) ?? '—'}</span></span>
            <span>L:<span className="text-rose-500">{hoverData?.low?.toFixed(2) ?? '—'}</span></span>
            <span>C:<span className="text-foreground">{hoverData?.close?.toFixed(2) ?? '—'}</span></span>
            <span className="text-muted-foreground/70 hidden sm:inline">V:{formatVolume(hoverData.volume)}</span>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            مرّر المؤشر للاستعراض
          </span>
        )}
      </div>

      {/* منطقة الرسم — min-h-[400px] يضمن إن الشارت ليه ارتفاع كافي
          حتى لو الـ container مش visible مؤقتًا (خاصة في dark mode) */}
      <div
        className="flex-1 min-h-[400px] relative"
        style={{ background: isDark ? '#11131c' : '#ffffff' }}
      >
        {loading && (
          <div className="absolute inset-0 flex flex-col gap-2 p-3 justify-center items-center z-10">
            <Skeleton className="w-full h-3/4 rounded" />
            <div className="flex w-full justify-between">
              <Skeleton className="w-1/4 h-3" />
              <Skeleton className="w-1/3 h-3" />
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col justify-center items-center text-center p-4 z-10">
            <span className="text-xs text-destructive mb-2">{error}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] font-medium"
              onClick={(e) => { e.stopPropagation(); setRefreshKey(k => k + 1); }}
            >
              إعادة محاولة
            </Button>
          </div>
        )}
        {/* لو مفيش بيانات تاريخية، اعرض رسالة بدل chart فاضي */}
        {!loading && !error && history.length === 0 && (
          <div className="absolute inset-0 flex flex-col justify-center items-center text-center p-4 z-10">
            <span className="text-xs text-muted-foreground mb-1">مفيش بيانات تاريخية</span>
            <span className="text-[10px] text-muted-foreground">جرّب تحديث أو اختار سهم تاني</span>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full min-h-[400px]" />
      </div>

      {/* Badge الفترة في الزاوية */}
      <div className="absolute top-1 left-2 z-20 pointer-events-none">
        <Badge variant="outline" className="text-[8px] px-1 py-0 bg-background/70 backdrop-blur-sm">
          {timeframe}
        </Badge>
      </div>
    </Card>
  );
}

export default ChartCard;
