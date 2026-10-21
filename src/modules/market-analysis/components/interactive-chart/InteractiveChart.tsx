'use client';

/**
 * InteractiveChart — Main chart component (refactored into modules)
 * ================================================================
 * Per ALPHA Mission Directive 2026-10-20 — chart refactoring.
 *
 * This file contains ONLY the main chart rendering + data handling.
 * Extracted modules:
 *   - types.ts         → all TypeScript interfaces
 *   - utils.ts         → time/date/volume utility functions
 *   - indicators.ts    → EMA, MACD, OBV, Fibonacci calculators
 *   - sub-components.tsx → PlanLevel, ReasonCard, DetailItem, CollapsibleSection
 * ================================================================
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  LineStyle,
  type Time,
} from 'lightweight-charts';
import { useTheme } from 'next-themes';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Target,
  ShieldAlert,
  Gauge,
  Wallet,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Module imports
import type {
  ChartData,
  IndicatorData,
  FullChartProps,
} from './types';
import { CHART_GRID } from './types';
import {
  toTime,
  timeToNumber,
  sanitizeCandles,
  fmtDateLabel,
  formatLineData,
  formatVolumeData,
} from './utils';
import {
  calcEMA,
  calcMACD,
  calcOBV,
  calcFibLevels,
} from './indicators';
import {
  PlanLevel,
  ReasonCard,
  DetailItem,
  CollapsibleSection,
  signalToArabic,
} from './sub-components';

export function InteractiveChart(props: FullChartProps) {
 const {
 ohlcv,
 indicators,
 visibleIndicators,
 levels,
 regimeColor,
 targetPrice,
 stopLossPrice,
 entryPrice,
 target2Price,
 target3Price,
 bbSqueezeLevel,
 bosEvents,
 livePrice,
 cmfData,
 macdProjection,
 smartMarkers,
 smcData,
 fusionMetrics,
 // ALPHA-CHART-MERGE-1: professional sections props
 canonical,
 decisionData,
 flightState,
 makerState,
 stockDna,
 confluence,
 currentIndicators,
 suggestedPositionSizePct,
 analysisText,
 smcAnalysis,
 showDecisionHeader,
 showTradePlan,
 showReasons,
 showTechnicalDetails,
 showRescueCTA,
 tickerName,
 currencyLabel,
 } = props;

 const containerRef = useRef<HTMLDivElement>(null);
 const chartRef = useRef<IChartApi | null>(null);
 const seriesRefs = useRef<ISeriesApi<any>[]>([]);
 const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
 // SMART-CHART: تتبع آخر مرة عملنا فيها fitContent — عشان نعمل reset بس لما السياق يتغير (ticker/timeframe)
 // مش مع كل تحديث للبيانات (التحديث اللحظي بيستخدم series.update() ومش محتاج reset)
 const lastFitKeyRef = useRef<string>('');

 const { resolvedTheme } = useTheme();
 const isDark = resolvedTheme !== 'light';

 // ── Derive regime theme from regimeColor ──
 const regimeTheme = useMemo(() => {
 if (!regimeColor) return null;
 const color = regimeColor;
 return {
 background: `${color}0D`, // hex alpha 0D = ~5% opacity
 color: color,
 };
 }, [regimeColor]);

 // ── Regime label for badge ──
 const regimeLabel = useMemo(() => {
 if (regimeColor === '#22c55e') return 'صعودي';
 if (regimeColor === '#ef4444') return 'هبوطي';
 if (regimeColor === '#eab308') return 'عرضي';
 if (regimeColor) return 'نظام';
 return null;
 }, [regimeColor]);

 // ── Info overlay data for last candle ──
 const infoOverlay = useMemo(() => {
 if (!ohlcv || ohlcv.length === 0) return null;
 const last = ohlcv[ohlcv.length - 1];
 const prev = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2] : null;
 const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
 return {
 o: last.open,
 h: last.high,
 l: last.low,
 c: last.close,
 volume: last.volume,
 change,
 date: last.time,
 };
 }, [ohlcv]);

 // ── Main chart creation and data binding effect ──
 useEffect(() => {
 if (!containerRef.current) return;
 if (!ohlcv || ohlcv.length === 0) return;

 // P32 TASK 2: Sanitize OHLCV — drop null/NaN candles, sort ascending, dedupe.
 // Prevents lightweight-charts crashes: "Value is null" + "Invalid date string".
 const ohlcvClean = sanitizeCandles(ohlcv);
 if (ohlcvClean.length === 0) return;

 const container = containerRef.current;
 const width = container.clientWidth;
 if (width === 0) return;

 // Clean up previous chart
 if (chartRef.current) {
 try {
 chartRef.current.remove();
 } catch {
 // Already disposed
 }
 chartRef.current = null;
 seriesRefs.current = [];
 }

 const bgColor = isDark ? '#131722' : '#ffffff';
 const textColor = isDark ? '#d1d4dc' : '#0f172a';
 const gridColor = isDark ? '#363c4e' : '#f1f5f9';
 const crosshairLabelBg = isDark ? '#2a2e39' : '#e2e8f0';

 // ── Create chart ──
 const chart = createChart(container, {
 width,
 height: container.clientHeight || 500,
 layout: {
 background: { type: ColorType.Solid, color: bgColor },
 textColor: textColor,
 fontFamily:
 "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
 fontSize: 12,
 },
 grid: {
 vertLines: { color: gridColor },
 horzLines: { color: gridColor },
 },
 crosshair: {
 mode: 0, // Normal
 vertLine: {
 color: '#758696',
 width: 1,
 style: LineStyle.Dashed,
 labelBackgroundColor: '#2a2e39',
 },
 horzLine: {
 color: '#758696',
 width: 1,
 style: LineStyle.Dashed,
 labelBackgroundColor: '#2a2e39',
 },
 },
 rightPriceScale: {
 borderColor: CHART_GRID,
 scaleMargins: { top: 0.1, bottom: 0.25 },
 },
 timeScale: {
 borderColor: CHART_GRID,
 // ANTI-GAP-056: Show time (hours) for intraday charts so users see 10:15, 10:30 etc.
 timeVisible: true,
 secondsVisible: false,
 barSpacing: 8,
 rightOffset: 5,
 },
 // ANTI-GAP-056: Custom time formatter so intraday timestamps display as 'DD/MM HH:MM'
 localization: {
 timeFormatter: (time: number) => {
 const date = new Date(time * 1000);
 const day = String(date.getDate()).padStart(2, '0');
 const month = String(date.getMonth() + 1).padStart(2, '0');
 const hour = String(date.getHours()).padStart(2, '0');
 const minute = String(date.getMinutes()).padStart(2, '0');
 return `${day}/${month} ${hour}:${minute}`;
 },
 },
 // SMART-CHART: تفعيل صريح لـ Zoom (handleScale) و Pan (handleScroll)
 // المستخدم يقدر يعمل zoom بالماوس و pan من غير ما الشارت يعمل reset
 handleScale: {
 axisPressedMouseMove: true,
 axisDoubleClickReset: true,
 mouseWheel: true,
 pinch: true,
 },
 handleScroll: {
 mouseWheel: true,
 pressedMouseMove: true,
 horzTouchDrag: true,
 vertTouchDrag: true,
 },
 });

 chartRef.current = chart;

 // ── Candlestick series ──
 const candleSeries = chart.addSeries(CandlestickSeries, {
 upColor: UP_COLOR,
 downColor: DOWN_COLOR,
 borderDownColor: DOWN_COLOR,
 borderUpColor: UP_COLOR,
 wickDownColor: DOWN_COLOR,
 wickUpColor: UP_COLOR,
 });

 candleSeries.setData(
 ohlcvClean.map((d) => ({
 time: toTime(d.time),
 open: d.open,
 high: d.high,
 low: d.low,
 close: d.close,
 }))
 );

 candleSeriesRef.current = candleSeries;
 seriesRefs.current.push(candleSeries);

 // ── Last Price Line (always visible) ──
 const lastClose = ohlcvClean[ohlcvClean.length - 1].close;
 candleSeries.createPriceLine({
 price: lastClose,
 color: '#ffffff',
 lineWidth: 2,
 lineStyle: 0, // Solid
 axisLabelVisible: true,
 title: ` ${(lastClose ?? 0).toFixed(2)}`,
 });

 // ── EMA 9 & EMA 21 on Main Pane ──
 if (visibleIndicators.ema) {
 const closes = ohlcv.map((d) => d.close);

 const ema9Data = calcEMA(closes, 9);
 const ema9Series = chart.addSeries(LineSeries, {
 color: EMA9_COLOR,
 lineWidth: 1,
 title: 'EMA 9',
 crosshairMarkerVisible: false,
 });
 ema9Series.setData(
 ema9Data
 .map((v, i) =>
 v !== null ? { time: toTime(ohlcv[i].time), value: v } : null
 )
 .filter(Boolean) as { time: Time; value: number }[]
 );
 seriesRefs.current.push(ema9Series);

 const ema21Data = calcEMA(closes, 21);
 const ema21Series = chart.addSeries(LineSeries, {
 color: EMA21_COLOR,
 lineWidth: 1,
 title: 'EMA 21',
 crosshairMarkerVisible: false,
 });
 ema21Series.setData(
 ema21Data
 .map((v, i) =>
 v !== null ? { time: toTime(ohlcv[i].time), value: v } : null
 )
 .filter(Boolean) as { time: Time; value: number }[]
 );
 seriesRefs.current.push(ema21Series);
 }

 // ── SMA Lines (on main pane) ──
 if (visibleIndicators.sma20 && indicators.sma20?.length) {
 const s = chart.addSeries(LineSeries, {
 color: SMA20_COLOR,
 lineWidth: 1,
 title: 'SMA 20',
 crosshairMarkerVisible: false,
 });
 s.setData(formatLineData(indicators.sma20));
 seriesRefs.current.push(s);
 }

 if (visibleIndicators.sma50 && indicators.sma50?.length) {
 const s = chart.addSeries(LineSeries, {
 color: SMA50_COLOR,
 lineWidth: 1,
 title: 'SMA 50',
 crosshairMarkerVisible: false,
 });
 s.setData(formatLineData(indicators.sma50));
 seriesRefs.current.push(s);
 }

 if (visibleIndicators.sma200 && indicators.sma200?.length) {
 const s = chart.addSeries(LineSeries, {
 color: SMA200_COLOR,
 lineWidth: 1,
 title: 'SMA 200',
 crosshairMarkerVisible: false,
 });
 s.setData(formatLineData(indicators.sma200));
 seriesRefs.current.push(s);
 }

 // ── Bollinger Bands (on main pane) — orange when squeeze is active ──
 const isSqueeze = !!bbSqueezeLevel;
 const bbLineColor = isSqueeze ? BB_SQUEEZE_COLOR : BB_UPPER_COLOR;
 const bbMidColor = isSqueeze ? BB_SQUEEZE_COLOR : BB_MIDDLE_COLOR;
 const bbLineWidth = isSqueeze ? 2 : 1;

 if (visibleIndicators.bb && indicators.bb_upper?.length) {
 const upper = chart.addSeries(LineSeries, {
 color: bbLineColor,
 lineWidth: bbLineWidth,
 lineStyle: LineStyle.Dashed,
 title: isSqueeze ? 'BB Upper (Squeeze)' : 'BB Upper',
 crosshairMarkerVisible: false,
 });
 upper.setData(formatLineData(indicators.bb_upper));
 seriesRefs.current.push(upper);
 }

 if (visibleIndicators.bb && indicators.bb_middle?.length) {
 const middle = chart.addSeries(LineSeries, {
 color: bbMidColor,
 lineWidth: bbLineWidth,
 lineStyle: isSqueeze ? LineStyle.Dashed : LineStyle.Dotted,
 title: isSqueeze ? 'BB Middle (Squeeze)' : 'BB Middle',
 crosshairMarkerVisible: false,
 });
 middle.setData(formatLineData(indicators.bb_middle));
 seriesRefs.current.push(middle);
 }

 if (visibleIndicators.bb && indicators.bb_lower?.length) {
 const lower = chart.addSeries(LineSeries, {
 color: bbLineColor,
 lineWidth: bbLineWidth,
 lineStyle: LineStyle.Dashed,
 title: isSqueeze ? 'BB Lower (Squeeze)' : 'BB Lower',
 crosshairMarkerVisible: false,
 });
 lower.setData(formatLineData(indicators.bb_lower));
 seriesRefs.current.push(lower);
 }

 // ── Fibonacci Retracement Levels ──
 if (visibleIndicators.fibonacci) {
 // P32 TASK 2: use sanitized candles for auto-scale (avoid NaN from null highs/lows)
 const dataHigh = Math.max(...ohlcvClean.map((d) => d.high));
 const dataLow = Math.min(...ohlcvClean.map((d) => d.low));
 const fibLevels = calcFibLevels(dataHigh, dataLow);
 const firstTime = ohlcv[0].time;
 const lastTime = ohlcv[ohlcv.length - 1].time;

 fibLevels.forEach((fib) => {
 const fibSeries = chart.addSeries(LineSeries, {
 color: FIB_COLOR + '90',
 lineWidth: fib.level === 0 || fib.level === 1 ? 2 : 1,
 lineStyle: fib.style,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 title: fib.label,
 });
 fibSeries.setData([
 { time: toTime(firstTime), value: fib.price },
 { time: toTime(lastTime), value: fib.price },
 ]);
 seriesRefs.current.push(fibSeries);
 });
 }

 // ── BOS Event Markers ──
 if (visibleIndicators.bos && bosEvents && bosEvents.length > 0) {
 const markers = bosEvents
 .filter((evt) => evt.index >= 0 && evt.index < ohlcv.length)
 .map((evt) => {
 const isUp = evt.type === 'bos_up';
 return {
 time: toTime(ohlcv[evt.index].time),
 position: isUp ? 'belowBar' as const : 'aboveBar' as const,
 color: isUp ? UP_COLOR : DOWN_COLOR,
 shape: isUp ? 'arrowUp' as const : 'arrowDown' as const,
 text: isUp ? 'BOS ↑' : 'BOS ↓',
 };
 })
 .sort((a, b) => {
 // Guard against non-string time values (e.g. numeric timestamps)
 // which would crash with "localeCompare is not a function".
 const ta = String(a.time ?? '');
 const tb = String(b.time ?? '');
 return ta < tb ? -1 : ta > tb ? 1 : 0;
 });
 const seriesMarkers = createSeriesMarkers(candleSeries, markers);
 seriesRefs.current.push(seriesMarkers as unknown as ISeriesApi<any>);
 }

 // ── Support / Resistance / Pivot Lines ──
 if (levels && visibleIndicators.levels) {
 const lastTime = ohlcv[ohlcv.length - 1].time;
 const firstTime = ohlcv[0].time;
 const lineData = [
 { time: toTime(firstTime), value: 0 },
 { time: toTime(lastTime), value: 0 },
 ];

 // Support lines (single value + levels array)
 const allSupports: number[] = [];
 if (levels.support != null) allSupports.push(levels.support);
 if (levels.far_support != null) allSupports.push(levels.far_support);
 if (levels.support_levels) {
 levels.support_levels.forEach((l) => {
 if (l.price) allSupports.push(l.price);
 });
 }
 allSupports.forEach((price, idx) => {
 const s = chart.addSeries(LineSeries, {
 color: SUPPORT_COLOR + 'AA',
 lineWidth: idx === 0 ? 2 : 1,
 lineStyle: LineStyle.Dashed,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 title: `دعم ${(price ?? 0).toFixed(2)}`,
 });
 s.setData(lineData.map((d) => ({ time: d.time, value: price })));
 seriesRefs.current.push(s);
 });

 // Resistance lines (single value + levels array)
 const allResistances: number[] = [];
 if (levels.resistance != null) allResistances.push(levels.resistance);
 if (levels.far_resistance != null) allResistances.push(levels.far_resistance);
 if (levels.resistance_levels) {
 levels.resistance_levels.forEach((l) => {
 if (l.price) allResistances.push(l.price);
 });
 }
 allResistances.forEach((price, idx) => {
 const r = chart.addSeries(LineSeries, {
 color: RESISTANCE_COLOR + 'AA',
 lineWidth: idx === 0 ? 2 : 1,
 lineStyle: LineStyle.Dashed,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 title: `مقاومة ${(price ?? 0).toFixed(2)}`,
 });
 r.setData(lineData.map((d) => ({ time: d.time, value: price })));
 seriesRefs.current.push(r);
 });

 // Pivot line
 if (levels.pivot) {
 const p = chart.addSeries(LineSeries, {
 color: PIVOT_COLOR + '90',
 lineWidth: 1,
 lineStyle: LineStyle.Dashed,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 title: `Pivot ${(levels.pivot ?? 0).toFixed(2)}`,
 });
 p.setData(
 lineData.map((d) => ({ time: d.time, value: levels.pivot }))
 );
 seriesRefs.current.push(p);
 }
 }

 // ── Target Price Line (TP1) ──
 if (targetPrice) {
 candleSeries.createPriceLine({
 price: targetPrice,
 color: '#26a69a',
 lineWidth: 2,
 lineStyle: 2, // Dashed
 axisLabelVisible: true,
 title: 'TP1',
 });
 }

 // CHART-PRO-047: TP2 Price Line
 if (target2Price) {
 candleSeries.createPriceLine({
 price: target2Price,
 color: '#26a69a',
 lineWidth: 1,
 lineStyle: 2, // Dashed
 axisLabelVisible: true,
 title: 'TP2',
 });
 }

 // CHART-PRO-047: TP3 Price Line
 if (target3Price) {
 candleSeries.createPriceLine({
 price: target3Price,
 color: '#26a69a',
 lineWidth: 1,
 lineStyle: 2, // Dashed
 axisLabelVisible: true,
 title: 'TP3',
 });
 }

 // CHART-PRO-047: Entry Price Line (BUY)
 if (entryPrice) {
 candleSeries.createPriceLine({
 price: entryPrice,
 color: '#2196f3',
 lineWidth: 2,
 lineStyle: 1, // Dashed
 axisLabelVisible: true,
 title: 'BUY',
 });
 }

 // ── Stop-Loss Price Line ──
 if (stopLossPrice) {
 candleSeries.createPriceLine({
 price: stopLossPrice,
 color: '#ef5350',
 lineWidth: 2,
 lineStyle: 0, // Solid
 axisLabelVisible: true,
 title: 'SL',
 });
 }

 // ── SMC-ENGINE-066 + BRIEF-045: Smart Money Concepts Zones ──
 // Order Blocks: مناطق المؤسسات (أخضر = Bullish OB، أحمر = Bearish OB)
 // FVG: فجوات القيمة العادلة (أزرق = Bullish، برتقالي = Bearish)
 // BRIEF-045: نرسم المناطق كـ "boxes" محاكاة (top + bottom lines مع label واضح)
 if (smcData && smcData.ready !== false) {
 // BRIEF-045: استخدم smc_zones لو موجودة (أكثر تفصيلاً)
 const _zones = smcData.smc_zones || [];
 const _obs = smcData.order_blocks || [];
 const _fvgs = smcData.fvgs || [];

 // رسم الـ Order Blocks كـ zones (top + bottom = box simulation)
 _obs.forEach((ob) => {
 const isBullish = ob.type === 'bullish_ob';
 const color = isBullish ? 'rgba(38, 166, 154, 0.7)' : 'rgba(239, 83, 80, 0.7)';
 const label = isBullish ? '🟢 Bullish OB' : '🔴 Bearish OB';
 // Top line (حدود المنطقة العلوية)
 candleSeries.createPriceLine({
 price: ob.top,
 color,
 lineWidth: 2,
 lineStyle: 0, // Solid
 axisLabelVisible: true,
 title: label,
 });
 // Bottom line (حدود المنطقة السفلية)
 candleSeries.createPriceLine({
 price: ob.bottom,
 color,
 lineWidth: 2,
 lineStyle: 0, // Solid
 axisLabelVisible: false,
 title: isBullish ? 'OB Bottom' : 'OB Bottom (Bear)',
 });
 });

 // رسم الـ FVG (Fair Value Gaps) كـ zones
 _fvgs.forEach((fvg) => {
 const isBullish = fvg.type === 'bullish_fvg';
 const color = isBullish ? 'rgba(33, 150, 243, 0.6)' : 'rgba(255, 152, 0, 0.6)';
 const label = isBullish ? '🔵 Bullish FVG' : '🟠 Bearish FVG';
 // Top line
 candleSeries.createPriceLine({
 price: fvg.top,
 color,
 lineWidth: 1,
 lineStyle: 2, // Dashed
 axisLabelVisible: true,
 title: label,
 });
 // Bottom line
 candleSeries.createPriceLine({
 price: fvg.bottom,
 color,
 lineWidth: 1,
 lineStyle: 2, // Dashed
 axisLabelVisible: false,
 title: isBullish ? 'FVG Bottom' : 'FVG Bottom (Bear)',
 });
 });

 // رسم الـ Liquidity Sweeps (خطوط أفقية صفراء)
 if (smcData.sweeps && smcData.sweeps.length > 0) {
 smcData.sweeps.forEach((sweep) => {
 const isBullish = sweep.type === 'bullish_sweep';
 candleSeries.createPriceLine({
 price: sweep.level,
 color: 'rgba(255, 235, 59, 0.8)',
 lineWidth: 1,
 lineStyle: 1, // Dotted
 axisLabelVisible: true,
 title: isBullish ? '🦈 Sweep' : '🦈 Sweep (Bear)',
 });
 });
 }
 }

 // ═══════════════════════════════════════════════════════════════════
 // PHASE 11: V20 ULTIMATE FUSION ENGINE — رسم VWAP + الجيب الذهبي + Risk
 // ═══════════════════════════════════════════════════════════════════
 // المرجعية: Documentation/HOW_WE_ANALYZE_AND_PREDICT.md §19 (Phase 11)
 //
 // بنرسم 5 خطوط أفقية على الشارت:
 // 1. VWAP (القيمة العادلة) — بنفسجي غامق
 // 2. Fib 0.618 (حد الجيب الذهبي العلوي) — برتقالي
 // 3. Fib 0.786 (حد الجيب الذهبي السفلي) — برتقالي
 // 4. TP1 (1.5R) — أخضر فاتح
 // 5. TP2 (3.0R) — أخضر داكن
 // 6. SL (Stop Loss) — أحمر
 // ═══════════════════════════════════════════════════════════════════
 if (fusionMetrics && fusionMetrics.ready !== false) {
 const VWAP_COLOR = 'rgba(168, 85, 247, 0.9)'; // بنفسجي
 const FIB_COLOR = 'rgba(255, 123, 0, 0.7)'; // برتقالي
 const TP1_COLOR = 'rgba(38, 166, 154, 0.8)'; // أخضر فاتح
 const TP2_COLOR = 'rgba(0, 105, 92, 0.9)'; // أخضر داكن
 const SL_COLOR = 'rgba(239, 83, 80, 0.9)'; // أحمر

 // 1. VWAP (القيمة العادلة)
 if (fusionMetrics.fair_value && fusionMetrics.fair_value > 0) {
 candleSeries.createPriceLine({
 price: fusionMetrics.fair_value,
 color: VWAP_COLOR,
 lineWidth: 2,
 lineStyle: 0, // Solid
 axisLabelVisible: true,
 title: `📊 VWAP ${fusionMetrics.fair_premium > 0 ? '+' : ''}${(fusionMetrics.fair_premium ?? 0).toFixed(1)}%`,
 });
 }

 // 2. الجيب الذهبي (Golden Pocket 0.618 - 0.786)
 const bb = fusionMetrics.bigbeluga;
 if (bb) {
 if (bb.fib_618 && bb.fib_618 > 0) {
 candleSeries.createPriceLine({
 price: bb.fib_618,
 color: FIB_COLOR,
 lineWidth: 1,
 lineStyle: 2, // Dashed
 axisLabelVisible: true,
 title: bb.in_pocket ? '🎯 Fib 0.618 (Pocket)' : 'Fib 0.618',
 });
 }
 if (bb.fib_786 && bb.fib_786 > 0) {
 candleSeries.createPriceLine({
 price: bb.fib_786,
 color: FIB_COLOR,
 lineWidth: 1,
 lineStyle: 2, // Dashed
 axisLabelVisible: false,
 title: 'Fib 0.786',
 });
 }

 // لو السعر داخل الجيب الذهبي → اطبع badge في الـ title
 if (bb.in_pocket) {
 // console.log removed (Rule 31: no hype in console)
 }
 }

 // 3. Risk Profile (Entry / SL / TP1 / TP2)
 const risk = fusionMetrics.risk;
 if (risk && risk.entry && risk.entry > 0) {
 // TP2 (3.0R) — أعلى هدف
 if (risk.tp2 && risk.tp2 > 0) {
 candleSeries.createPriceLine({
 price: risk.tp2,
 color: TP2_COLOR,
 lineWidth: 1,
 lineStyle: 1, // Dotted
 axisLabelVisible: true,
 title: `🎯 TP2 (3.0R)`,
 });
 }
 // TP1 (1.5R) — الهدف الأول
 if (risk.tp1 && risk.tp1 > 0) {
 candleSeries.createPriceLine({
 price: risk.tp1,
 color: TP1_COLOR,
 lineWidth: 1,
 lineStyle: 1, // Dotted
 axisLabelVisible: true,
 title: `🎯 TP1 (1.5R)`,
 });
 }
 // SL (Stop Loss)
 if (risk.sl && risk.sl > 0) {
 candleSeries.createPriceLine({
 price: risk.sl,
 color: SL_COLOR,
 lineWidth: 2,
 lineStyle: 0, // Solid
 axisLabelVisible: true,
 title: `🛑 SL`,
 });
 }
 }
 }

 // ── Volume pane (pane index 1) ──
 const volumePane = chart.addPane();
 volumePane.setHeight(80);
 const VOLUME_PANE_INDEX = chart.panes().length - 1;

 const volumeSeries = chart.addSeries(
 HistogramSeries,
 {
 priceFormat: { type: 'volume' },
 priceScaleId: 'volume',
 },
 VOLUME_PANE_INDEX
 );

 volumeSeries.priceScale().applyOptions({
 scaleMargins: { top: 0.8, bottom: 0 },
 });

 volumeSeries.setData(formatVolumeData(ohlcv));
 seriesRefs.current.push(volumeSeries);

 // ── Volume 20-day SMA overlay on volume pane ──
 const volumes = ohlcv.map((d) => d.volume);
 const volumeSMA20 = calcEMA(volumes, 20); // use EMA for smoother result
 const volSMASeries = chart.addSeries(
 LineSeries,
 {
 color: '#ffffff90',
 lineWidth: 1,
 title: 'Vol MA 20',
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 },
 VOLUME_PANE_INDEX
 );
 volSMASeries.priceScale().applyOptions({
 scaleMargins: { top: 0.0, bottom: 0.2 },
 });
 volSMASeries.setData(
 volumeSMA20
 .map((v, i) =>
 v !== null ? { time: toTime(ohlcv[i].time), value: v } : null
 )
 .filter(Boolean) as { time: Time; value: number }[]
 );
 seriesRefs.current.push(volSMASeries);

 // ── OBV Line on Volume Pane ──
 if (visibleIndicators.obv) {
 const obvData = calcOBV(ohlcv);
 const obvSeries = chart.addSeries(
 LineSeries,
 {
 color: OBV_COLOR,
 lineWidth: 1,
 title: 'OBV',
 crosshairMarkerVisible: false,
 priceFormat: { type: 'price', precision: 0, minMove: 1 },
 },
 VOLUME_PANE_INDEX
 );
 obvSeries.priceScale().applyOptions({
 scaleMargins: { top: 0.0, bottom: 0.2 },
 });
 obvSeries.setData(
 obvData.map((v, i) => ({ time: toTime(ohlcv[i].time), value: v }))
 );
 seriesRefs.current.push(obvSeries);
 }

 // ── RSI Pane ──
 if (visibleIndicators.rsi && indicators.rsi?.length) {
 const rsiPane = chart.addPane();
 rsiPane.setHeight(60);
 const RSI_PANE_INDEX = chart.panes().length - 1;

 const rsiSeries = chart.addSeries(
 LineSeries,
 {
 color: RSI_COLOR,
 lineWidth: 1,
 title: 'RSI',
 crosshairMarkerVisible: false,
 priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
 },
 RSI_PANE_INDEX
 );

 rsiSeries.priceScale().applyOptions({
 autoScale: false,
 scaleMargins: { top: 0.1, bottom: 0.1 },
 });

 rsiSeries.setData(formatLineData(indicators.rsi));
 seriesRefs.current.push(rsiSeries);

 // Overbought line (70)
 const ob = chart.addSeries(
 LineSeries,
 {
 color: RESISTANCE_COLOR + '80',
 lineWidth: 1,
 lineStyle: LineStyle.Dashed,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 },
 RSI_PANE_INDEX
 );

 ob.priceScale().applyOptions({
 autoScale: false,
 scaleMargins: { top: 0.1, bottom: 0.1 },
 });

 ob.setData(
 indicators.rsi.map((d) => ({ time: toTime(d.time), value: 70 }))
 );
 seriesRefs.current.push(ob);

 // Oversold line (30)
 const os = chart.addSeries(
 LineSeries,
 {
 color: SUPPORT_COLOR + '80',
 lineWidth: 1,
 lineStyle: LineStyle.Dashed,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 },
 RSI_PANE_INDEX
 );

 os.priceScale().applyOptions({
 autoScale: false,
 scaleMargins: { top: 0.1, bottom: 0.1 },
 });

 os.setData(
 indicators.rsi.map((d) => ({ time: toTime(d.time), value: 30 }))
 );
 seriesRefs.current.push(os);
 }

 // ── CMF Pane ──
 if (visibleIndicators.cmf && indicators.cmf?.length) {
 const cmfPane = chart.addPane();
 cmfPane.setHeight(50);
 const CMF_PANE_INDEX = chart.panes().length - 1;

 const cmfSeries = chart.addSeries(
 LineSeries,
 {
 color: CMF_COLOR,
 lineWidth: 1,
 title: 'CMF',
 crosshairMarkerVisible: false,
 priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
 },
 CMF_PANE_INDEX
 );

 cmfSeries.priceScale().applyOptions({
 autoScale: true,
 scaleMargins: { top: 0.1, bottom: 0.1 },
 });

 cmfSeries.setData(formatLineData(indicators.cmf));
 seriesRefs.current.push(cmfSeries);

 // Zero line
 const zeroLine = chart.addSeries(
 LineSeries,
 {
 color: CHART_TEXT + '40',
 lineWidth: 1,
 lineStyle: LineStyle.Dotted,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 },
 CMF_PANE_INDEX
 );

 zeroLine.priceScale().applyOptions({
 autoScale: false,
 scaleMargins: { top: 0.1, bottom: 0.1 },
 });

 zeroLine.setData(
 indicators.cmf.map((d) => ({ time: toTime(d.time), value: 0 }))
 );
 seriesRefs.current.push(zeroLine);
 }

 // ── MACD Pane ──
 if (visibleIndicators.macd) {
 // TOOLKIT-UNIFY-010: prefer backend-provided MACD arrays (unified with
 // maestro) and fall back to client-side calcMACD only when missing.
 const hasBackendMacd =
 Array.isArray(indicators.macd) && indicators.macd!.length > 0;
 let macdLine: (number | null)[];
 let signalLine: (number | null)[];
 let histogram: (number | null)[];
 let macdTimes: string[];

 if (hasBackendMacd) {
 macdTimes = indicators.macd!.map((d) => d.time);
 macdLine = indicators.macd!.map((d) => d.value);
 signalLine = (indicators.macd_signal || []).map((d) => d.value);
 // pad signalLine to macdLine length in case of misalignment
 while (signalLine.length < macdLine.length) signalLine.push(null);
 histogram = (indicators.macd_histogram || []).map((d) => d.value);
 while (histogram.length < macdLine.length) histogram.push(null);
 } else {
 const closes = ohlcv.map((d) => d.close);
 const r = calcMACD(closes);
 macdLine = r.macdLine;
 signalLine = r.signalLine;
 histogram = r.histogram;
 macdTimes = ohlcv.map((d) => d.time);
 }

 const macdPane = chart.addPane();
 macdPane.setHeight(70);
 const MACD_PANE_INDEX = chart.panes().length - 1;

 // MACD Histogram
 const histSeries = chart.addSeries(
 HistogramSeries,
 {
 priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
 priceScaleId: 'macd_hist',
 },
 MACD_PANE_INDEX
 );
 histSeries.priceScale().applyOptions({
 scaleMargins: { top: 0.6, bottom: 0.0 },
 });

 histSeries.setData(
 histogram
 .map((v, i) =>
 v !== null && v !== undefined
 ? {
 time: toTime(macdTimes[i]),
 value: v,
 color: v >= 0 ? MACD_HIST_POS + '80' : MACD_HIST_NEG + '80',
 }
 : null
 )
 .filter(Boolean) as {
 time: Time;
 value: number;
 color: string;
 }[]
 );
 seriesRefs.current.push(histSeries);

 // MACD Line
 const macdLineSeries = chart.addSeries(
 LineSeries,
 {
 color: MACD_LINE_COLOR,
 lineWidth: 1,
 title: 'MACD',
 crosshairMarkerVisible: false,
 priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
 },
 MACD_PANE_INDEX
 );
 macdLineSeries.priceScale().applyOptions({
 scaleMargins: { top: 0.0, bottom: 0.4 },
 });
 macdLineSeries.setData(
 macdLine
 .map((v, i) =>
 v !== null && v !== undefined
 ? { time: toTime(macdTimes[i]), value: v }
 : null
 )
 .filter(Boolean) as { time: Time; value: number }[]
 );
 seriesRefs.current.push(macdLineSeries);

 // Signal Line
 const signalLineSeries = chart.addSeries(
 LineSeries,
 {
 color: MACD_SIGNAL_COLOR,
 lineWidth: 1,
 title: 'Signal',
 crosshairMarkerVisible: false,
 priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
 },
 MACD_PANE_INDEX
 );
 signalLineSeries.priceScale().applyOptions({
 scaleMargins: { top: 0.0, bottom: 0.4 },
 });
 signalLineSeries.setData(
 signalLine
 .map((v, i) =>
 v !== null && v !== undefined
 ? { time: toTime(macdTimes[i]), value: v }
 : null
 )
 .filter(Boolean) as { time: Time; value: number }[]
 );
 seriesRefs.current.push(signalLineSeries);

 // Zero line for MACD
 const firstMacdTime = macdLine.findIndex((v) => v !== null);
 if (firstMacdTime !== -1 && macdTimes.length > 0) {
 const lastMacdTime = macdTimes[macdTimes.length - 1];
 const zeroLineMacd = chart.addSeries(
 LineSeries,
 {
 color: CHART_TEXT + '30',
 lineWidth: 1,
 lineStyle: LineStyle.Dotted,
 crosshairMarkerVisible: false,
 lastValueVisible: false,
 priceLineVisible: false,
 },
 MACD_PANE_INDEX
 );
 zeroLineMacd.priceScale().applyOptions({
 autoScale: false,
 scaleMargins: { top: 0.0, bottom: 0.4 },
 });
 zeroLineMacd.setData([
 { time: toTime(macdTimes[firstMacdTime]), value: 0 },
 { time: toTime(lastMacdTime), value: 0 },
 ]);
 seriesRefs.current.push(zeroLineMacd);
 }
 }

 // CHART-V2-044: MACD Projection (LinReg — مرآة المستقبل)
 if (macdProjection && macdProjection.length > 0 && indicators.macd) {
 try {
 const projTimes = indicators.macd.map((d) => d.time);
 const projData: Array<{ time: Time; value: number }> = [];
 const startIdx = Math.max(0, projTimes.length - macdProjection.length);
 for (let i = 0; i < macdProjection.length; i++) {
 const val = macdProjection[i];
 const timeIdx = startIdx + i;
 if (val !== null && val !== undefined && timeIdx < projTimes.length) {
 projData.push({ time: toTime(projTimes[timeIdx]), value: val });
 }
 }
 if (projData.length > 0) {
 const projSeries = chart.addSeries(
 LineSeries,
 {
 color: '#e040fb', // Fuchsia/Purple
 lineWidth: 2,
 lineStyle: LineStyle.Dashed,
 title: '🔮 Projection',
 crosshairMarkerVisible: true,
 priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
 },
 MACD_PANE_INDEX
 );
 projSeries.priceScale().applyOptions({
 scaleMargins: { top: 0.0, bottom: 0.4 },
 });
 projSeries.setData(projData);
 seriesRefs.current.push(projSeries);
 }
 } catch {}
 }

 // CHART-V2-044: CMF Line (تدفق المؤسسات)
 if (cmfData && cmfData.length > 0) {
 try {
 const MACD_PANE_INDEX = 1; // Sub-pane (same as MACD)
 const cmfSeries = chart.addSeries(
 LineSeries,
 {
 color: '#facc15', // Yellow
 lineWidth: 2,
 title: 'CMF',
 crosshairMarkerVisible: true,
 priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
 },
 MACD_PANE_INDEX
 );
 cmfSeries.priceScale().applyOptions({
 scaleMargins: { top: 0.6, bottom: 0.0 },
 });
 cmfSeries.setData(
 cmfData
 .filter((d) => d.value !== null && d.value !== undefined)
 .map((d) => ({ time: toTime(d.time), value: d.value }))
 );
 seriesRefs.current.push(cmfSeries);
 } catch {}
 }

 // CHART-V2-044: Smart Markers (broke_r1, smart_money_in, news_confirmed, vol_spike)
 if (smartMarkers && smartMarkers.length > 0 && ohlcv.length > 0) {
 try {
 const markers = smartMarkers.map((m) => ({
 time: toTime(m.time),
 position: m.position === 'aboveBar' ? 'aboveBar' as const : 'belowBar' as const,
 color: m.color,
 shape: m.shape === 'arrowUp' ? 'arrowUp' as const : 'circle' as const,
 text: m.text,
 }));
 createSeriesMarkers(candleSeriesRef.current || candleSeries, markers);
 } catch {}
 }

 // ── SMART-CHART: Fit content بس لما السياق يتغير (مش مع كل تحديث للبيانات) ──
 // fitKey = أول تاريخ + آخر تاريخ + bucket للطول (عشان نتجنب reset مع كل شمعة جديدة)
 // لو الـ fitKey نفسه → المستخدم عمل zoom/pan وعلمنا نحافظ على view بتاعه
 const firstTime = ohlcv[0]?.time ?? '';
 const lastTime = ohlcv[ohlcv.length - 1]?.time ?? '';
 const lengthBucket = Math.floor(ohlcv.length / 10) * 10;
 const fitKey = `${firstTime}|${lastTime}|${lengthBucket}`;
 if (lastFitKeyRef.current !== fitKey) {
 chart.timeScale().fitContent();
 lastFitKeyRef.current = fitKey;
 }

 // ── Cleanup ──
 return () => {
 try {
 chart.remove();
 } catch {
 // Already disposed
 }
 chartRef.current = null;
 seriesRefs.current = [];
 };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [ohlcv, indicators, visibleIndicators, levels, regimeColor, targetPrice, stopLossPrice, bbSqueezeLevel, bosEvents, fusionMetrics]);

 // STRATEGY-041: Live candle update — حدّث شمعة النهارده بالسعر اللحظي
 useEffect(() => {
 if (!livePrice || livePrice <= 0) return;
 if (!candleSeriesRef.current || ohlcv.length === 0) return;

 const lastCandle = ohlcv[ohlcv.length - 1];
 const lastTime = toTime(lastCandle.time);

 // حدّث شمعة النهارده: close = livePrice, high = max(high, live), low = min(low, live)
 const updatedCandle = {
 time: lastTime,
 open: lastCandle.open,
 high: Math.max(lastCandle.high, livePrice),
 low: Math.min(lastCandle.low, livePrice),
 close: livePrice,
 };

 try {
 candleSeriesRef.current.update(updatedCandle as any);
 } catch {
 // silent — لو الـ time مش متطابق بالظبط
 }
 }, [livePrice, ohlcv]);

 // ── Responsive resize ──
 useEffect(() => {
 const container = containerRef.current;
 const chart = chartRef.current;
 if (!container || !chart) return;

 const handleResize = () => {
 const w = container.clientWidth;
 const h = container.clientHeight;
 if (w > 0 && h > 0) {
 chart.applyOptions({ width: w, height: h });
 }
 };

 const observer = new ResizeObserver(handleResize);
 observer.observe(container);

 // Also listen to window resize as a fallback
 window.addEventListener('resize', handleResize);

 return () => {
 observer.disconnect();
 window.removeEventListener('resize', handleResize);
 };
 }, [ohlcv]);

 // ── Empty state ──
 if (!ohlcv || ohlcv.length === 0) {
 return (
 <div
 className="flex items-center justify-center w-full h-full rounded-lg"
 style={{
 backgroundColor: regimeTheme?.background || CHART_BG,
 minHeight: 500,
 }}
 >
 <div className="flex flex-col items-center gap-2 opacity-50">
 <svg
 width="48"
 height="48"
 viewBox="0 0 24 24"
 fill="none"
 stroke={CHART_TEXT}
 strokeWidth="1.5"
 strokeLinecap="round"
 strokeLinejoin="round"
 >
 <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
 </svg>
 <span style={{ color: CHART_TEXT, fontSize: 14 }}>
 No data available
 </span>
 </div>
 </div>
 );
 }

 // ── Format large numbers ──
 function fmtNum(n: number, decimals = 2) {
 return n.toLocaleString(undefined, {
 minimumFractionDigits: decimals,
 maximumFractionDigits: decimals,
 });
 }
 function fmtVol(n: number) {
 if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
 if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
 if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
 return (n ?? 0).toFixed(0);
 }

 // ── ALPHA-CHART-MERGE-1: Professional sections derived state ──
 // signal/score/entry/stop/target/R:R come ONLY from canonical (single source of truth)
 const signalFinal = canonical?.signal || '';
 const signalAr = canonical?.signal_ar || signalToArabic(signalFinal);
 const techScore = canonical?.tech_score ?? null;
 const entry = canonical?.entry_price ?? null;
 const stop = canonical?.stop_loss ?? null;
 const target1 = canonical?.target_price ?? null;
 const target2 = canonical?.target_price_2 ?? null;
 const rr = canonical?.risk_reward ?? null;
 // Buy-signal gate: trade plan + entry/stop/target numbers only render for BUY signals.
 const isBuySignal = Boolean(
 signalFinal && (
 signalFinal.toUpperCase().includes('BUY') ||
 signalFinal.toUpperCase().includes('ACCUMULATE')
 )
 );

 // §2 Regime badge + market warning (only when flight/maker state is provided)
 const regimeBadge = (() => {
 if (flightState?.state === 'falling_down' || makerState?.state === 'distribution') {
 return { label: '🛑 سكين ساقطة وانهيار هيكلي', color: 'text-loss', bg: 'bg-loss/10', border: 'border-loss' };
 }
 if (flightState?.state === 'taking_off') {
 return { label: '🟢 مسار صاعد صحي', color: 'text-profit', bg: 'bg-profit/10', border: 'border-profit' };
 }
 if (makerState?.state === 'accumulation') {
 return { label: '🟠 تذبذب عرضي ونطاق ضيق', color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning' };
 }
 return null;
 })();
 const hasMarketWarning =
 makerState?.state === 'distribution' ||
 flightState?.state === 'falling_down' ||
 (techScore !== null && techScore < 40);

 // Decide whether to render the outer wrapper as `space-y-3` (sections visible)
 // or keep the original `relative w-full h-full` (props-only mode → preserves
 // SingleStockAnalysisView layout that depends on the chart filling the parent).
 const anySectionVisible = Boolean(
 (canonical && showDecisionHeader) ||
 regimeBadge ||
 hasMarketWarning ||
 (isBuySignal && showTradePlan) ||
 showReasons ||
 showTechnicalDetails ||
 showRescueCTA
 );

 const chartBlock = (
 <div className="relative w-full h-full">
 {/* Regime Badge */}
 {regimeLabel && regimeColor && (
 <div
 className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md text-xs font-bold shadow-lg select-none"
 style={{
 backgroundColor: regimeColor + '20',
 color: regimeColor,
 border: `1.5px solid ${regimeColor}60`,
 backdropFilter: 'blur(8px)',
 }}
 >
 {regimeLabel}
 </div>
 )}

 {/* Info Overlay Panel */}
 {infoOverlay && (
 <div
 className="absolute top-3 z-10 rounded-md px-3 py-2.5 select-none pointer-events-none"
 style={{
 left: '12px',
 right: 'auto',
 backgroundColor: 'rgba(19, 23, 34, 0.85)',
 backdropFilter: 'blur(12px)',
 border: `1px solid ${CHART_GRID}`,
 color: CHART_TEXT,
 fontFamily:
 "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
 fontSize: 11,
 lineHeight: '16px',
 }}
 >
 <div
 className="text-center font-semibold mb-1.5 pb-1.5"
 style={{
 fontSize: 11,
 borderBottom: `1px solid ${CHART_GRID}`,
 color: '#a3a8b8',
 }}
 >
 {fmtDateLabel(infoOverlay.date)}
 </div>
 <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: 'auto auto' }}>
 <span style={{ color: '#787b86' }}>O</span>
 <span className="font-mono text-right">{fmtNum(infoOverlay.o)}</span>
 <span style={{ color: '#787b86' }}>H</span>
 <span className="font-mono text-right">{fmtNum(infoOverlay.h)}</span>
 <span style={{ color: '#787b86' }}>L</span>
 <span className="font-mono text-right">{fmtNum(infoOverlay.l)}</span>
 <span style={{ color: '#787b86' }}>C</span>
 <span
 className="font-mono text-right font-semibold"
 style={{
 color:
 infoOverlay.change >= 0 ? UP_COLOR : DOWN_COLOR,
 }}
 >
 {fmtNum(infoOverlay.c)}
 </span>
 <span style={{ color: '#787b86' }}>Vol</span>
 <span className="font-mono text-right">{fmtVol(infoOverlay.volume)}</span>
 <span style={{ color: '#787b86' }}>Chg</span>
 <span
 className="font-mono text-right font-semibold"
 style={{
 color:
 infoOverlay.change >= 0 ? UP_COLOR : DOWN_COLOR,
 }}
 >
 {infoOverlay.change >= 0 ? '+' : ''}
 {(infoOverlay.change ?? 0).toFixed(2)}%
 </span>
 </div>
 </div>
 )}

 <div
 ref={containerRef}
 className="w-full h-full rounded-lg overflow-hidden min-h-[300px] md:min-h-[500px]"
 style={{
 backgroundColor: regimeTheme?.background || CHART_BG,
 }}
 />
 </div>
 );

 // ── Props-only mode (SingleStockAnalysisView): keep the original layout ──
 if (!anySectionVisible) {
 return chartBlock;
 }

 // ── Professional mode (TradingChartView): wrap with sections ──
 return (
 <div className="space-y-3" dir="rtl">
 {/* ════════════════════════════════════════════════════════════════════════
 §1 — Decision Header (signal + entry/stop/target/R:R/techScore)
 First thing the eye sees. Only renders when canonical + showDecisionHeader.
 ════════════════════════════════════════════════════════════════════════ */}
 {canonical && showDecisionHeader && (
 <div className="px-4 py-3 border-b border-border to-card rounded-t-xl">
 <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
 {/* Right: ticker name + signal */}
 <div className="flex items-center gap-3 flex-wrap">
 {tickerName && (
 <div className="min-w-0">
 <div className="text-sm md:text-base font-black text-foreground truncate max-w-[220px]">
 {tickerName}
 </div>
 </div>
 )}
 <Badge
 className={cn(
 'text-sm font-bold px-3 py-1.5 rounded-lg border-2 shadow-sm',
 signalFinal?.includes('SELL') || signalFinal?.includes('AVOID') || signalFinal?.includes('KILL')
 ? 'bg-loss/10 text-loss border-loss'
 : signalFinal?.includes('BUY')
 ? 'bg-profit/10 text-profit border-profit'
 : 'bg-warning/10 text-warning border-warning'
 )}
 >
 {signalFinal?.includes('SELL') || signalFinal?.includes('AVOID') || signalFinal?.includes('KILL')
 ? <TrendingDown className="w-4 h-4 ml-1" />
 : signalFinal?.includes('BUY')
 ? <TrendingUp className="w-4 h-4 ml-1" />
 : <Minus className="w-4 h-4 ml-1" />}
 {signalAr || '— بيانات غير متاحة'}
 </Badge>
 </div>

 {/* Middle: entry/stop/target/R:R/techScore (BUY signals only) */}
 {isBuySignal ? (
 <div className="flex items-center gap-2 text-xs flex-wrap">
 {entry !== null && entry !== undefined && entry > 0 && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">الدخول</span>
 <span className="font-mono font-bold text-foreground">{(entry ?? 0).toFixed(2)}</span>
 </div>
 )}
 {stop !== null && stop !== undefined && stop > 0 && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">الوقف</span>
 <span className="font-mono font-bold text-loss">{(stop ?? 0).toFixed(2)}</span>
 </div>
 )}
 {target1 !== null && target1 !== undefined && target1 > 0 && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">الهدف</span>
 <span className="font-mono font-bold text-profit">{(target1 ?? 0).toFixed(2)}</span>
 </div>
 )}
 {rr !== null && rr !== undefined && rr > 0 && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">R:R</span>
 <span className="font-mono font-bold text-foreground">{(rr ?? 0).toFixed(2)}</span>
 </div>
 )}
 {techScore !== null && techScore !== undefined && (
 <div className="flex flex-col items-center">
 <span className="text-xs text-muted-foreground">الثقة</span>
 <span className="font-mono font-bold text-foreground">{(techScore ?? 0).toFixed(0)}%</span>
 </div>
 )}
 </div>
 ) : (
 <div className="p-2 rounded-xl border border-border bg-muted/40 text-xs text-muted-foreground flex items-center gap-2">
 <ShieldAlert className="w-4 h-4 text-warning shrink-0" />
 <span>لا توجد صفقة شراء مفعلة لهذا السهم حالياً</span>
 </div>
 )}
 </div>

 {/* Wait/reject reason (single line) */}
 {(signalFinal === 'HOLD' || signalFinal === 'WAIT' || signalFinal?.includes('KILL') || signalFinal?.includes('AVOID')) && (
 <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
 <AlertTriangle className="w-3 h-3 text-warning" />
 <span>
 {decisionData?.path_taken || decisionData?.adjustment_reason || 'السهم في مرحلة انتظار — راجع التفاصيل بالأسفل'}
 </span>
 </div>
 )}
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════════
 §2 — Regime badge + Market warning
 ════════════════════════════════════════════════════════════════════════ */}
 {regimeBadge && (
 <div className={cn('px-4 py-1.5 border-b text-xs flex items-center gap-2 rounded-md', regimeBadge.bg, regimeBadge.border)}>
 <span className={cn('font-bold', regimeBadge.color)}>{regimeBadge.label}</span>
 </div>
 )}
 {hasMarketWarning && (
 <div className="px-4 py-1.5 bg-loss/20 border border-loss text-xs text-loss flex items-center gap-2 rounded-md">
 <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
 <span className="font-semibold">
 {makerState?.state === 'distribution' && '🔴 تصريف مؤسسي — احذر'}
 {flightState?.state === 'falling_down' && '🩸 سكين هابط — تجنّب'}
 {techScore !== null && techScore < 40 && '⚠️ درجة فنية ضعيفة'}
 </span>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════════
 §3 — The actual chart (preserved exactly as the original return)
 ════════════════════════════════════════════════════════════════════════ */}
 {chartBlock}

 {/* ════════════════════════════════════════════════════════════════════════
 §4 — Trade Plan (BUY signals only)
 Entry / Stop / TP1 / TP2 + R:R + position size
 ════════════════════════════════════════════════════════════════════════ */}
 {isBuySignal && showTradePlan && (entry !== null || target1 !== null || stop !== null) && (
 <div className="px-4 py-3 border-t border-border rounded-xl border border-border bg-card">
 <div className="rounded-xl border border-border bg-muted/30 p-3">
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-1.5">
 <Target className="w-4 h-4 text-profit" />
 <span className="text-xs font-bold">خطة الصفقة</span>
 </div>
 {rr !== null && rr !== undefined && rr > 0 && (
 <Badge variant="outline" className="text-xs font-mono">
 R:R 1:{(rr ?? 0).toFixed(2)}
 </Badge>
 )}
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 <PlanLevel label="الدخول" value={entry} currencyLabel={currencyLabel || 'ج.م'} color="text-foreground" />
 <PlanLevel label="الوقف" value={stop} currencyLabel={currencyLabel || 'ج.م'} color="text-loss" />
 <PlanLevel label="الهدف 1" value={target1} currencyLabel={currencyLabel || 'ج.م'} color="text-profit" />
 <PlanLevel label="الهدف 2" value={target2} currencyLabel={currencyLabel || 'ج.م'} color="text-profit" />
 </div>
 {suggestedPositionSizePct && (
 <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
 <Wallet className="w-3 h-3" />
 حجم المحفظة المقترح: <strong className="font-mono text-profit">{suggestedPositionSizePct}%</strong>
 {analysisText && (
 <span className="text-muted-foreground mr-2">• {analysisText.slice(0, 80)}</span>
 )}
 </div>
 )}
 </div>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════════
 §5 — Reasons for the decision (5 cards)
 Trend / Relative strength / Liquidity / Accumulation / Price position
 ════════════════════════════════════════════════════════════════════════ */}
 {showReasons && (
 <div className="px-4 py-3 border-t border-border rounded-xl border border-border bg-card">
 <div className="text-xs font-bold mb-2 flex items-center gap-1">
 <Activity className="w-3.5 h-3.5 text-profit" />
 أسباب القرار
 </div>
 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
 <ReasonCard
 label="الاتجاه"
 value={flightState?.state ? (flightState.state === 'taking_off' ? 'صاعد' : flightState.state === 'falling_down' ? 'هابط' : 'عرضي') : '—'}
 positive={flightState?.state === 'taking_off'}
 negative={flightState?.state === 'falling_down'}
 />
 <ReasonCard
 label="القوة النسبية"
 value={confluence?.breakdown?.trend?.detail || '—'}
 positive={confluence?.breakdown?.trend?.passed}
 negative={!confluence?.breakdown?.trend?.passed && confluence?.breakdown?.trend !== undefined}
 />
 <ReasonCard
 label="السيولة"
 value={makerState?.state === 'accumulation' ? 'جيدة' : makerState?.state === 'distribution' ? 'ضعيفة' : 'متوازنة'}
 positive={makerState?.state === 'accumulation'}
 negative={makerState?.state === 'distribution'}
 />
 <ReasonCard
 label="التجميع"
 value={makerState?.state === 'accumulation' ? 'موجود' : 'غير موجود'}
 positive={makerState?.state === 'accumulation'}
 />
 <ReasonCard
 label="موقع السعر"
 value={stockDna?.typical_range?.current_position || '—'}
 positive={stockDna?.typical_range?.current_position?.includes('قرب دعم')}
 negative={stockDna?.typical_range?.current_position?.includes('قرب مقاومة')}
 />
 </div>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════════
 §6 — Collapsible Technical Details (collapsed by default)
 RSI / MACD / ATR / TechScore + SMC analysis
 ════════════════════════════════════════════════════════════════════════ */}
 {showTechnicalDetails && (
 <CollapsibleSection
 currentIndicators={currentIndicators}
 techScore={techScore}
 smcAnalysis={smcAnalysis}
 />
 )}

 {/* ════════════════════════════════════════════════════════════════════════
 §7 — Rescue Clinic CTA
 ════════════════════════════════════════════════════════════════════════ */}
 {showRescueCTA && tickerName && (
 <a
 href={`/rescue?ticker=${encodeURIComponent(tickerName)}`}
 className="block p-4 rounded-xl border border-border to-transparent hover:transition-all group"
 >
 <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 <span className="text-xl">🚑</span>
 <div>
 <p className="text-sm font-bold text-foreground">هل أنت عالق في هذا السهم بخسارة؟</p>
 <p className="text-xs text-muted-foreground">افتح عيادة الإنقاذ المالي للتشخيص وخطة التعافي</p>
 </div>
 </div>
 <span className="text-xs font-semibold text-primary group-hover:translate-x-[-4px] transition-transform">
 ←
 </span>
 </div>
 </a>
 )}
 </div>
 );
}

// ─── ALPHA-CHART-MERGE-1: Helper components for the professional sections ──────

