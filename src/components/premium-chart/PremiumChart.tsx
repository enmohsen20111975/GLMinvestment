'use client';

/**
 * Premium Chart — Main Orchestrator
 * =====================================================================
 *
 * المكوّن الرئيسي للشارت المتميز. يجمع بين:
 * - lightweight-charts v5 للشموع والمؤشرات
 * - DrawingCanvas لطبقة الرسم التفاعلية
 * - DrawingToolbar لشريط الأدوات
 * - تجارب احترافية: زوم، بان، كروس-هير، تلميحات، أسطورة OHLCV
 *
 * المعمارية:
 * - useChartInstance hook ينشئ الـ chart مرة واحدة + ResizeObserver
 * - useEffect واحد لتحديث الشموع عند تغيّر ohlcv
 * - useEffect منفصل لكل مؤشر (SMA/EMA/BB/RSI/MACD) لتفادي إعادة الإنشاء
 * - DrawingCanvas فوق كل ده، بـ absolute positioning
 *
 * الاستخدام:
 *   <PremiumChart
 *     ticker="COMI"
 *     ohlcv={data.ohlcv}
 *     indicators={data.indicators}
 *     tradePlan={{ entry: 12.5, stop: 11.8, target1: 14.0 }}
 *     height={500}
 *   />
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type CandlestickData,
  type LineData,
  type HistogramData,
} from 'lightweight-charts';
import { useDrawingStore } from './drawing/drawing-store';
import { DrawingCanvas } from './drawing/DrawingCanvas';
import { DrawingToolbar } from './drawing/DrawingToolbar';
import { useChartTheme } from './core/useChartTheme';
import { sanitizeCandles, toTime, formatVolumeData, formatPrice } from './utils';
import type { ChartData, CandleWithIndicators, PremiumChartProps, TradePlan, SMCData } from './types';
import { DARK_THEME } from './types';

export function PremiumChart({
  ticker,
  stockName,
  ohlcv,
  indicators,
  tradePlan,
  smcData,
  livePrice,
  currencyLabel = 'ج.م',
  height = 500,
  theme = 'dark',
  showDrawingToolbar = true,
  showIndicatorPanel = true,
  showTradePlanLines = true,
  showSMCZones = true,
  storageKey,
}: PremiumChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  const chartTheme = useChartTheme(theme);
  const { selectedTool } = useDrawingStore();

  // ─── Create chart instance (one time) ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.textColor,
        fontFamily: 'inherit',
        direction: 'rtl',
      },
      grid: {
        vertLines: { color: chartTheme.gridColor },
        horzLines: { color: chartTheme.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: chartTheme.borderColor,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: chartTheme.background,
        },
        horzLine: {
          color: chartTheme.borderColor,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: chartTheme.background,
        },
      },
      rightPriceScale: {
        borderColor: chartTheme.borderColor,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: chartTheme.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      autoSize: true,
    });

    chartRef.current = chart;

    // Candlestick series (v5 API: addSeries(SeriesType, options))
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: chartTheme.upColor,
      downColor: chartTheme.downColor,
      borderUpColor: chartTheme.upColor,
      borderDownColor: chartTheme.downColor,
      wickUpColor: chartTheme.upColor,
      wickDownColor: chartTheme.downColor,
      borderVisible: false,
    });
    candleSeriesRef.current = candleSeries;

    // Volume series (overlay at bottom)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      color: chartTheme.upColor,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // ResizeObserver fallback (autoSize should handle, but be safe)
    const resize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);
    resize();

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      sma20SeriesRef.current = null;
      sma50SeriesRef.current = null;
      sma200SeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [chartTheme]);

  // ─── Update candle + volume data ──────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !ohlcv?.length) return;
    const cleaned = sanitizeCandles(ohlcv);
    const candleData: CandlestickData[] = cleaned.map((d) => ({
      time: toTime(d.time),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    candleSeriesRef.current.setData(candleData);

    const volData: HistogramData[] = formatVolumeData(cleaned) as HistogramData[];
    volumeSeriesRef.current.setData(volData);

    // Fit content on first load
    chartRef.current?.timeScale().fitContent();
  }, [ohlcv]);

  // ─── Update indicators (SMA 20/50/200) ────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleSeriesRef.current) return;

    // SMA 20
    if (indicators?.sma20 && indicators.sma20.length > 0) {
      if (!sma20SeriesRef.current) {
        sma20SeriesRef.current = chart.addSeries(LineSeries, {
          color: chartTheme.sma20Color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      const data: LineData[] = indicators.sma20
        .filter((d) => d.value !== null && d.value !== undefined)
        .map((d) => ({ time: toTime(d.time), value: d.value as number }));
      sma20SeriesRef.current.setData(data);
    }

    // SMA 50
    if (indicators?.sma50 && indicators.sma50.length > 0) {
      if (!sma50SeriesRef.current) {
        sma50SeriesRef.current = chart.addSeries(LineSeries, {
          color: chartTheme.sma50Color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      const data: LineData[] = indicators.sma50
        .filter((d) => d.value !== null && d.value !== undefined)
        .map((d) => ({ time: toTime(d.time), value: d.value as number }));
      sma50SeriesRef.current.setData(data);
    }

    // SMA 200
    if (indicators?.sma200 && indicators.sma200.length > 0) {
      if (!sma200SeriesRef.current) {
        sma200SeriesRef.current = chart.addSeries(LineSeries, {
          color: chartTheme.sma200Color,
          lineWidth: 3,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      const data: LineData[] = indicators.sma200
        .filter((d) => d.value !== null && d.value !== undefined)
        .map((d) => ({ time: toTime(d.time), value: d.value as number }));
      sma200SeriesRef.current.setData(data);
    }
  }, [indicators, chartTheme]);

  // ─── Trade plan price lines (entry/stop/TP1/TP2/TP3) ──────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Clear previous price lines
    for (const pl of priceLinesRef.current) {
      try { series.removePriceLine(pl); } catch { /* ignore */ }
    }
    priceLinesRef.current = [];

    if (!showTradePlanLines || !tradePlan) return;

    const addLine = (price: number | null | undefined, color: string, title: string, style: LineStyle = LineStyle.Dashed) => {
      if (price === null || price === undefined || !isFinite(price) || price <= 0) return;
      try {
        const pl = series.createPriceLine({
          price,
          color,
          lineWidth: 2,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        });
        priceLinesRef.current.push(pl);
      } catch { /* ignore */ }
    };

    addLine(tradePlan.entry, '#2196f3', 'دخول', LineStyle.Solid);
    addLine(tradePlan.stop, '#ef5350', 'وقف', LineStyle.Solid);
    addLine(tradePlan.target1, '#26a69a', 'هدف 1', LineStyle.Dashed);
    addLine(tradePlan.target2, '#26a69a', 'هدف 2', LineStyle.Dashed);
    addLine(tradePlan.target3, '#26a69a', 'هدف 3', LineStyle.Dashed);
    addLine(livePrice, '#f0b90b', 'السعر الحالي', LineStyle.Dotted);
  }, [tradePlan, livePrice, showTradePlanLines]);

  // ─── Live price update ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || livePrice === null || livePrice === undefined) return;
    if (!ohlcv?.length) return;
    const lastCandle = ohlcv[ohlcv.length - 1];
    if (!lastCandle) return;
    try {
      candleSeriesRef.current.update({
        time: toTime(lastCandle.time),
        open: lastCandle.open,
        high: Math.max(lastCandle.high, livePrice),
        low: Math.min(lastCandle.low, livePrice),
        close: livePrice,
      });
    } catch { /* ignore */ }
  }, [livePrice, ohlcv]);

  // ─── Crosshair info (OHLCV legend) ─────────────────────────────────────────
  const [legendData, setLegendData] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    changePct: number;
    time: string;
  } | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const handler = (param: any) => {
      if (!param.time || !param.seriesData) {
        // Show latest candle
        if (ohlcv?.length) {
          const last = ohlcv[ohlcv.length - 1];
          const prev = ohlcv[ohlcv.length - 2] || last;
          setLegendData({
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
            volume: last.volume,
            changePct: ((last.close - prev.close) / prev.close) * 100,
            time: String(last.time),
          });
        }
        return;
      }
      const data = param.seriesData.get(series);
      if (data) {
        setLegendData({
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: 0,
          changePct: 0,
          time: String(param.time),
        });
      }
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [ohlcv]);

  // ─── SMC Zones (Order Blocks + FVG) as price lines ─────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !showSMCZones || !smcData) return;

    const linesToAdd: any[] = [];
    if (smcData.order_blocks) {
      for (const ob of smcData.order_blocks.slice(0, 5)) {
        try {
          const color = ob.type === 'bullish' ? '#26a69a' : '#ef5350';
          const pl1 = series.createPriceLine({
            price: ob.top,
            color: color + '60',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `OB ${ob.type}`,
          });
          const pl2 = series.createPriceLine({
            price: ob.bottom,
            color: color + '60',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: '',
          });
          linesToAdd.push(pl1, pl2);
          priceLinesRef.current.push(pl1, pl2);
        } catch { /* ignore */ }
      }
    }

    return () => {
      for (const pl of linesToAdd) {
        try { series.removePriceLine(pl); } catch { /* ignore */ }
      }
    };
  }, [smcData, showSMCZones]);

  // ─── Compute last candle stats ─────────────────────────────────────────────
  const lastCandle = ohlcv?.[ohlcv.length - 1];
  const prevCandle = ohlcv?.[ohlcv.length - 2];
  const lastPrice = livePrice ?? lastCandle?.close ?? 0;
  const changePct = useMemo(() => {
    if (!lastCandle || !prevCandle || prevCandle.close <= 0) return 0;
    return ((lastPrice - prevCandle.close) / prevCandle.close) * 100;
  }, [lastCandle, prevCandle, lastPrice]);

  const isUp = changePct >= 0;
  const isCursorTool = selectedTool === 'cursor' || selectedTool === 'none';

  return (
    <div
      className="relative w-full bg-card rounded-xl overflow-hidden border border-border"
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
      dir="rtl"
    >
      {/* Header — ticker + price + OHLCV legend */}
      <div className="absolute top-0 left-0 right-0 z-10 px-3 py-2 bg-gradient-to-b from-card/95 to-transparent flex items-start justify-between pointer-events-none">
        <div className="flex flex-col gap-1 pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{ticker}</span>
            {stockName && (
              <span className="text-xs text-muted-foreground">— {stockName}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={isUp ? 'text-profit font-bold' : 'text-loss font-bold'}>
              {formatPrice(lastPrice)} {currencyLabel}
            </span>
            <span className={isUp ? 'text-profit' : 'text-loss'}>
              {isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
            </span>
          </div>
        </div>

        {/* OHLCV Legend */}
        {legendData && (
          <div className="hidden md:flex items-center gap-3 text-[11px] font-mono pointer-events-auto bg-card/80 backdrop-blur px-2 py-1 rounded-lg">
            <span>
              <span className="text-muted-foreground">O:</span>{' '}
              <span className={legendData.close >= legendData.open ? 'text-profit' : 'text-loss'}>
                {formatPrice(legendData.open)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">H:</span>{' '}
              <span className="text-profit">{formatPrice(legendData.high)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">L:</span>{' '}
              <span className="text-loss">{formatPrice(legendData.low)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">C:</span>{' '}
              <span className={legendData.close >= legendData.open ? 'text-profit' : 'text-loss'}>
                {formatPrice(legendData.close)}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Chart container */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ cursor: isCursorTool ? 'crosshair' : 'crosshair' }}
      />

      {/* Drawing Canvas overlay (above chart, below toolbar) */}
      <DrawingCanvas
        chart={chartRef.current}
        candleSeries={candleSeriesRef.current}
        width={dimensions.width}
        height={dimensions.height}
        storageKey={storageKey || `${ticker}__premium`}
      />

      {/* Drawing Toolbar */}
      {showDrawingToolbar && <DrawingToolbar />}

      {/* Indicator legend (bottom-left) */}
      {showIndicatorPanel && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-3 text-[10px] pointer-events-none">
          {indicators?.sma20 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: chartTheme.sma20Color }} />
              <span className="text-muted-foreground">SMA20</span>
            </span>
          )}
          {indicators?.sma50 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: chartTheme.sma50Color }} />
              <span className="text-muted-foreground">SMA50</span>
            </span>
          )}
          {indicators?.sma200 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: chartTheme.sma200Color }} />
              <span className="text-muted-foreground">SMA200</span>
            </span>
          )}
          {tradePlan?.entry && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: '#2196f3' }} />
              <span className="text-muted-foreground">Entry</span>
            </span>
          )}
          {tradePlan?.stop && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: '#ef5350' }} />
              <span className="text-muted-foreground">Stop</span>
            </span>
          )}
          {tradePlan?.target1 && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: '#26a69a' }} />
              <span className="text-muted-foreground">TP1</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
