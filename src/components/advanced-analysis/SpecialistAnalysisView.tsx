'use client';

/**
 * SpecialistAnalysisView — التقرير المالي الاحترافي العميق لسهم واحد
 * =====================================================================
 * Task 44-A (2026-10-05) — COMPLETE REBUILD with REAL DATA
 *
 * Owner directive:
 *   «البيانات الى فيها لا تساوى نص البيانات الموجودة فى صفحة تفاصيل السهم.
 *    لايوجد اى بيانات عن الزخم أو حركة المؤسسات والتحركات بتاعت السعر والمتواقع
 *    وكل البيانات فى صفحة رادار السيولة. التقرير شكلة زبالة جدا»
 *
 * Root cause (Rule 67):
 *   النسخة السابقة كانت بتجيب من comprehensive كـ PRIMARY — و comprehensive
 *   بترجع { basic: [], price: [], predictions: [] } فاضية لما الـ Python 8010
 *   يكون مطفي. النتيجة: كل البيانات بتطلع "—" والتقرير شكله زبالة.
 *
 * Fix (Task 44-A):
 *   1. PRIMARY = /api/maker-radar/stock?ticker=X  → 60-field stock_info + 30-day OHLCV
 *      (بيقرأ من stocks.db — بيشتغل حتى لما Python مطفي).
 *   2. SECONDARY = /api/maker-radar/footprint?ticker=X&days=30  → POC/VAH/VAL + 18 levels
 *   3. TERTIARY = /api/predictions?ticker=X&limit=10  → predictions.db direct
 *   4. ENRICHMENT (graceful degrade — Promise.allSettled):
 *        - /api/flow/X              (قد تكون فاضية — Python مطفي)
 *        - /api/explosive/X         (قد تكون فاضية — Python مطفي)
 *        - /api/stocks/X/comprehensive  (قد تكون فاضية — Python مطفي)
 *        - /api/sharia?symbol=X     (قد تكون فاضية)
 *        - /api/stocks/X            (للأيقونة)
 *
 * 16 sections (professional financial report):
 *   §1  Header Card (icon + ticker + name + sector + price + change + trend + sharia)
 *   §2  Price Summary (8 tiles from stock_info)
 *   §3  30-Day Candlestick Chart (SVG from radarData.prices — BEAUTIFUL)
 *   §4  Liquidity Footprint (POC + VAH/VAL + Buy/Sell + 18-level profile)
 *   §5  Technical Indicators (RSI gauge + MA50/MA200 + Support/Resistance + Signal)
 *   §6  Fundamentals (P/E + P/B + EPS + ROE + ROA + Debt/Equity + DivYield + Margin)
 *   §7  Momentum Stats (ROC 10d + avg vol + avg turnover + 20d range)
 *   §8  Prediction History (table from predictions.db — Rule 67 accuracy gating)
 *   §9  Recommendation (signal + entry zone + target + stop + R:R + position size)
 *   §10 52-Week Analysis (visual bar showing current position)
 *   §11 Flow + Explosive (graceful degrade — may show t('specialist.k_146'))
 *   §12 Comprehensive Analysis (maestro/hunter/board/news — graceful degrade)
 *   §13 Position Sizing Calculator (interactive — capital × risk% / per-share risk)
 *   §14 Price Levels Ladder (52w high → resistance → current → support → 52w low)
 *   §15 Score Dashboard (fundamental_score + smc_score + signal — progress bars)
 *   §16 Disclaimer (تعليمي فقط — ليست توصية استثمارية)
 *
 * Rules honored:
 *   Rule 4  — edited existing SpecialistAnalysisView.tsx, NO new files.
 *   Rule 20 — Node.js = display only. All numbers come from real DB/API responses.
 *   Rule 30 — emerald (positive) / amber (warning) / red (negative) / slate (neutral).
 *             Background: white (light) / slate-950 (dark). NO indigo/blue primary.
 *   Rule 63 — commit + push after each task.
 *   Rule 67 — PRIMARY = maker-radar/stock (always-available data). Missing fields → "—".
 *             NEVER fabricate numbers. Accuracy stat only if ≥5 closed predictions.
 *   Rule 68 — verification block in worklog (lint + tsc + grep + curl + browser).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Target, Shield, AlertTriangle,
  CheckCircle, Loader2, RefreshCw, BarChart3,
  Activity, Calculator, LineChart,
  Share2, MessageCircle, Facebook, Send, Download,
  ArrowUpRight, ArrowDownRight,
  Crosshair, Trophy, Radar, Newspaper, BookOpen, Wallet, Gauge, Percent,
  Droplets, Flame, Building2, Layers, TrendingUp, TrendingDown, Banknote,
} from 'lucide-react';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
// ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────────────
// قبل كده: كان فيه labels t('specialist.k_147') بـ thresholds 1.2/0.8
// غير موجودة في canonical → نتائج متضاربة مع الرادار + تفاصيل السهم.
// الحل: استيراد classifyAccumulation من canonical-signal.ts
import { classifyAccumulation } from '@/lib/canonical-signal';
import { StockPublisher } from '@/modules/publishing/components/StockPublisher';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';
import { useTranslation } from '@/lib/i18n-context';

// ============================================================================
// TYPES — Rule 67: every field optional because engines may fail independently.
// ============================================================================

interface StockInfo {
  ticker?: string;
  name?: string;
  name_ar?: string;
  sector?: string;
  industry?: string;
  market?: string;
  exchange?: string;
  currency?: string;
  current_price?: number;
  change?: number;
  change_percent?: number;
  change_value?: number;
  close?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  previous_close?: number;
  volume?: number;
  turnover_egp?: number;
  value_traded?: number;
  avg_volume?: number;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  ps_ratio?: number;
  eps?: number;
  roe?: number;
  roa?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  book_value_per_share?: number;
  dividend_yield?: number;
  dps_ttm?: number;
  profit_margin?: number;
  free_float_percentage?: number;
  free_float_shares?: number;
  beta?: number;
  high_52w?: number;
  low_52w?: number;
  ma_50?: number;
  ma_200?: number;
  rsi?: number;
  support?: number;
  resistance?: number;
  signal?: number | string;
  smc_signal?: number | string;
  trend?: string;
  fundamental_score?: number;
  smc_score?: number;
  is_egx30?: number | boolean;
  is_egx70?: number | boolean;
  is_egx100?: number | boolean;
  is_egx?: number | boolean;
  is_suspended?: number | boolean;
  is_active?: number | boolean;
  [k: string]: unknown;
}

interface PriceRow {
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  turnover?: number;
}

interface RadarStats {
  lastClose?: number;
  changePct?: number;
  roc10d?: number;
  avgVolume20?: number;
  avgTurnover20?: number;
  max20?: number;
  min20?: number;
  range20Pct?: number;
  dataPoints?: number;
  [k: string]: unknown;
}

interface MakerRadarStock {
  success: boolean;
  ticker?: string;
  stock_info?: StockInfo | null;
  prices?: PriceRow[];
  stats?: RadarStats;
  tracking?: Record<string, unknown> | null;
  prediction?: Record<string, unknown> | null;
  db_source?: string;
  error?: string;
}

interface FootprintLevel {
  price_low: number;
  price_high: number;
  price_mid: number;
  volume: number;
  buy_volume: number;
  sell_volume: number;
  delta: number;
  volume_pct: number;
  is_poc: boolean;
  is_value_area: boolean;
}

interface FootprintData {
  success: boolean;
  ticker?: string;
  days?: number;
  bin_count?: number;
  price_min?: number;
  price_max?: number;
  poc_price?: number;
  poc_volume?: number;
  vah_price?: number;
  val_price?: number;
  value_area_volume_pct?: number;
  total_volume?: number;
  buy_volume?: number;
  sell_volume?: number;
  delta_volume?: number;
  buy_sell_ratio?: number;
  levels?: FootprintLevel[];
  computed_at?: string;
  error?: string;
}

interface PredictionRow {
  id?: number;
  ticker?: string;
  signal?: string;
  signal_type?: string;
  prediction_date?: string;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  master_score?: number;
  technical_score?: number;
  fundamental_score?: number;
  confidence?: number;
  persona?: string;
  market?: string;
  outcome_date?: string | null;
  exit_price?: number | null;
  actual_return?: number | null;
  hit_target?: number | boolean;
  hit_stop?: number | boolean;
  is_correct?: number | boolean | null;
  holding_days?: number;
  status?: string;
  risk_reward?: number;
  risk_reward_ratio?: number;
  created_at?: string;
  analysis_json?: string;
}

interface PredictionsResponse {
  success: boolean;
  authenticated?: boolean;
  limited?: boolean;
  ticker?: string;
  data?: PredictionRow[];
  stats?: {
    total: number;
    closedCount?: number;
    hits?: number;
    accuracy?: number | null;
    avgScore?: number;
  };
  source?: string;
  error?: string;
}

interface FlowData {
  success: boolean;
  ticker?: string;
  flow?: {
    flow_score?: number;
    label?: string;
    color?: string;
    macro_flow?: string;
    sector_flow?: string;
    stock_flow?: string;
    cross_validation?: string;
    buy_pressure?: number;
    sell_pressure?: number;
    net_flow?: number;
    [k: string]: unknown;
  } | null;
  data?: Record<string, unknown> | null;
  source?: string;
  message?: string;
  error?: string;
}

interface ExplosiveData {
  success: boolean;
  ticker?: string;
  explosive?: {
    explosive_score?: number;
    label?: string;
    pattern?: string;
    color?: string;
    action?: string;
    stop_loss?: number;
    target?: number;
    volume_ratio?: number;
    range_10d_pct?: number;
    excluded?: boolean;
    [k: string]: unknown;
  } | null;
  data?: Record<string, unknown> | null;
  source?: string;
  message?: string;
  error?: string;
}

interface ComprehensiveData {
  success: boolean;
  ticker: string;
  market: string;
  timestamp: string;
  basic?: Record<string, unknown>;
  price?: Record<string, unknown>;
  keyMetrics?: Record<string, unknown>;
  technical?: Record<string, unknown>;
  priceHistory?: Array<Record<string, unknown>>;
  maestro?: Record<string, unknown>;
  hunter?: Record<string, unknown>;
  board?: Record<string, unknown>;
  news?: Array<Record<string, unknown>>;
  predictions?: Array<Record<string, unknown>>;
  professional?: Record<string, unknown>;
  errors: string[];
  elapsed_ms: number;
}

interface ShariaResponse {
  success: boolean;
  symbol?: string;
  metric?: Record<string, unknown>;
  sources?: Array<Record<string, unknown>>;
  purification_rates?: Array<Record<string, unknown>>;
  price?: Record<string, unknown> | null;
  generated_at?: string;
  error?: string;
}

interface SingleStockData {
  success?: boolean;
  ticker?: string;
  name?: string;
  name_ar?: string;
  icon_url?: string;
  logo_url?: string;
  image?: string;
  sector?: string;
  industry?: string;
  market?: string;
  [k: string]: unknown;
}

// ============================================================================
// Safe accessors — Rule 67: never fabricate. Missing → null → "—".
// ============================================================================

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

function safeStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function fmtNum(v: unknown, digits = 2): string {
  const n = safeNum(v);
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function fmtPct(v: unknown, digits = 1): string {
  const n = safeNum(v);
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function fmtInt(v: unknown): string {
  const n = safeNum(v);
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

// Compact volume/money formatter: 1.2K / 3.4M / 5.6B (Rule 67 — real number, no fabrication).
function fmtCompact(v: unknown, suffix = ''): string {
  const n = safeNum(v);
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B${suffix}`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M${suffix}`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K${suffix}`;
  return `${n.toFixed(2)}${suffix}`;
}

// ============================================================================
// Sub-components — small reusable visual primitives
// ============================================================================

function MetricRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs sm:text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

function PriceTile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="text-center p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700">
      <p className="text-[10px] sm:text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm sm:text-base font-bold mt-1 ${color ?? 'text-slate-700 dark:text-slate-200'}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  accent: 'emerald' | 'amber' | 'red' | 'slate';
  children: React.ReactNode;
}) {
  const accentMap = {
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60',
    red: 'text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/60',
    slate: 'text-slate-600 bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700',
  } as const;
  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md border ${accentMap[accent]}`}>
            {icon}
          </span>
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="h-4 w-1/3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          <div className="h-8 w-2/3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-center">
      <p className="text-xs text-muted-foreground italic">{msg}</p>
    </div>
  );
}

// ─── StockIcon — image with colored-circle fallback (per owner: «حتى الايقونة مش موجودة») ───

function StockIcon({
  symbol,
  iconUrl,
  size = 'md',
}: {
  symbol: string;
  iconUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeMap = {
    sm: 'w-9 h-9 text-sm',
    md: 'w-11 h-11 sm:w-12 sm:h-12 text-base',
    lg: 'w-16 h-16 sm:w-20 sm:h-20 text-xl',
  };
  const cls = sizeMap[size];
  const initials = (symbol || '?').slice(0, 2).toUpperCase();

  // Stable color derived from the ticker — same ticker → same color.
  const palette = [
    'from-emerald-500 to-emerald-700',
    'from-amber-500 to-amber-700',
    'from-rose-500 to-rose-700',
    'from-teal-500 to-teal-700',
    'from-orange-500 to-orange-700',
    'from-lime-500 to-lime-700',
  ];
  const colorIdx = (symbol || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % palette.length;
  const gradient = palette[colorIdx];

  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt={symbol}
        className={`${cls} rounded-xl object-cover border-2 border-slate-200 dark:border-slate-700 shadow-sm bg-white`}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        onError={(e) => {
          // Hide broken image so the fallback below shows instead.
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div
      className={`${cls} rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold border-2 border-white/20 dark:border-slate-700 shadow-sm`}
      aria-label={`${symbol} icon`}
    >
      {initials}
    </div>
  );
}

// ============================================================================
// §3 — Candlestick Chart (BEAUTIFUL SVG from radarData.prices — 30 days)
// Rule 67: NO fabricated prices. Candles come from real OHLCV in stocks.db.
// ============================================================================

function CandlestickChart({
  prices,
  support,
  resistance,
  ma50,
  ma200,
  ticker,
  market = 'EGX',
}: {
  prices: PriceRow[];
  support?: number | null;
  resistance?: number | null;
  ma50?: number | null;
  ma200?: number | null;
  ticker?: string;
  market?: string;
}) {  const t = useTranslation();

  // CHART-REBUILD-FIX (2026-10-10): استبدال الـ SVG اليدوي البدائي بـ TradingView widget.
  // قبل كده: handmade SVG بياخد آخر 30 شمعة + ينهار لو prices فاضية = خط أفقي مسطح.
  // دلوقتي: TradingView widget بيجيب شموع حية + volume + support/resistance تلقائياً.
  const [chartMode, setChartMode] = useState<'tradingview' | 'local'>('tradingview');
  const slice = useMemo(() => prices.slice(-30), [prices]);

  // TradingView symbol mapping per market (مش hardcoded EGX)
  const tvSymbol = useMemo(() => {
    const tk = (ticker || '').trim().toUpperCase();
    if (!tk) return '';
    const m = (market || 'EGX').toUpperCase();
    const prefixMap: Record<string, string> = {
      EGX: 'EGX',
      TADAWUL: 'TADAWUL',
      KSA: 'TADAWUL',
      KSE: 'KSE',
      QSE: 'QSE',
      US: '',
      CRYPTO: '',
      DFM: 'DFM',
    };
    const p = prefixMap[m];
    if (m === 'CRYPTO') return `${tk}USD`;
    return p ? `${p}:${tk}` : tk;
  }, [ticker, market]);

  const tvSrc = tvSymbol
    ? `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol)}&interval=D&theme=dark&style=1&timezone=Africa%2FCairo&locale=ar_AE&enable_publishing=false&allow_symbol_change=1&save_image=1&hide_side_toolbar=0&utm_source=invist.m2y.net`
    : '';

  if (!slice || slice.length === 0) {
    return (
      <SectionCard icon={<BarChart3 className="w-4 h-4" />} title={t('specialist.attr_001')} accent="slate">
        <EmptyState msg={t('specialist.attr_002')} />
      </SectionCard>
    );
  }

  const W = 760;            // viewport width
  const H = 320;            // viewport height
  const padL = 50;          // left padding for y-axis labels
  const padR = 14;
  const padT = 14;
  const padB = 56;          // bottom padding for x-axis dates + volume
  const priceH = 200;       // price chart height
  const volH = 50;          // volume bars height
  const volTop = padT + priceH + 16;
  const chartW = W - padL - padR;

  const candleSlot = chartW / slice.length;
  const candleWidth = Math.max(candleSlot * 0.6, 2);

  // Price range — include support/resistance/MA lines if provided.
  const priceValues: number[] = [];
  slice.forEach((p) => {
    [p.high, p.low, p.open, p.close].forEach((v) => {
      if (Number.isFinite(v)) priceValues.push(v);
    });
  });
  if (support != null && Number.isFinite(support)) priceValues.push(support);
  if (resistance != null && Number.isFinite(resistance)) priceValues.push(resistance);
  if (ma50 != null && Number.isFinite(ma50)) priceValues.push(ma50);
  if (ma200 != null && Number.isFinite(ma200)) priceValues.push(ma200);

  if (priceValues.length === 0) {
    return (
      <SectionCard icon={<BarChart3 className="w-4 h-4" />} title={t('specialist.attr_001')} accent="slate">
        <EmptyState msg={t('specialist.attr_003')} />
      </SectionCard>
    );
  }

  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const priceRange = Math.max(maxPrice - minPrice, 0.0001);
  // Pad range by 5% on each side so candles don't touch the chart edges.
  const padPrice = priceRange * 0.05;
  const yMin = minPrice - padPrice;
  const yMax = maxPrice + padPrice;
  const yRange = yMax - yMin;

  const scaleY = (price: number) => padT + priceH - ((price - yMin) / yRange) * priceH;

  // Volume range
  const volumes = slice.map((p) => p.volume ?? 0).filter((v) => v > 0);
  const maxVol = volumes.length > 0 ? Math.max(...volumes) : 0;

  const scaleVol = (vol: number) => (maxVol > 0 ? (vol / maxVol) * volH : 0);

  // Y-axis ticks (4 horizontal grid lines)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * yRange);

  return (
    <SectionCard
      icon={<BarChart3 className="w-4 h-4" />}
      title={t('specialist.attr_004')}
      description={`مصدر البيانات: TradingView widget (حي) + /api/maker-radar/stock?prices — ${slice.length} شمعة كـ fallback محلي (Rule 67)`}
      accent="slate"
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            <span className="text-emerald-600">▲ أعلى: {(maxPrice ?? 0).toFixed(2)}</span>
          </Badge>
          <Badge variant="outline" className="text-xs">
            <span className="text-red-600">▼ أدنى: {(minPrice ?? 0).toFixed(2)}</span>
          </Badge>
          {support != null && (
            <Badge variant="outline" className="text-xs">
              <span className="text-emerald-700">دعم: {(support ?? 0).toFixed(2)}</span>
            </Badge>
          )}
          {resistance != null && (
            <Badge variant="outline" className="text-xs">
              <span className="text-red-700">مقاومة: {(resistance ?? 0).toFixed(2)}</span>
            </Badge>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {/* CHART-REBUILD-FIX: زر تبديل بين TradingView و الشارت المحلي */}
          {tvSrc && (
            <div className="flex gap-1 p-0.5 bg-muted rounded-md">
              <Button
                size="sm"
                variant={chartMode === 'tradingview' ? 'default' : 'ghost'}
                className="h-6 px-2 text-[10px]"
                onClick={() => setChartMode('tradingview')}
              >
                TradingView
              </Button>
              <Button
                size="sm"
                variant={chartMode === 'local' ? 'default' : 'ghost'}
                className="h-6 px-2 text-[10px]"
                onClick={() => setChartMode('local')}
              >{t('specialist.k_085')}</Button>
            </div>
          )}
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-emerald-500 rounded-sm" />
              <span className="text-muted-foreground">{t('specialist.k_086')}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-red-500 rounded-sm" />
              <span className="text-muted-foreground">{t('specialist.k_087')}</span>
            </span>
          </div>
        </div>
      </div>

      {/* CHART-REBUILD-FIX: TradingView widget — شموع حية + volume + تفاعل كامل */}
      {chartMode === 'tradingview' && tvSrc ? (
        <div className="w-full h-[500px] rounded-lg overflow-hidden border border-border bg-slate-900">
          <iframe
            src={tvSrc}
            className="w-full h-full border-0"
            title={`TradingView ${ticker || ''}`}
            allowFullScreen
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="block"
          style={{ minWidth: 600 }}
          role="img"
          aria-label="Candlestick chart for last 30 trading days"
        >
          {/* Grid horizontal lines + y-axis labels */}
          {yTicks.map((t, i) => (
            <g key={`y-${i}`}>
              <line
                x1={padL}
                y1={scaleY(t)}
                x2={W - padR}
                y2={scaleY(t)}
                stroke="currentColor"
                strokeWidth={0.5}
                className="text-slate-300 dark:text-slate-700"
              />
              <text
                x={padL - 6}
                y={scaleY(t) + 3}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-[10px]"
              >
                {(t ?? 0).toFixed(2)}
              </text>
            </g>
          ))}

          {/* Support line (dashed emerald) */}
          {support != null && Number.isFinite(support) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(support)}
                x2={W - padR}
                y2={scaleY(support)}
                stroke="#10b981"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.7}
              />
              <text x={padL + 4} y={scaleY(support) - 4} className="fill-emerald-600 text-[10px] font-bold">
                دعم {(support ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* Resistance line (dashed red) */}
          {resistance != null && Number.isFinite(resistance) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(resistance)}
                x2={W - padR}
                y2={scaleY(resistance)}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.7}
              />
              <text x={padL + 4} y={scaleY(resistance) - 4} className="fill-red-600 text-[10px] font-bold">
                مقاومة {(resistance ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* Candles */}
          {slice.map((candle, i) => {
            const x = padL + i * candleSlot + candleSlot / 2;
            const isGreen = candle.close >= candle.open;
            const color = isGreen ? '#10b981' : '#ef4444';
            const bodyTop = scaleY(Math.max(candle.open, candle.close));
            const bodyBottom = scaleY(Math.min(candle.open, candle.close));
            const bodyH = Math.max(bodyBottom - bodyTop, 1);
            const wickTop = scaleY(candle.high);
            const wickBottom = scaleY(candle.low);
            return (
              <g key={`c-${i}`}>
                {/* Wick */}
                <line x1={x} y1={wickTop} x2={x} y2={wickBottom} stroke={color} strokeWidth={1} />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyH}
                  fill={color}
                  stroke={color}
                  strokeWidth={0.5}
                  rx={0.5}
                />
              </g>
            );
          })}

          {/* MA50 line (amber dashed) */}
          {ma50 != null && Number.isFinite(ma50) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(ma50)}
                x2={W - padR}
                y2={scaleY(ma50)}
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                opacity={0.85}
              />
              <text x={W - padR - 4} y={scaleY(ma50) - 4} textAnchor="end" className="fill-amber-600 text-[10px] font-bold">
                MA50 {(ma50 ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* MA200 line (slate dashed) */}
          {ma200 != null && Number.isFinite(ma200) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(ma200)}
                x2={W - padR}
                y2={scaleY(ma200)}
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                opacity={0.85}
              />
              <text x={W - padR - 4} y={scaleY(ma200) + 12} textAnchor="end" className="fill-slate-500 dark:fill-slate-400 text-[10px] font-bold">
                MA200 {(ma200 ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* Volume separator */}
          <line
            x1={padL}
            y1={volTop - 6}
            x2={W - padR}
            y2={volTop - 6}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-slate-300 dark:text-slate-700"
          />

          {/* Volume bars */}
          {slice.map((candle, i) => {
            const x = padL + i * candleSlot + candleSlot / 2;
            const vol = candle.volume ?? 0;
            const h = scaleVol(vol);
            const isGreen = candle.close >= candle.open;
            const color = isGreen ? '#10b981' : '#ef4444';
            return (
              <rect
                key={`v-${i}`}
                x={x - candleWidth / 2}
                y={volTop + volH - h}
                width={candleWidth}
                height={h}
                fill={color}
                opacity={0.45}
              />
            );
          })}

          {/* X-axis dates (every 5th) */}
          {slice.map((candle, i) => {
            if (i % 5 !== 0 || !candle.date) return null;
            const x = padL + i * candleSlot + candleSlot / 2;
            const dateLabel = candle.date.slice(5); // MM-DD
            return (
              <text
                key={`d-${i}`}
                x={x}
                y={H - 8}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[10px]"
              >
                {dateLabel}
              </text>
            );
          })}
        </svg>
      </div>
      )}
    </SectionCard>
  );
}

// ============================================================================
// §4 — Liquidity Footprint (POC + VAH/VAL + Buy/Sell + 18-level profile)
// ============================================================================

function LiquidityFootprintSection({
  data,
  canonicalAccumulation = null,
  canonicalMoneyFlow = null,
}: {
  data: FootprintData | null;
  // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
  // canonical.accumulation from /api/stocks/[ticker]/unified — single source of truth.
  canonicalAccumulation?: string | null;
  // canonical.money_flow from the unified API — used for the flow-state display.
  canonicalMoneyFlow?: string | null;
}) {  const t = useTranslation();

  if (!data || !data.success) return null;

  const poc = safeNum(data.poc_price);
  const vah = safeNum(data.vah_price);
  const val = safeNum(data.val_price);
  const buyVol = safeNum(data.buy_volume);
  const sellVol = safeNum(data.sell_volume);
  const delta = safeNum(data.delta_volume);
  const ratio = safeNum(data.buy_sell_ratio);
  const totalVol = safeNum(data.total_volume);
  const vaPct = safeNum(data.value_area_volume_pct);
  const levels = (data.levels ?? []).filter(
    (l) => l && typeof l.price_mid === 'number' && Number.isFinite(l.price_mid)
  );

  if (poc == null && vah == null && val == null && buyVol == null && levels.length === 0) {
    return null;
  }

  // Color: emerald if >1.2 (strong buy), red if <0.8 (strong sell), amber otherwise.
  const ratioColor = ratio == null ? 'text-slate-600 dark:text-slate-300'
    : ratio >= 1.2 ? 'text-emerald-600'
    : ratio <= 0.8 ? 'text-red-600'
    : 'text-amber-600';

  const totalBS = (buyVol ?? 0) + (sellVol ?? 0);
  const buyPct = totalBS > 0 && buyVol != null ? (buyVol / totalBS) * 100 : 50;
  const sellPct = 100 - buyPct;

  // For horizontal profile: find max volume for normalization.
  const maxLevelVol = levels.length > 0 ? Math.max(...levels.map((l) => l.volume ?? 0)) : 0;

  return (
    <SectionCard
      icon={<Droplets className="w-4 h-4" />}
      title={t('specialist.attr_005')}
      description={`من /api/maker-radar/footprint?ticker=${data.ticker ?? ''}&days=30 — تحليل توزيع السيولة على ${levels.length} مستوى سعر`}
      accent="emerald"
    >
      {/* Top: POC + VAH + VAL + value area % */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <PriceTile label={t('specialist.attr_006')} value={fmtNum(poc)} color="text-amber-600" sub={t('specialist.attr_007')} />
        <PriceTile label={t('specialist.attr_008')} value={fmtNum(vah)} color="text-emerald-600" />
        <PriceTile label={t('specialist.attr_009')} value={fmtNum(val)} color="text-red-600" />
        <PriceTile label={t('specialist.attr_010')} value={fmtPct(vaPct)} color="text-slate-600 dark:text-slate-300" sub={t('specialist.attr_011')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Buy vs Sell visual bar */}
        <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold mb-2 text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />{t('specialist.k_088')}</p>
          <div className="flex h-6 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
            <div
              className="bg-emerald-500 flex items-center justify-center text-[10px] text-white font-bold"
              style={{ width: `${buyPct}%` }}
            >
              {buyPct > 12 ? `${(buyPct ?? 0).toFixed(0)}%` : ''}
            </div>
            <div
              className="bg-red-500 flex items-center justify-center text-[10px] text-white font-bold"
              style={{ width: `${sellPct}%` }}
            >
              {sellPct > 12 ? `${(sellPct ?? 0).toFixed(0)}%` : ''}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <MetricRow label={t('specialist.attr_012')} value={fmtCompact(buyVol)} valueClass="text-emerald-600" />
            <MetricRow label={t('specialist.attr_013')} value={fmtCompact(sellVol)} valueClass="text-red-600" />
            <MetricRow
              label={t('specialist.attr_014')}
              value={fmtCompact(delta)}
              valueClass={delta != null && delta >= 0 ? 'text-emerald-600' : 'text-red-600'}
            />
          </div>
        </div>

        {/* Ratio gauge */}
        <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold mb-2 text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-amber-600" />{t('specialist.k_089')}</p>
          <div className="text-center">
            <p className={`text-4xl font-bold ${ratioColor}`}>{ratio != null ? ratio.toFixed(2) : '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {/* ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ─────────── */}
              {/* قبل كده: كان labels t('specialist.k_147') بـ thresholds 1.2/0.8 */}
              {/* الحل: نحسب buy_pct من buyVol/sellVol ونستخدم canonical classifyAccumulation */}
              {/* UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — canonical.accumulation
                  from unified API takes precedence over locally-derived label. */}
              {canonicalAccumulation
                ? (canonicalAccumulation.includes(t('specialist.k_148'))
                    ? `✓ ${canonicalAccumulation}`
                    : canonicalAccumulation.includes(t('specialist.k_149'))
                      ? `⚠ ${canonicalAccumulation}`
                      : canonicalAccumulation)
                : ratio == null ? '—'
                  : (() => {
                      const bV = Number(buyVol || 0);
                      const sV = Number(sellVol || 0);
                      const buyPct = (bV + sV) > 0 ? (bV / (bV + sV)) * 100 : null;
                      const label = classifyAccumulation(buyPct);
                      const isAccum = label.includes(t('specialist.k_148'));
                      const isDist = label.includes(t('specialist.k_149'));
                      return isAccum ? `✓ ${label}` : isDist ? `⚠ ${label}` : label;
                    })()
              }
            </p>
            {/* UNIFIED-API — money_flow state from unified API (Rule 27: show "—" if missing) */}
            {canonicalMoneyFlow && (
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-semibold">{canonicalMoneyFlow}</span>
              </p>
            )}
          </div>
          <div className="mt-2">
            <MetricRow label={t('specialist.attr_015')} value={fmtCompact(totalVol)} valueClass="text-amber-600" />
          </div>
        </div>
      </div>

      {/* 18-level volume profile (horizontal bars) */}
      {levels.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            توزيع السيولة على مستويات السعر ({levels.length} مستوى)
          </p>
          <div className="space-y-0.5 max-h-80 overflow-y-auto pr-1">
            {/* Sort: high price at top, low at bottom (visual ladder) */}
            {[...levels].sort((a, b) => b.price_mid - a.price_mid).map((lvl, i) => {
              const isPoc = !!lvl.is_poc;
              const isInVA = !!lvl.is_value_area;
              const buyPctLvl = lvl.volume > 0 ? (lvl.buy_volume / lvl.volume) * 100 : 50;
              const sellPctLvl = 100 - buyPctLvl;
              const widthPct = maxLevelVol > 0 ? (lvl.volume / maxLevelVol) * 100 : 0;
              const isBuyDom = lvl.delta >= 0;
              return (
                <div
                  key={`lvl-${i}`}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] ${
                    isPoc
                      ? 'bg-amber-100 dark:bg-amber-950/40 border border-amber-400 dark:border-amber-700'
                      : isInVA
                      ? 'bg-slate-50 dark:bg-slate-800/40'
                      : 'bg-transparent'
                  }`}
                >
                  <span className={`w-16 text-left font-mono ${isPoc ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                    {(lvl.price_mid ?? 0).toFixed(2)}
                  </span>
                  <div className="flex-1 relative h-3 rounded-sm overflow-hidden bg-slate-100 dark:bg-slate-800">
                    {/* Buy portion (left, emerald) */}
                    <div
                      className="absolute inset-y-0 right-0 bg-emerald-400/70"
                      style={{ width: `${(widthPct * buyPctLvl) / 100}%` }}
                    />
                    {/* Sell portion (right, red) */}
                    <div
                      className="absolute inset-y-0 left-0 bg-red-400/70"
                      style={{ width: `${(widthPct * sellPctLvl) / 100}%` }}
                    />
                    {isPoc && (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-amber-700 dark:text-amber-300">
                        POC
                      </span>
                    )}
                  </div>
                  <span className={`w-12 text-left ${isBuyDom ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isBuyDom ? '+' : ''}{fmtCompact(lvl.delta)}
                  </span>
                  <span className="w-12 text-left text-slate-500 dark:text-slate-400">
                    {lvl.volume_pct != null ? `${lvl.volume_pct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ============================================================================
// §5 — Technical Indicators Panel (RSI + MA50 + MA200 + Support/Resistance + Signal)
// ============================================================================

function TechnicalIndicatorsSection({ info }: { info: StockInfo }) {  const t = useTranslation();

  // CHART-REBUILD-FIX (2026-10-10): RSI bug fix — كان بيقرأ 100.0 لو المعادلة المحلية فاضية.
  // الحل: clamp RSI لـ [0, 100] + لو >{t('specialist.k_090')}<0 → null (مش fabrication).
  const rawRsi = safeNum(info.rsi);
  const rsi = rawRsi != null && rawRsi >= 0 && rawRsi <= 100 ? rawRsi : null;
  const ma50 = safeNum(info.ma_50);
  const ma200 = safeNum(info.ma_200);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);
  const signal = safeNum(info.signal);
  const current = safeNum(info.current_price);

  // Hide section if literally nothing.
  if (rsi == null && ma50 == null && ma200 == null && support == null && resistance == null) {
    return null;
  }

  // RSI interpretation: <30 oversold (emerald), >70 overbought (red), 30-70 neutral.
  const rsiInterp = rsi == null ? { txt: t('specialist.k_150'), cls: 'text-muted-foreground' }
    : rsi < 30 ? { txt: t('specialist.k_151'), cls: 'text-emerald-600' }
    : rsi > 70 ? { txt: t('specialist.k_152'), cls: 'text-red-600' }
    : rsi >= 45 && rsi <= 55 ? { txt: t('specialist.k_153'), cls: 'text-slate-500 dark:text-slate-400' }
    : rsi < 45 ? { txt: t('specialist.k_154'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_155'), cls: 'text-amber-600' };

  // MA position interpretation
  const ma50Interp = current != null && ma50 != null
    ? current > ma50
      ? { txt: t('specialist.k_156'), cls: 'text-emerald-600' }
      : { txt: t('specialist.k_157'), cls: 'text-red-600' }
    : { txt: '—', cls: 'text-muted-foreground' };

  const ma200Interp = current != null && ma200 != null
    ? current > ma200
      ? { txt: t('specialist.k_158'), cls: 'text-emerald-600' }
      : { txt: t('specialist.k_159'), cls: 'text-red-600' }
    : { txt: '—', cls: 'text-muted-foreground' };

  // Distance from support / resistance
  const distFromSupport = current != null && support != null && support > 0
    ? ((current - support) / support) * 100 : null;
  const distFromResistance = current != null && resistance != null && resistance > 0
    ? ((resistance - current) / current) * 100 : null;

  // UNIFY-FIX (Rule 73): استخدم canonical thresholds 78/65/55/40/25 (موحدة مع unified API)
  // بدل thresholds 70/50/30 المحلية المتضاربة.
  const sigNum = safeNum(info.signal);
  const sigInterp = sigNum == null ? { txt: '—', cls: 'text-muted-foreground' }
    : sigNum >= 78 ? { txt: t('specialist.k_160'), cls: 'text-emerald-600' }
    : sigNum >= 65 ? { txt: t('specialist.k_119'), cls: 'text-emerald-600' }
    : sigNum >= 55 ? { txt: t('specialist.k_148'), cls: 'text-teal-600' }
    : sigNum >= 40 ? { txt: t('specialist.k_161'), cls: 'text-amber-600' }
    : sigNum >= 25 ? { txt: t('specialist.k_162'), cls: 'text-orange-600' }
    : { txt: t('specialist.k_120'), cls: 'text-red-600' };

  return (
    <SectionCard
      icon={<Gauge className="w-4 h-4" />}
      title={t('specialist.attr_016')}
      description={t('specialist.attr_017')}
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* RSI gauge */}
        <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Gauge className="w-4 h-4 text-emerald-600" /> RSI
          </h4>
          <p className="text-3xl font-bold">{fmtNum(rsi, 1)}</p>
          {/* RSI bar 0-100 with marker */}
          <div className="h-2 bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 rounded-full relative mt-3">
            {rsi != null && (
              <div
                className="absolute w-3 h-4 bg-slate-900 dark:bg-white rounded-sm -top-1 border border-white shadow"
                style={{
                  right: `${Math.min(Math.max(rsi, 0), 100)}%`,
                  transform: 'translateX(50%)',
                }}
              />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>{t('specialist.k_091')}</span>
            <span>{t('specialist.k_092')}</span>
            <span>{t('specialist.k_093')}</span>
          </div>
          <p className={`text-xs mt-2 ${rsiInterp.cls}`}>{rsiInterp.txt}</p>
        </div>

        {/* MA50 */}
        <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <h4 className="font-semibold text-sm mb-2">{t('specialist.k_094')}</h4>
          <p className="text-3xl font-bold text-amber-600">{fmtNum(ma50)}</p>
          <p className={`text-xs mt-2 ${ma50Interp.cls}`}>{ma50Interp.txt}</p>
          {current != null && ma50 != null && (
            <p className="text-xs text-muted-foreground mt-1">
              المسافة: {((current - ma50) / ma50 * 100).toFixed(2)}%
            </p>
          )}
        </div>

        {/* MA200 */}
        <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <h4 className="font-semibold text-sm mb-2">{t('specialist.k_095')}</h4>
          <p className="text-3xl font-bold text-slate-600 dark:text-slate-300">{fmtNum(ma200)}</p>
          <p className={`text-xs mt-2 ${ma200Interp.cls}`}>{ma200Interp.txt}</p>
          {current != null && ma200 != null && (
            <p className="text-xs text-muted-foreground mt-1">
              المسافة: {((current - ma200) / ma200 * 100).toFixed(2)}%
            </p>
          )}
        </div>

        {/* Support */}
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-900/60">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-emerald-600" />{t('specialist.k_096')}</h4>
          <p className="text-3xl font-bold text-emerald-600">{fmtNum(support)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            المسافة من السعر الحالي: {distFromSupport != null ? `${distFromSupport.toFixed(2)}%` : '—'}
          </p>
        </div>

        {/* Resistance */}
        <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900/60">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Target className="w-4 h-4 text-red-600" />{t('specialist.k_097')}</h4>
          <p className="text-3xl font-bold text-red-600">{fmtNum(resistance)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            المسافة من السعر الحالي: {distFromResistance != null ? `${distFromResistance.toFixed(2)}%` : '—'}
          </p>
        </div>

        {/* Signal */}
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-900/60">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-amber-600" />{t('specialist.k_098')}</h4>
          <p className="text-3xl font-bold text-amber-600">
            {signal != null ? (typeof signal === 'number' ? signal.toFixed(0) : signal) : '—'}
          </p>
          <p className={`text-xs mt-2 ${sigInterp.cls}`}>{sigInterp.txt}</p>
          {sigNum != null && <Progress value={sigNum} className="h-1.5 mt-2" />}
        </div>
      </div>
    </SectionCard>
  );
}

// ============================================================================
// §6 — Fundamentals (from stock_info — 60 fields)
// ============================================================================

function FundamentalsSection({ info }: { info: StockInfo }) {  const t = useTranslation();

  const pe = safeNum(info.pe_ratio);
  const pb = safeNum(info.pb_ratio);
  const ps = safeNum(info.ps_ratio);
  const eps = safeNum(info.eps);
  const roe = safeNum(info.roe);
  const roa = safeNum(info.roa);
  const debtToEquity = safeNum(info.debt_to_equity);
  const divYield = safeNum(info.dividend_yield);
  const profitMargin = safeNum(info.profit_margin);
  const freeFloat = safeNum(info.free_float_percentage);
  const marketCap = safeNum(info.market_cap);
  const currentRatio = safeNum(info.current_ratio);
  const bookValue = safeNum(info.book_value_per_share);
  const dpsTtm = safeNum(info.dps_ttm);

  // Hide section if literally nothing.
  if (pe == null && pb == null && eps == null && roe == null && marketCap == null && debtToEquity == null) {
    return null;
  }

  // Interpretation helpers — high/low/normal based on standard thresholds.
  const peInterp = pe == null ? null
    : pe < 0 ? { txt: t('specialist.k_163'), cls: 'text-red-600' }
    : pe < 8 ? { txt: t('specialist.k_164'), cls: 'text-emerald-600' }
    : pe < 15 ? { txt: t('specialist.k_165'), cls: 'text-emerald-600' }
    : pe < 25 ? { txt: t('specialist.k_166'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_167'), cls: 'text-red-600' };

  const pbInterp = pb == null ? null
    : pb < 0 ? { txt: t('specialist.k_168'), cls: 'text-red-600' }
    : pb < 1 ? { txt: t('specialist.k_169'), cls: 'text-emerald-600' }
    : pb < 3 ? { txt: t('specialist.k_165'), cls: 'text-emerald-600' }
    : pb < 6 ? { txt: t('specialist.k_166'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_167'), cls: 'text-red-600' };

  const roeInterp = roe == null ? null
    : roe < 0 ? { txt: t('specialist.k_170'), cls: 'text-red-600' }
    : roe >= 20 ? { txt: t('specialist.k_171'), cls: 'text-emerald-600' }
    : roe >= 12 ? { txt: t('specialist.k_172'), cls: 'text-emerald-600' }
    : roe >= 5 ? { txt: t('specialist.k_173'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_174'), cls: 'text-red-600' };

  const debtInterp = debtToEquity == null ? null
    : debtToEquity < 0.3 ? { txt: t('specialist.k_175'), cls: 'text-emerald-600' }
    : debtToEquity < 1 ? { txt: t('specialist.k_176'), cls: 'text-emerald-600' }
    : debtToEquity < 2 ? { txt: t('specialist.k_177'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_178'), cls: 'text-red-600' };

  const marginInterp = profitMargin == null ? null
    : profitMargin >= 15 ? { txt: t('specialist.k_171'), cls: 'text-emerald-600' }
    : profitMargin >= 5 ? { txt: t('specialist.k_172'), cls: 'text-emerald-600' }
    : profitMargin >= 0 ? { txt: t('specialist.k_179'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_170'), cls: 'text-red-600' };

  const divInterp = divYield == null ? null
    : divYield >= 5 ? { txt: t('specialist.k_180'), cls: 'text-emerald-600' }
    : divYield > 0 ? { txt: t('specialist.k_181'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_182'), cls: 'text-slate-600' };

  return (
    <SectionCard
      icon={<Banknote className="w-4 h-4" />}
      title={t('specialist.attr_018')}
      description={t('specialist.attr_019')}
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* P/E */}
        <FundamentalCard label={t('specialist.attr_020')} value={pe != null ? pe.toFixed(2) : '—'} interp={peInterp} />
        {/* P/B */}
        <FundamentalCard label={t('specialist.attr_021')} value={pb != null ? pb.toFixed(2) : '—'} interp={pbInterp} />
        {/* P/S */}
        <FundamentalCard
          label={t('specialist.attr_022')}
          value={ps != null ? ps.toFixed(2) : '—'}
          interp={null}
        />
        {/* EPS */}
        <FundamentalCard
          label={t('specialist.attr_023')}
          value={eps != null ? eps.toFixed(3) : '—'}
          interp={eps == null ? null : { txt: eps > 0 ? t('specialist.k_183') : t('specialist.k_184'), cls: eps > 0 ? 'text-emerald-600' : 'text-red-600' }}
        />
        {/* ROE */}
        <FundamentalCard label={t('specialist.attr_024')} value={roe != null ? `${roe.toFixed(2)}%` : '—'} interp={roeInterp} />
        {/* ROA */}
        <FundamentalCard
          label={t('specialist.attr_025')}
          value={roa != null ? `${roa.toFixed(2)}%` : '—'}
          interp={roa == null ? null : { txt: roa >= 5 ? t('specialist.k_172') : t('specialist.k_174'), cls: roa >= 5 ? 'text-emerald-600' : 'text-amber-600' }}
        />
        {/* Debt/Equity */}
        <FundamentalCard label={t('specialist.attr_026')} value={debtToEquity != null ? debtToEquity.toFixed(2) : '—'} interp={debtInterp} />
        {/* Dividend Yield */}
        <FundamentalCard label={t('specialist.attr_027')} value={divYield != null ? `${divYield.toFixed(2)}%` : '—'} interp={divInterp} />
        {/* Profit Margin */}
        <FundamentalCard label={t('specialist.attr_028')} value={profitMargin != null ? `${profitMargin.toFixed(2)}%` : '—'} interp={marginInterp} />
        {/* Free Float */}
        <FundamentalCard
          label={t('specialist.attr_029')}
          value={freeFloat != null ? `${freeFloat.toFixed(1)}%` : '—'}
          interp={freeFloat == null ? null : { txt: freeFloat >= 25 ? t('specialist.k_185') : t('specialist.k_186'), cls: freeFloat >= 25 ? 'text-emerald-600' : 'text-amber-600' }}
        />
        {/* Market Cap */}
        <FundamentalCard
          label={t('specialist.attr_030')}
          value={marketCap != null && marketCap > 0 ? fmtCompact(marketCap, t('specialist.k_187')) : '—'}
          interp={null}
        />
        {/* DPS TTM */}
        <FundamentalCard
          label={t('specialist.attr_031')}
          value={dpsTtm != null ? `${dpsTtm.toFixed(3)} ج.م` : '—'}
          interp={null}
        />
        {/* Current Ratio */}
        <FundamentalCard
          label={t('specialist.attr_032')}
          value={currentRatio != null ? currentRatio.toFixed(2) : '—'}
          interp={currentRatio == null ? null : { txt: currentRatio >= 1.5 ? t('specialist.k_188') : currentRatio >= 1 ? t('specialist.k_189') : t('specialist.k_190'), cls: currentRatio >= 1 ? 'text-emerald-600' : 'text-red-600' }}
        />
        {/* Book Value */}
        <FundamentalCard
          label={t('specialist.attr_033')}
          value={fmtNum(bookValue)}
          interp={null}
        />
      </div>
    </SectionCard>
  );
}

function FundamentalCard({
  label,
  value,
  interp,
}: {
  label: string;
  value: string;
  interp: { txt: string; cls: string } | null;
}) {
  return (
    <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        {interp && <p className={`text-[10px] ${interp.cls}`}>{interp.txt}</p>}
      </div>
      <p className="text-base font-bold text-slate-700 dark:text-slate-200 ml-2">{value}</p>
    </div>
  );
}

// ============================================================================
// §7 — Momentum Stats (from radarData.stats)
// ============================================================================

function MomentumStatsSection({ stats, info }: { stats: RadarStats | null; info: StockInfo }) {  const t = useTranslation();

  if (!stats) return null;

  const roc10d = safeNum(stats.roc10d);
  const avgVol20 = safeNum(stats.avgVolume20);
  const avgTurnover20 = safeNum(stats.avgTurnover20);
  const max20 = safeNum(stats.max20);
  const min20 = safeNum(stats.min20);
  const range20Pct = safeNum(stats.range20Pct);
  const dataPoints = safeNum(stats.dataPoints);
  const lastClose = safeNum(stats.lastClose);
  const changePct = safeNum(stats.changePct);

  if (roc10d == null && avgVol20 == null && max20 == null && min20 == null) {
    return null;
  }

  // Volume ratio: latest volume vs avg20
  const currentVol = safeNum(info.volume);
  const volRatio = currentVol != null && avgVol20 != null && avgVol20 > 0 ? currentVol / avgVol20 : null;

  return (
    <SectionCard
      icon={<Activity className="w-4 h-4" />}
      title={t('specialist.attr_034')}
      description={`من radarData.stats — مدى 20 يوم (${dataPoints != null ? `${dataPoints.toFixed(0)} نقطة بيانات` : t('specialist.k_191')})`}
      accent="amber"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <PriceTile
          label={t('specialist.attr_035')}
          value={roc10d != null ? `${roc10d >= 0 ? '+' : ''}${roc10d.toFixed(2)}%` : '—'}
          color={roc10d == null ? 'text-slate-600 dark:text-slate-300' : roc10d >= 0 ? 'text-emerald-600' : 'text-red-600'}
          sub={t('specialist.attr_036')}
        />
        <PriceTile label={t('specialist.attr_037')} value={fmtInt(avgVol20)} color="text-amber-600" />
        <PriceTile
          label={t('specialist.attr_038')}
          value={avgTurnover20 != null ? fmtCompact(avgTurnover20, t('specialist.k_187')) : '—'}
          color="text-amber-700"
        />
        <PriceTile
          label={t('specialist.attr_039')}
          value={volRatio != null ? `${volRatio.toFixed(2)}x` : '—'}
          color={volRatio == null ? 'text-slate-600 dark:text-slate-300' : volRatio >= 1.5 ? 'text-emerald-600' : volRatio < 0.7 ? 'text-red-600' : 'text-amber-600'}
          sub={currentVol != null ? `اليوم: ${fmtCompact(currentVol)}` : undefined}
        />
        <PriceTile label={t('specialist.attr_040')} value={fmtNum(max20)} color="text-emerald-600" />
        <PriceTile label={t('specialist.attr_041')} value={fmtNum(min20)} color="text-red-600" />
        <PriceTile
          label={t('specialist.attr_042')}
          value={range20Pct != null ? `${range20Pct.toFixed(2)}%` : '—'}
          color="text-amber-600"
          sub={max20 != null && min20 != null ? `(${min20.toFixed(2)} — ${max20.toFixed(2)})` : undefined}
        />
        <PriceTile label={t('specialist.attr_043')} value={fmtNum(lastClose)} color="text-slate-700 dark:text-slate-200" />
      </div>
      {changePct != null && (
        <div className="mt-3 p-2 bg-slate-50 dark:bg-slate-800/60 rounded-lg flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('specialist.k_099')}</span>
          <span className={`text-sm font-bold ${changePct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {changePct >= 0 ? '+' : ''}{(changePct ?? 0).toFixed(2)}%
          </span>
        </div>
      )}
    </SectionCard>
  );
}

// ============================================================================
// §8 — Prediction History (from /api/predictions?ticker=X)
// Rule 67: accuracy stat ONLY if ≥5 closed predictions.
// ============================================================================

function PredictionHistorySection({ data }: { data: PredictionsResponse | null }) {  const t = useTranslation();

  if (!data || !data.success) {
    return (
      <SectionCard
        icon={<Trophy className="w-4 h-4" />}
        title={t('specialist.attr_044')}
        description={t('specialist.attr_045')}
        accent="amber"
      >
        <EmptyState msg={t('specialist.attr_046')} />
      </SectionCard>
    );
  }

  const preds = data.data ?? [];
  if (preds.length === 0) {
    return (
      <SectionCard
        icon={<Trophy className="w-4 h-4" />}
        title={t('specialist.attr_044')}
        description={t('specialist.attr_045')}
        accent="amber"
      >
        <EmptyState msg={t('specialist.attr_047')} />
      </SectionCard>
    );
  }

  const stats = data.stats;
  const closedCount = stats?.closedCount ?? 0;
  const hits = stats?.hits ?? 0;
  const accuracy = stats?.accuracy ?? null;
  const showAccuracy = accuracy != null; // Rule 67: only if ≥5 closed

  return (
    <SectionCard
      icon={<Trophy className="w-4 h-4" />}
      title={t('specialist.attr_044')}
      description={`من /api/predictions?ticker=${data.ticker ?? ''} — ${preds.length} توقع${closedCount > 0 ? ` (${closedCount} مغلق)` : ''}`}
      accent="amber"
    >
      {showAccuracy && (
        <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-lg">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">{t('specialist.k_100')}</p>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{accuracy}%</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {hits} ناجحة من {closedCount} توقعات مغلقة — Rule 67: لا تُعرض الإحصائية إلا بعد ≥5 توقعات مغلقة
          </p>
          <Progress value={accuracy ?? 0} className="h-1.5 mt-2" />
        </div>
      )}
      {!showAccuracy && closedCount > 0 && (
        <p className="mb-3 text-xs text-muted-foreground italic">
          عدد التوقعات المغلقة ({closedCount}) أقل من 5 — لا تُعرض إحصائية الدقة (Rule 67)
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-right p-2 font-medium">{t('specialist.k_101')}</th>
              <th className="text-right p-2 font-medium">{t('specialist.k_098')}</th>
              <th className="text-right p-2 font-medium">{t('specialist.k_102')}</th>
              <th className="text-right p-2 font-medium">{t('specialist.k_103')}</th>
              <th className="text-right p-2 font-medium">{t('specialist.k_104')}</th>
              <th className="text-right p-2 font-medium">{t('specialist.k_105')}</th>
              <th className="text-right p-2 font-medium">{t('specialist.k_106')}</th>
              <th className="text-right p-2 font-medium">{t('specialist.k_107')}</th>
            </tr>
          </thead>
          <tbody>
            {preds.slice(0, 10).map((p, i) => {
              const returnPct = safeNum(p.actual_return);
              const status = safeStr(p.status) ?? safeStr(p.signal_type) ?? '—';
              const hitTarget = p.hit_target === 1 || p.hit_target === true || (returnPct != null && returnPct > 0);
              return (
                <tr key={i} className="border-b last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="p-2 whitespace-nowrap">{safeStr(p.prediction_date)?.slice(0, 10) ?? '—'}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">
                      {safeStr(p.signal) ?? '—'}
                    </Badge>
                  </td>
                  <td className="p-2">{fmtNum(p.entry_price)}</td>
                  <td className="p-2 text-emerald-600">{fmtNum(p.target_price)}</td>
                  <td className="p-2 text-red-600">{fmtNum(p.stop_loss)}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">
                      {status}
                    </Badge>
                  </td>
                  <td className={`p-2 font-semibold ${returnPct == null ? '' : returnPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {returnPct != null ? `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="p-2">
                    {returnPct == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : hitTarget ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600 inline" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-600 inline" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {preds.length > 10 && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          عرض أول 10 توقعات من إجمالي {preds.length}
        </p>
      )}
    </SectionCard>
  );
}

// ============================================================================
// §9 — Recommendation (from stock_info.signal + support/resistance)
// ============================================================================

function RecommendationSection({ info }: { info: StockInfo }) {  const t = useTranslation();

  const current = safeNum(info.current_price);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);
  const signal = safeNum(info.signal);
  const trend = safeStr(info.trend);

  // Hide if literally nothing to show
  if (current == null && support == null && resistance == null && signal == null) {
    return null;
  }

  // Entry zone = current ± 1% (since we don't have ATR in stock_info)
  const entryLow = current != null ? current * 0.99 : null;
  const entryHigh = current != null ? current * 1.01 : null;

  // R:R = (resistance - current) / (current - support) — only if all values available
  const rr = current != null && resistance != null && support != null && current > support
    ? (resistance - current) / (current - support)
    : null;

  // UNIFY-FIX (Rule 73): توحيد thresholds مع canonical 78/65/55/40/25
  const sigInt = signal == null ? null
    : signal >= 78 ? { txt: t('specialist.k_160'), cls: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' }
    : signal >= 65 ? { txt: t('specialist.k_119'), cls: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' }
    : signal >= 55 ? { txt: t('specialist.k_148'), cls: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/30' }
    : signal >= 40 ? { txt: t('specialist.k_161'), cls: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' }
    : signal >= 25 ? { txt: t('specialist.k_162'), cls: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30' }
    : { txt: t('specialist.k_120'), cls: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30' };

  const trendAr = trend == null ? null
    : trend === t('specialist.k_086') || trend.toLowerCase().includes('up') || trend.toLowerCase().includes('bull')
    ? { txt: t('specialist.k_086'), cls: 'text-emerald-600' }
    : trend === t('specialist.k_087') || trend.toLowerCase().includes('down') || trend.toLowerCase().includes('bear')
    ? { txt: t('specialist.k_087'), cls: 'text-red-600' }
    : { txt: trend, cls: 'text-slate-600 dark:text-slate-300' };

  return (
    <SectionCard
      icon={<Target className="w-4 h-4" />}
      title={t('specialist.attr_048')}
      description={t('specialist.attr_049')}
      accent="amber"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {/* Entry zone */}
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">{t('specialist.k_108')}</p>
          <p className="text-lg font-bold text-emerald-600 mt-1">
            {entryLow != null && entryHigh != null
              ? `${(entryLow ?? 0).toFixed(2)} — ${(entryHigh ?? 0).toFixed(2)}`
              : '—'}
          </p>
        </div>
        {/* Target = resistance */}
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">{t('specialist.k_109')}</p>
          <p className="text-lg font-bold text-emerald-700 mt-1">{fmtNum(resistance)}</p>
        </div>
        {/* Stop = support */}
        <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">{t('specialist.k_110')}</p>
          <p className="text-lg font-bold text-red-600 mt-1">{fmtNum(support)}</p>
        </div>
        {/* R:R */}
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">{t('specialist.k_111')}</p>
          <p className={`text-lg font-bold mt-1 ${rr == null ? 'text-slate-600 dark:text-slate-300' : rr >= 2 ? 'text-emerald-600' : rr >= 1 ? 'text-amber-600' : 'text-red-600'}`}>
            {rr != null ? `${rr.toFixed(2)}:1` : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Signal interpretation */}
        <div className={`p-3 rounded-lg ${sigInt?.bg ?? 'bg-slate-50 dark:bg-slate-800/60'}`}>
          <p className="text-xs text-muted-foreground mb-1">{t('specialist.k_098')}</p>
          <p className="text-sm font-semibold flex items-center gap-2">
            <span className={`text-lg ${sigInt?.cls ?? 'text-muted-foreground'}`}>
              {sigInt?.txt ?? '—'}
            </span>
            {signal != null && (
              <Badge variant="outline" className="text-[10px]">
                {typeof info.signal === 'number' ? (info.signal as number).toFixed(0) : (info.signal as string) ?? '—'}/100
              </Badge>
            )}
          </p>
          {signal != null && <Progress value={signal} className="h-1.5 mt-2" />}
        </div>
        {/* Trend */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg">
          <p className="text-xs text-muted-foreground mb-1">{t('specialist.k_112')}</p>
          <p className={`text-sm font-semibold ${trendAr?.cls ?? 'text-muted-foreground'}`}>
            {trendAr?.txt ?? '—'}
          </p>
        </div>
      </div>

      {rr != null && (
        <p className="text-xs text-muted-foreground mt-3 text-center">
          المعادلة: (المقاومة {fmtNum(resistance)} − السعر {fmtNum(current)}) ÷ (السعر {fmtNum(current)} − الدعم {fmtNum(support)}) = {(rr ?? 0).toFixed(2)}:1
          {' '}
          {rr >= 2 ? t('specialist.k_192') : rr >= 1.5 ? t('specialist.k_193') : t('specialist.k_194')}
        </p>
      )}
    </SectionCard>
  );
}

// ============================================================================
// §10 — 52-Week Analysis (visual bar)
// ============================================================================

function Week52AnalysisSection({ info }: { info: StockInfo }) {  const t = useTranslation();

  const current = safeNum(info.current_price);
  const high52w = safeNum(info.high_52w);
  const low52w = safeNum(info.low_52w);

  if (high52w == null && low52w == null) return null;

  const distFromHigh = current != null && high52w != null && high52w > 0
    ? ((current - high52w) / high52w) * 100 : null;
  const distFromLow = current != null && low52w != null && low52w > 0
    ? ((current - low52w) / low52w) * 100 : null;

  const range = high52w != null && low52w != null ? high52w - low52w : null;
  const positionPct = current != null && high52w != null && low52w != null && range != null && range > 0
    ? ((current - low52w) / range) * 100 : null;

  // Interpretation
  const interp = positionPct == null ? null
    : positionPct >= 80 ? { txt: t('specialist.k_195'), cls: 'text-red-600' }
    : positionPct >= 60 ? { txt: t('specialist.k_196'), cls: 'text-amber-600' }
    : positionPct >= 40 ? { txt: t('specialist.k_197'), cls: 'text-slate-600 dark:text-slate-300' }
    : positionPct >= 20 ? { txt: t('specialist.k_198'), cls: 'text-amber-600' }
    : { txt: t('specialist.k_199'), cls: 'text-emerald-600' };

  return (
    <SectionCard
      icon={<Layers className="w-4 h-4" />}
      title={t('specialist.attr_050')}
      description={t('specialist.attr_051')}
      accent="slate"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <PriceTile label={t('specialist.attr_052')} value={fmtNum(high52w)} color="text-emerald-600" />
        <PriceTile label={t('specialist.attr_053')} value={fmtNum(low52w)} color="text-red-600" />
        <PriceTile
          label={t('specialist.attr_054')}
          value={distFromHigh != null ? `${distFromHigh >= 0 ? '+' : ''}${distFromHigh.toFixed(1)}%` : '—'}
          color={distFromHigh == null ? 'text-slate-600 dark:text-slate-300' : distFromHigh < 0 ? 'text-red-600' : 'text-emerald-600'}
        />
        <PriceTile
          label={t('specialist.attr_055')}
          value={distFromLow != null ? `${distFromLow >= 0 ? '+' : ''}${distFromLow.toFixed(1)}%` : '—'}
          color={distFromLow == null ? 'text-slate-600 dark:text-slate-300' : distFromLow > 0 ? 'text-emerald-600' : 'text-red-600'}
        />
      </div>

      {/* Visual range bar */}
      {current != null && high52w != null && low52w != null && range != null && range > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-red-600">قاع: {(low52w ?? 0).toFixed(2)}</span>
            <span className="text-emerald-600">قمة: {(high52w ?? 0).toFixed(2)}</span>
          </div>
          <div className="relative h-4 rounded-full bg-gradient-to-l from-red-500 via-amber-400 to-emerald-500">
            <div
              className="absolute w-1 h-6 -top-1 bg-slate-900 dark:bg-white rounded-sm shadow-md border border-white"
              style={{
                right: `${Math.min(Math.max(positionPct ?? 50, 0), 100)}%`,
                transform: 'translateX(50%)',
              }}
            />
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-muted-foreground">0%</span>
            <span className="text-muted-foreground">السعر الحالي: {(current ?? 0).toFixed(2)}</span>
            <span className="text-muted-foreground">100%</span>
          </div>
          {interp && (
            <p className={`text-sm font-semibold mt-2 text-center ${interp.cls}`}>
              {interp.txt} — {positionPct?.toFixed(0)}% من المدى
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ============================================================================
// §11 — Flow + Explosive (graceful degrade — may be empty)
// ============================================================================

function FlowExplosiveSection({ flow, explosive }: { flow: FlowData | null; explosive: ExplosiveData | null }) {  const t = useTranslation();

  const flowObj = (flow?.flow ?? (flow?.data as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;
  const explObj = (explosive?.explosive ?? (explosive?.data as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;

  // If both empty (Python down) — show graceful degrade message.
  const flowEmpty = !flowObj || flow?.message;
  const explEmpty = !explObj || explosive?.message;

  if (flowEmpty && explEmpty) {
    return (
      <SectionCard
        icon={<Flame className="w-4 h-4" />}
        title={t('specialist.attr_056')}
        description={t('specialist.attr_057')}
        accent="amber"
      >
        <EmptyState msg={t('specialist.attr_058')} />
      </SectionCard>
    );
  }

  const flowScore = safeNum(flowObj?.flow_score);
  const flowLabel = safeStr(flowObj?.label);
  const flowColor = safeStr(flowObj?.color);
  const macroFlow = safeStr(flowObj?.macro_flow);
  const sectorFlow = safeStr(flowObj?.sector_flow);
  const stockFlow = safeStr(flowObj?.stock_flow);

  const explScore = safeNum(explObj?.explosive_score);
  const explLabel = safeStr(explObj?.label);
  const explPattern = safeStr(explObj?.pattern);
  const explColor = safeStr(explObj?.color);
  const explAction = safeStr(explObj?.action);
  const explStop = safeNum(explObj?.stop_loss);
  const explTarget = safeNum(explObj?.target);
  const volRatio = safeNum(explObj?.volume_ratio);
  const range10d = safeNum(explObj?.range_10d_pct);
  const explExcluded = explObj?.excluded === true || explObj?.excluded === 'true';

  function resolveColor(color: string | null, score: number | null): string {
    if (color === 'red') return 'text-red-600';
    if (color === 'orange') return 'text-orange-600';
    if (color === 'amber') return 'text-amber-600';
    if (color === 'green') return 'text-emerald-600';
    if (score != null) {
      if (score >= 70) return 'text-emerald-600';
      if (score >= 40) return 'text-amber-600';
      return 'text-red-600';
    }
    return 'text-slate-600 dark:text-slate-300';
  }

  return (
    <SectionCard
      icon={<Flame className="w-4 h-4" />}
      title={t('specialist.attr_056')}
      description={t('specialist.attr_059')}
      accent="amber"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Flow Score */}
        {flowObj && (
          <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-emerald-600" />{t('specialist.k_113')}</h4>
            <div className="flex items-center gap-3">
              <span className={`text-4xl font-bold ${resolveColor(flowColor, flowScore)}`}>
                {flowScore != null ? flowScore.toFixed(0) : '—'}
              </span>
              <div className="min-w-0">
                <div className="text-base font-bold text-slate-700 dark:text-slate-200">{flowLabel ?? '—'}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span>Macro: <span className="font-medium">{macroFlow ?? '—'}</span></span>
                  <span>Sector: <span className="font-medium">{sectorFlow ?? '—'}</span></span>
                  <span>Stock: <span className="font-medium">{stockFlow ?? '—'}</span></span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Explosive Scanner */}
        {explObj && !explExcluded && (
          <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-amber-600" />{t('specialist.k_114')}</h4>
            <div className="flex items-center gap-3">
              <span className={`text-4xl font-bold ${resolveColor(explColor, explScore)}`}>
                {explScore != null ? explScore.toFixed(0) : '—'}
              </span>
              <div className="min-w-0">
                <div className="text-base font-bold text-slate-700 dark:text-slate-200">
                  {explLabel ?? '—'} <span className="text-xs text-muted-foreground">— {explPattern ?? '—'}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Vol Ratio: <span className="font-medium">{volRatio != null ? `${volRatio.toFixed(2)}x` : '—'}</span>
                  {range10d != null && <> · Range 10d: <span className="font-medium">{range10d.toFixed(1)}%</span></>}
                </div>
                <div className="text-xs mt-1">
                  <span className="text-muted-foreground">{t('specialist.k_115')}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{explAction ?? '—'}</span>
                  {explStop != null && <span className="text-red-600"> · وقف: {explStop.toFixed(1)}%</span>}
                  {explTarget != null && <span className="text-emerald-600"> · هدف: +{explTarget.toFixed(1)}%</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ============================================================================
// §12 — Comprehensive Analysis (graceful degrade — maestro/hunter/board/news)
// ============================================================================

function ComprehensiveAnalysisSection({ data }: { data: ComprehensiveData | null }) {  const t = useTranslation();

  if (!data || !data.success) {
    return (
      <SectionCard
        icon={<Activity className="w-4 h-4" />}
        title={t('specialist.attr_060')}
        description={t('specialist.attr_061')}
        accent="emerald"
      >
        <EmptyState msg={t('specialist.attr_062')} />
      </SectionCard>
    );
  }

  const maestro = data.maestro;
  const hunter = data.hunter;
  const board = data.board;
  const news = data.news ?? [];

  const hasAnything = !!maestro || !!hunter || !!board || news.length > 0;

  if (!hasAnything) {
    return (
      <SectionCard
        icon={<Activity className="w-4 h-4" />}
        title={t('specialist.attr_060')}
        description={t('specialist.attr_061')}
        accent="emerald"
      >
        <EmptyState msg={t('specialist.attr_062')} />
      </SectionCard>
    );
  }

  const phase = safeStr(maestro?.phase) ?? safeStr(maestro?.regime_phase);
  const phaseMeta: Record<string, { ar: string; cls: string }> = {
    accumulation: { ar: t('specialist.k_200'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
    markup: { ar: t('specialist.k_201'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
    distribution: { ar: t('specialist.k_202'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
    decline: { ar: t('specialist.k_203'), cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400' },
  };
  const meta = phase ? phaseMeta[phase.toLowerCase()] ?? { ar: phase, cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' } : null;

  const hunterScore = safeNum(hunter?.opportunity_score) ?? safeNum(hunter?.score);
  const hunterAssessment = safeStr(hunter?.assessment) ?? safeStr(hunter?.recommendation);

  const institutionalBuy = safeNum(board?.institutional_buy_volume) ?? safeNum(board?.institutional_buy);
  const institutionalSell = safeNum(board?.institutional_sell_volume) ?? safeNum(board?.institutional_sell);
  const netInstitutional = safeNum(board?.net_institutional_volume) ?? safeNum(board?.net_institutional);

  return (
    <SectionCard
      icon={<Activity className="w-4 h-4" />}
      title={t('specialist.attr_060')}
      description={t('specialist.attr_063')}
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Maestro Phase */}
        {meta && (
          <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-600" />{t('specialist.k_116')}</p>
            <Badge className={`text-sm ${meta.cls}`}>{meta.ar}</Badge>
          </div>
        )}

        {/* Hunter Assessment */}
        {hunterScore != null && (
          <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-amber-600" />{t('specialist.k_117')}</p>
            <p className="text-2xl font-bold text-amber-600">{(hunterScore ?? 0).toFixed(0)}</p>
            {hunterAssessment && <p className="text-xs mt-1 text-slate-700 dark:text-slate-200">{hunterAssessment}</p>}
          </div>
        )}

        {/* Board / Institutional Activity */}
        {(institutionalBuy != null || institutionalSell != null) && (
          <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />{t('specialist.k_118')}</p>
            <div className="grid grid-cols-3 gap-2 text-xs mt-1">
              <div>
                <p className="text-muted-foreground text-[10px]">{t('specialist.k_119')}</p>
                <p className="font-bold text-emerald-600">{fmtCompact(institutionalBuy)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px]">{t('specialist.k_120')}</p>
                <p className="font-bold text-red-600">{fmtCompact(institutionalSell)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px]">{t('specialist.k_121')}</p>
                <p className={`font-bold ${netInstitutional == null ? 'text-slate-600 dark:text-slate-300' : netInstitutional >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmtCompact(netInstitutional)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* News */}
        {news.length > 0 && (
          <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Newspaper className="w-3.5 h-3.5 text-slate-600" />{t('specialist.k_122')}</p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {news.slice(0, 3).map((n, i) => {
                const title = safeStr(n.title) ?? safeStr(n.headline) ?? '—';
                const sentiment = safeStr(n.sentiment);
                return (
                  <div key={i} className="text-xs">
                    <p className="line-clamp-1">{title}</p>
                    {sentiment && (
                      <span className={`text-[10px] ${sentiment === 'positive' || sentiment === 'POSITIVE' ? 'text-emerald-600' : sentiment === 'negative' || sentiment === 'NEGATIVE' ? 'text-red-600' : 'text-slate-500'}`}>
                        {sentiment}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {data?.errors?.length ? (
        <p className="text-xs text-muted-foreground mt-3 italic">
          ⚠ تحذيرات المحركات: {data.errors.join(t('specialist.k_204'))}
        </p>
      ) : null}
    </SectionCard>
  );
}

// ============================================================================
// §13 — Position Sizing Calculator (interactive)
// ============================================================================

function PositionSizingCalculator({
  entryPrice,
  stopLoss,
  targetPrice,
  rrRatio,
}: {
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  rrRatio: number | null;
}) {  const t = useTranslation();

  const [capital, setCapital] = useState<string>('10000');
  const [riskPct, setRiskPct] = useState<string>('1');

  const capitalNum = safeNum(capital);
  const riskPctNum = safeNum(riskPct);

  const riskAmount = capitalNum != null && riskPctNum != null ? (capitalNum * riskPctNum) / 100 : null;
  const perShareRisk =
    entryPrice != null && stopLoss != null && entryPrice > stopLoss ? entryPrice - stopLoss : null;
  const maxShares =
    riskAmount != null && perShareRisk != null && perShareRisk > 0
      ? Math.floor(riskAmount / perShareRisk)
      : null;
  const maxSharesValue = maxShares != null && entryPrice != null ? maxShares * entryPrice : null;

  return (
    <SectionCard
      icon={<Calculator className="w-4 h-4" />}
      title={t('specialist.attr_064')}
      description={t('specialist.attr_065')}
      accent="amber"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('specialist.k_123')}</label>
            <div className="relative">
              <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                className="w-full pr-9 pl-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-background text-sm"
                placeholder="10000"
                min="0"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('specialist.k_124')}</label>
            <div className="relative">
              <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                value={riskPct}
                onChange={(e) => setRiskPct(e.target.value)}
                className="w-full pr-9 pl-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-background text-sm"
                placeholder="1"
                min="0"
                max="100"
                step="0.5"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('specialist.k_125')}</p>
        </div>

        <div className="space-y-2">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg">
            <p className="text-xs text-muted-foreground">{t('specialist.k_126')}</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">
              {riskAmount != null ? `${riskAmount.toFixed(2)} جنيه` : '—'}
            </p>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
            <p className="text-xs text-muted-foreground">{t('specialist.k_127')}</p>
            <p className="text-xl font-bold text-amber-600 mt-1">
              {perShareRisk != null ? `${perShareRisk.toFixed(2)} جنيه` : '—'}
            </p>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg">
            <p className="text-xs text-muted-foreground">{t('specialist.k_128')}</p>
            <p className="text-2xl font-bold text-slate-700 dark:text-slate-200 mt-1">
              {maxShares != null ? maxShares.toLocaleString('en-US') : '—'}
            </p>
            {maxSharesValue != null && (
              <p className="text-xs text-muted-foreground mt-1">
                قيمة الصفقة: {maxSharesValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} جنيه
              </p>
            )}
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg">
            <p className="text-xs text-muted-foreground">{t('specialist.k_129')}</p>
            <p className="text-lg font-bold text-emerald-700 mt-1">
              {rrRatio != null ? `${rrRatio.toFixed(2)}:1` : '—'}
            </p>
            {rrRatio != null && (
              <p className="text-xs text-muted-foreground mt-1">
                {rrRatio >= 2
                  ? t('specialist.k_205')
                  : rrRatio >= 1.8
                  ? t('specialist.k_206')
                  : t('specialist.k_207')}
              </p>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ============================================================================
// §14 — Price Levels Ladder (52w high → resistance → current → support → 52w low)
// ============================================================================

function PriceLevelsLadderSection({ info }: { info: StockInfo }) {  const t = useTranslation();

  const current = safeNum(info.current_price);
  const high52w = safeNum(info.high_52w);
  const low52w = safeNum(info.low_52w);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);

  if (current == null && high52w == null && low52w == null && support == null && resistance == null) {
    return null;
  }

  const rows: Array<{ label: string; value: number | null; color: string; bg: string }> = [
    { label: t('specialist.attr_052'), value: high52w, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/60' },
    { label: t('specialist.k_097'), value: resistance, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60' },
    { label: t('specialist.k_208'), value: current, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700' },
    { label: t('specialist.k_096'), value: support, color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60' },
    { label: t('specialist.attr_053'), value: low52w, color: 'text-red-700', bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/60' },
  ].filter((r) => r.value != null) as Array<{ label: string; value: number | null; color: string; bg: string }>;

  return (
    <SectionCard
      icon={<Layers className="w-4 h-4" />}
      title={t('specialist.attr_066')}
      description={t('specialist.attr_067')}
      accent="slate"
    >
      <div className="space-y-2">
        {rows.map((r, i) => {
          const isCurrent = r.label === t('specialist.k_208');
          return (
            <div
              key={i}
              className={`flex items-center justify-between p-3 rounded-lg border ${r.bg} ${isCurrent ? 'shadow-md ring-2 ring-emerald-300 dark:ring-emerald-700' : ''}`}
            >
              <div className="flex items-center gap-2">
                {isCurrent && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                <span className="text-sm font-medium">{r.label}</span>
              </div>
              <span className={`text-lg font-bold ${r.color}`}>
                {r.value != null ? r.value.toFixed(2) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ============================================================================
// §15 — Score Dashboard (fundamental_score + smc_score + signal)
// ============================================================================

function ScoreDashboardSection({ info }: { info: StockInfo }) {  const t = useTranslation();

  const fundScore = safeNum(info.fundamental_score);
  const smcScore = safeNum(info.smc_score);
  const signalScore = safeNum(info.signal);

  if (fundScore == null && smcScore == null && signalScore == null) {
    return null;
  }

  const scoreColor = (s: number | null) => s == null ? 'text-slate-600 dark:text-slate-300'
    : s >= 70 ? 'text-emerald-600'
    : s >= 40 ? 'text-amber-600'
    : 'text-red-600';

  return (
    <SectionCard
      icon={<Gauge className="w-4 h-4" />}
      title={t('specialist.attr_068')}
      description={t('specialist.attr_069')}
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { label: t('specialist.k_209'), value: fundScore, icon: <Banknote className="w-4 h-4" />, color: 'emerald' as const },
          { label: t('specialist.k_210'), value: smcScore, icon: <Activity className="w-4 h-4" />, color: 'amber' as const },
          { label: t('specialist.k_211'), value: signalScore, icon: <Target className="w-4 h-4" />, color: 'slate' as const },
        ].map((s, i) => (
          <div key={i} className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-2 text-muted-foreground">
              {s.icon}
              <span className="text-xs">{s.label}</span>
            </div>
            <p className={`text-3xl font-bold ${scoreColor(s.value)}`}>
              {s.value != null ? s.value.toFixed(0) : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">/ 100</p>
            {s.value != null && <Progress value={s.value} className="h-1.5 mt-2" />}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ============================================================================
// §16 — Sharia Compliance
// ============================================================================

function ShariaSection({ data }: { data: ShariaResponse | null }) {  const t = useTranslation();

  if (!data || !data.success) return null;

  const metric = data.metric;
  const isHalal = safeNum(metric?.is_halal_consensus) === 1 || metric?.is_halal_consensus === true;
  const compliantCount = safeNum(metric?.compliant_sources_count);
  const activeCount = safeNum(metric?.active_sources_count);
  const category = safeStr(metric?.category_ar) ?? safeStr(metric?.category);
  const nameAr = safeStr(metric?.name_ar);
  const needsReview = safeNum(metric?.needs_review) === 1 || metric?.needs_review === true;
  const purificationRate = (data.purification_rates ?? []).find((r) => safeNum(r.is_primary) === 1 || r.is_primary === true);
  const purRatePct = safeNum(purificationRate?.rate_pct);

  return (
    <SectionCard
      icon={<BookOpen className="w-4 h-4" />}
      title={t('specialist.attr_070')}
      description={t('specialist.attr_071')}
      accent={isHalal ? 'emerald' : 'red'}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`p-3 rounded-lg text-center ${isHalal ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}>
          <p className="text-xs text-muted-foreground">{t('specialist.k_130')}</p>
          <p className={`text-lg font-bold mt-1 ${isHalal ? 'text-emerald-600' : 'text-red-600'}`}>
            {isHalal ? t('specialist.k_212') : t('specialist.k_213')}
          </p>
        </div>
        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">{t('specialist.k_131')}</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-1">
            {compliantCount != null && activeCount != null ? `${compliantCount}/${activeCount}` : '—'}
          </p>
        </div>
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">{t('specialist.k_132')}</p>
          <p className="text-lg font-bold text-amber-600 mt-1">
            {purRatePct != null ? `${purRatePct.toFixed(2)}%` : '—'}
          </p>
        </div>
      </div>

      {nameAr && (
        <p className="text-sm mt-3">
          <span className="text-muted-foreground">{t('specialist.k_133')}</span>
          <span className="font-medium">{nameAr}</span>
        </p>
      )}
      {category && (
        <p className="text-xs mt-1">
          <span className="text-muted-foreground">{t('specialist.k_134')}</span>
          {category}
        </p>
      )}
      {needsReview && (
        <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded text-xs text-amber-700 dark:text-amber-400">{t('specialist.k_135')}</div>
      )}
    </SectionCard>
  );
}

// ============================================================================
// Share Buttons
// ============================================================================

function ShareButtons({ info, ticker }: { info: StockInfo; ticker: string }) {  const t = useTranslation();

  const nameAr = safeStr(info.name_ar) ?? safeStr(info.name) ?? ticker;
  const current = safeNum(info.current_price);
  const changePct = safeNum(info.change_percent);
  const trend = safeStr(info.trend);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);

  const shareText = `📊 تحليل سهم ${ticker} - ${nameAr}

💰 السعر الحالي: ${current != null ? current.toFixed(2) : '—'}
${changePct != null ? `${changePct >= 0 ? '📈' : '📉'} التغير: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%\n` : ''}📊 الاتجاه: ${trend ?? '—'}
🛡️ الدعم: ${support != null ? support.toFixed(2) : '—'}
🎯 المقاومة: ${resistance != null ? resistance.toFixed(2) : '—'}
${OFFICIAL_LINKS_BLOCK}

#EGX #استثمار #تحليل_فني`;

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const handleShare = (kind: 'whatsapp' | 'facebook' | 'telegram' | 'copy') => {
    if (kind === 'whatsapp') window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
    else if (kind === 'facebook')
      window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(shareText)}&u=${encodeURIComponent(shareUrl)}`, '_blank');
    else if (kind === 'telegram')
      window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank');
    else {
      navigator.clipboard.writeText(shareText);
      toast.success(t('specialist.k_214'));
    }
  };

  return (
    <SectionCard icon={<Share2 className="w-4 h-4" />} title={t('specialist.attr_072')} accent="slate">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => handleShare('whatsapp')} size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5">
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </Button>
        <Button onClick={() => handleShare('facebook')} size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5">
          <Facebook className="w-4 h-4" /> Facebook
        </Button>
        <Button onClick={() => handleShare('telegram')} size="sm" className="bg-slate-600 hover:bg-slate-700 text-white gap-1.5">
          <Send className="w-4 h-4" /> Telegram
        </Button>
        <Button onClick={() => handleShare('copy')} size="sm" variant="outline" className="gap-1.5">
          <Download className="w-4 h-4" />{t('specialist.k_136')}</Button>
      </div>
    </SectionCard>
  );
}

// ============================================================================
// §1 — Header Card (icon + ticker + name + sector + price + change + trend + sharia)
// ============================================================================

function HeaderCard({
  info,
  symbol,
  iconUrl,
  sharia,
  market,
}: {
  info: StockInfo;
  symbol: string;
  iconUrl: string | null;
  sharia: ShariaResponse | null;
  market: string;
}) {  const t = useTranslation();

  const nameAr = safeStr(info.name_ar) ?? safeStr(info.name) ?? symbol;
  const sector = safeStr(info.sector);
  const industry = safeStr(info.industry);
  const current = safeNum(info.current_price);
  const changePct = safeNum(info.change_percent);
  const changeValue = safeNum(info.change_value);
  const trend = safeStr(info.trend);
  const isEgx30 = info.is_egx30 === 1 || info.is_egx30 === true;
  const isEgx70 = info.is_egx70 === 1 || info.is_egx70 === true;
  const isEgx100 = info.is_egx100 === 1 || info.is_egx100 === true;
  const isSuspended = info.is_suspended === 1 || info.is_suspended === true;

  const trendAr = trend == null ? null
    : trend === t('specialist.k_086') || trend.toLowerCase().includes('up') || trend.toLowerCase().includes('bull')
    ? { txt: t('specialist.k_086'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' }
    : trend === t('specialist.k_087') || trend.toLowerCase().includes('down') || trend.toLowerCase().includes('bear')
    ? { txt: t('specialist.k_087'), cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400' }
    : { txt: trend, cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };

  const shariaHalal = sharia?.success
    ? (safeNum(sharia.metric?.is_halal_consensus) === 1 || sharia.metric?.is_halal_consensus === true)
    : null;

  return (
    <Card className="bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 shadow-sm">
      <CardContent className="pt-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0 flex-1 flex items-start gap-3">
            <StockIcon symbol={symbol} iconUrl={iconUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="text-2xl sm:text-3xl font-bold">{symbol}</h2>
                {trendAr && <Badge className={`text-xs ${trendAr.cls}`}>{trendAr.txt}</Badge>}
                {isEgx30 && <Badge variant="outline" className="text-xs border-emerald-400 text-emerald-700 dark:text-emerald-300">EGX30</Badge>}
                {isEgx70 && <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-300">EGX70</Badge>}
                {isEgx100 && <Badge variant="outline" className="text-xs">EGX100</Badge>}
                {shariaHalal != null && (
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      shariaHalal
                        ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30'
                        : 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30'
                    }`}
                  >
                    {shariaHalal ? t('specialist.k_215') : t('specialist.k_213')}
                  </Badge>
                )}
                {isSuspended && (
                  <Badge variant="destructive" className="text-xs">{t('specialist.k_137')}</Badge>
                )}
                <StockPublisher
                  data={{
                    ticker: symbol,
                    nameAr: nameAr ?? undefined,
                    nameEn: safeStr(info.name) ?? undefined,
                    sector: sector ?? undefined,
                    currentPrice: current ?? 0,
                  }}
                  variant="icon"
                  size="sm"
                />
              </div>
              <p className="text-sm sm:text-base text-muted-foreground">{nameAr}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {sector && <Badge variant="outline" className="text-xs">{sector}</Badge>}
                {industry && <Badge variant="outline" className="text-xs">{industry}</Badge>}
                <Badge variant="outline" className="text-xs">
                  {MARKET_NAMES_AR[market as keyof typeof MARKET_NAMES_AR] ?? market}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-center md:text-left flex-shrink-0">
            <div className="text-3xl sm:text-4xl font-bold">{fmtNum(current, 2)}</div>
            {changePct != null && (
              <p
                className={`text-sm font-semibold mt-1 flex items-center justify-center md:justify-start gap-1 ${
                  changePct >= 0 ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {changePct >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                {changePct >= 0 ? '+' : ''}{(changePct ?? 0).toFixed(2)}%
                {changeValue != null && <span className="text-xs text-muted-foreground">({changeValue >= 0 ? '+' : ''}{changeValue.toFixed(2)})</span>}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SpecialistAnalysisView() {
  const t = useTranslation();
  const { stocks, currentMarket, loadStocks, selectedTicker: storeTicker } = useAppStore();
  // FIX-MOHSEN-5: read selectedTicker from global store (when user clicks a stock
  // in StocksView/LiquidityRadar then navigates to #specialist-analysis, the
  // ticker should auto-populate instead of showing an empty input).
  const [ticker, setTicker] = useState(storeTicker || '');
  const [loading, setLoading] = useState(false);

  // Sync ticker when store selectedTicker changes
  useEffect(() => {
    if (storeTicker) setTicker(storeTicker);
  }, [storeTicker]);

  // PRIMARY: maker-radar/stock (always works — reads from stocks.db)
  const [radarData, setRadarData] = useState<MakerRadarStock | null>(null);
  // SECONDARY: maker-radar/footprint (always works — reads from stocks.db)
  const [footprint, setFootprint] = useState<FootprintData | null>(null);
  // TERTIARY: predictions.db via /api/predictions?ticker=X
  const [predictions, setPredictions] = useState<PredictionsResponse | null>(null);
  // ENRICHMENT (graceful degrade):
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [explosive, setExplosive] = useState<ExplosiveData | null>(null);
  const [comprehensive, setComprehensive] = useState<ComprehensiveData | null>(null);
  const [sharia, setSharia] = useState<ShariaResponse | null>(null);
  const [stockMeta, setStockMeta] = useState<SingleStockData | null>(null);
  // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
  // Canonical source of truth for accumulation + money_flow labels.
  const [unified, setUnified] = useState<any>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stocks.length === 0) {
      loadStocks();
    }
  }, [stocks.length, loadStocks]);

  // ─── fetchAnalysis — 8 parallel fetches (Rule 67 — Promise.allSettled) ───
  // PRIMARY = maker-radar/stock (must succeed; otherwise we have nothing)
  // OTHERS = independent (each settles individually)
  // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — added /api/stocks/X/unified
  // as 9th parallel fetch (best-effort; falls back to local accumulation logic).
  const fetchAnalysis = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setRadarData(null);
    setFootprint(null);
    setPredictions(null);
    setFlow(null);
    setExplosive(null);
    setComprehensive(null);
    setSharia(null);
    setStockMeta(null);
    setUnified(null);

    try {
      const enc = encodeURIComponent(symbol);
      // MARKET-FILTER-COMPLETE (Task MARKET-FILTER-COMPLETE):
      // قبل كده: كل الـ fetches دي كانت بدون `?market=` → الـ API بـ يرجع أي سهم
      // بالـ ticker ده بغض النظر عن السوق المختار. لو فيه ticker متكرر بين EGX و US
      // بيرجع الأول → بيانات خاطئة. الحل: نمرر currentMarket لكل fetch.
      const mkt = encodeURIComponent(currentMarket);

      // Fire ALL fetches in parallel — each settles independently.
      const results = await Promise.allSettled([
        // PRIMARY — must succeed
        fetch(`/api/maker-radar/stock?ticker=${enc}&market=${mkt}`),
        // PHASE4-APIS (Task PHASE4-APIS, Rule 27): /api/maker-radar/footprint
        // (410 Gone — naive 70/30 split) → /api/flow/[ticker] (canonical Python
        // compute_money_flow: CLV-5d + CMF-20d + vol_confirmation).
        // The downstream LiquidityFootprintSection consumes a FootprintData-shaped
        // object; we remap /api/flow fields → footprint fields below.
        fetch(`/api/flow/${enc}`),
        // TERTIARY — predictions.db direct
        fetch(`/api/predictions?ticker=${enc}&limit=10&market=${mkt}`),
        // ─── PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) ───────────────────
        // شيلنا نداءات الـ sub-engine APIs الميتة:
        //   - /api/flow (compute_flow engine)
        //   - /api/explosive (explosive engine)
        //   - /api/stocks/${enc}/comprehensive (multiple sub-engines)
        //   - /api/stocks/${enc} (Python raw)
        // كل دي كانت بـ تعرض signals مختلفة. الـ unified API هو المصدر الوحيد.
        // Sharia: EGX-only — no market param needed (per task description).
        fetch(`/api/sharia?symbol=${enc}`),
        // UNIFIED-API — canonical signal_ar / accumulation / money_flow / technical / prediction
        fetch(`/api/stocks/${enc}/unified?market=${mkt}`),
      ]);

      const [radarRes, footprintRes, predRes, shariaRes, unifiedRes] = results;

      // PRIMARY: maker-radar/stock — must succeed; otherwise we have nothing to render.
      if (radarRes.status !== 'fulfilled') {
        throw new Error(t('specialist.k_216'));
      }
      const radarJson = (await radarRes.value.json()) as MakerRadarStock;
      if (!radarJson.success || !radarJson.stock_info) {
        throw new Error(
          radarJson.error
            ? `فشل تحميل بيانات السهم: ${radarJson.error}`
            : t('specialist.k_217')
        );
      }
      setRadarData(radarJson);

      // SECONDARY: footprint (now from /api/flow — PHASE4-APIS)
      if (footprintRes.status === 'fulfilled') {
        try {
          const flowJson = await footprintRes.value.json();
          // Map /api/flow/[ticker] response → FootprintData shape.
          // flow.buy_pressure → buy_volume, flow.sell_pressure → sell_volume,
          // flow.net_flow → delta_volume; volume-profile fields (poc/vah/val/levels)
          // not available from money-flow API → null/[] (no fabrication, Rule 27).
          if (flowJson?.success && flowJson?.flow) {
            const f = flowJson.flow;
            const buyVol = Number(f.buy_pressure ?? 0);
            const sellVol = Number(f.sell_pressure ?? 0);
            setFootprint({
              success: true,
              ticker: f.ticker ?? flowJson.ticker ?? symbol,
              poc_price: undefined,
              vah_price: undefined,
              val_price: undefined,
              buy_volume: buyVol,
              sell_volume: sellVol,
              delta_volume: Number(f.net_flow ?? (buyVol - sellVol)),
              buy_sell_ratio: sellVol > 0 ? buyVol / sellVol : 0,
              total_volume: Number(f.volume ?? 0),
              value_area_volume_pct: undefined,
              levels: [],
              computed_at: new Date().toISOString(),
            } as FootprintData);
          }
        } catch { /* ignore - safe-by-design */ }
      }

      // TERTIARY: predictions
      if (predRes.status === 'fulfilled') {
        try { setPredictions(await predRes.value.json()); } catch { /* ignore - safe-by-design */ }
      }

      // ─── PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) ───────────────────
      // شيلنا الـ state handlers لـ flow / explosive / comprehensive / stockMeta.
      // الـ unified API بيوفر كل القيم المطلوبة في مكان واحد.

      if (shariaRes.status === 'fulfilled') {
        try { setSharia(await shariaRes.value.json()); } catch { /* ignore - safe-by-design */ }
      }
      // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — best-effort unified fetch.
      if (unifiedRes.status === 'fulfilled') {
        try {
          const u = await unifiedRes.value.json();
          if (u?.success) setUnified(u);
        } catch { /* ignore - safe-by-design */ }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('specialist.k_218'));
      setRadarData(null);
      console.error('[SpecialistAnalysisView] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentMarket]);

  const handleSearch = useCallback(() => {
    if (ticker.trim()) {
      fetchAnalysis(ticker.trim().toUpperCase());
    }
  }, [ticker, fetchAnalysis]);

  // ════ Derived values ════
  const info: StockInfo | null = radarData?.stock_info ?? null;
  const prices: PriceRow[] = radarData?.prices ?? [];
  const stats: RadarStats | null = radarData?.stats ?? null;

  const currentPrice = safeNum(info?.current_price);
  const support = safeNum(info?.support);
  const resistance = safeNum(info?.resistance);
  const ma50 = safeNum(info?.ma_50);
  const ma200 = safeNum(info?.ma_200);
  const signal = safeNum(info?.signal);

  // R:R from real support/resistance (Rule 67 — no fabrication)
  const computedRR =
    currentPrice != null && resistance != null && support != null && currentPrice > support
      ? (resistance - currentPrice) / (currentPrice - support)
      : null;

  // ─── Stock icon: prefer stockMeta.icon_url / logo_url, fall back to store ───
  const iconUrl =
    safeStr(stockMeta?.icon_url) ??
    safeStr(stockMeta?.logo_url) ??
    safeStr(stockMeta?.image) ??
    stocks.find((s) => s.ticker === ticker)?.icon_url ??
    null;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-white dark:bg-slate-950 min-h-screen" dir="rtl">
      {/* ════ Header ════ */}
      <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 bg-gradient-to-l from-emerald-50 via-amber-50/40 to-slate-50 dark:from-emerald-950/30 dark:via-amber-950/20 dark:to-slate-900/40 p-4 sm:p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-gradient-to-br from-emerald-500 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-md">
              <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <span>{t('specialist.k_138')}</span>
              </h1>
              <p className="text-muted-foreground mt-1 text-xs sm:text-sm">{t('specialist.k_139')}</p>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" />
            السوق: {MARKET_NAMES_AR[currentMarket] || currentMarket}
          </Badge>
        </div>
      </div>

      {/* ════ Stock Selector ════ */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-2">
            <StockSearchSelector
              value={ticker}
              onSelectStock={(val) => {
                setTicker(val);
                fetchAnalysis(val);
              }}
              placeholder={t('specialist.k_219')}
              buttonClassName="flex-1 justify-start font-normal"
            />
            <Button onClick={handleSearch} disabled={loading || !ticker} className="flex-shrink-0 gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>{t('specialist.k_140')}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ════ Error ════ */}
      {error && !loading && (
        <Card className="p-4 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-400 text-sm">{t('specialist.k_141')}</p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-1">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {/* ════ Loading skeletons ════ */}
      {loading && (
        <div className="space-y-4">
          <SkeletonCard />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <SkeletonCard />
        </div>
      )}

      {/* ════ Empty state ════ */}
      {!radarData && !loading && !error && (
        <Card className="p-6 sm:p-12 text-center bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <Activity className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-base sm:text-xl font-semibold mb-2">{t('specialist.k_142')}</h3>
          <p className="text-muted-foreground text-xs sm:text-sm max-w-md mx-auto">
            حدد سهماً من القائمة المنسدلة أعلاه للحصول على تقرير مالي احترافي بكل البيانات:
            60+ مؤشر من stock_info + 30 يوم OHLCV + بصمة السيولة + سجل التوقعات + المؤشرات الفنية والأساسية.
          </p>
        </Card>
      )}

      {/* ════ 16-SECTION PROFESSIONAL FINANCIAL REPORT ════ */}
      {radarData && info && !loading && !error && (
        <div className="space-y-4 sm:space-y-6">
          {/* ── §1. Header Card ── */}
          <HeaderCard
            info={info}
            symbol={radarData.ticker ?? ticker.toUpperCase()}
            iconUrl={iconUrl}
            sharia={sharia}
            market={info.market ?? currentMarket}
          />

          {/* ── §2. Price Summary (8 tiles from stock_info) ── */}
          <SectionCard
            icon={<TrendingUp className="w-4 h-4" />}
            title={t('specialist.attr_073')}
            description={t('specialist.attr_074')}
            accent="emerald"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <PriceTile label={t('specialist.attr_075')} value={fmtNum(info.open_price)} color="text-slate-700 dark:text-slate-200" />
              <PriceTile label={t('specialist.attr_076')} value={fmtNum(info.high_price)} color="text-emerald-600" />
              <PriceTile label={t('specialist.attr_077')} value={fmtNum(info.low_price)} color="text-red-600" />
              <PriceTile label={t('specialist.attr_078')} value={fmtNum(info.previous_close)} color="text-slate-600 dark:text-slate-300" />
              <PriceTile label={t('specialist.attr_079')} value={fmtCompact(info.volume)} color="text-amber-600" />
              <PriceTile label={t('specialist.attr_080')} value={fmtCompact(info.turnover_egp ?? info.value_traded, t('specialist.k_187'))} color="text-amber-700" />
              <PriceTile label={t('specialist.attr_052')} value={fmtNum(info.high_52w)} color="text-emerald-600" />
              <PriceTile label={t('specialist.attr_053')} value={fmtNum(info.low_52w)} color="text-red-600" />
            </div>
            {/* Distance tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <PriceTile
                label={t('specialist.attr_081')}
                value={
                  currentPrice != null && info.high_52w != null && info.high_52w > 0
                    ? `${(((currentPrice - info.high_52w) / info.high_52w) * 100).toFixed(1)}%`
                    : '—'
                }
                color={currentPrice != null && info.high_52w != null && currentPrice < info.high_52w ? 'text-red-600' : 'text-emerald-600'}
              />
              <PriceTile
                label={t('specialist.attr_082')}
                value={
                  currentPrice != null && info.low_52w != null && info.low_52w > 0
                    ? `${(((currentPrice - info.low_52w) / info.low_52w) * 100).toFixed(1)}%`
                    : '—'
                }
                color={currentPrice != null && info.low_52w != null && currentPrice > info.low_52w ? 'text-emerald-600' : 'text-red-600'}
              />
              <PriceTile
                label={t('specialist.attr_083')}
                value={fmtCompact(info.avg_volume)}
                color="text-slate-600 dark:text-slate-300"
              />
              <PriceTile
                label={t('specialist.attr_084')}
                value={fmtNum(info.beta)}
                color="text-slate-600 dark:text-slate-300"
              />
            </div>
          </SectionCard>

          {/* ── §3. 30-Day Candlestick Chart (TradingView + SVG fallback) ── */}
          <CandlestickChart
            prices={prices}
            support={support}
            resistance={resistance}
            ma50={ma50}
            ma200={ma200}
            ticker={ticker}
            market={currentMarket}
          />

          {/* ── §4. Liquidity Footprint ── */}
          {/* UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — pass canonical
              accumulation + money_flow labels down to the footprint section. */}
          <LiquidityFootprintSection
            data={footprint}
            canonicalAccumulation={unified?.canonical?.accumulation ?? null}
            canonicalMoneyFlow={unified?.canonical?.money_flow ?? null}
          />

          {/* ── §5. Technical Indicators ── */}
          <TechnicalIndicatorsSection info={info} />

          {/* ── §6. Fundamentals ── */}
          <FundamentalsSection info={info} />

          {/* ── §7. Momentum Stats ── */}
          <MomentumStatsSection stats={stats} info={info} />

          {/* ── §8. Prediction History ── */}
          <PredictionHistorySection data={predictions} />

          {/* ── §9. Recommendation ── */}
          <RecommendationSection info={info} />

          {/* ── §10. 52-Week Analysis ── */}
          <Week52AnalysisSection info={info} />

          {/* ── §11. Flow + Explosive (graceful degrade) ── */}
          <FlowExplosiveSection flow={flow} explosive={explosive} />

          {/* ── §12. Comprehensive Analysis (graceful degrade) ── */}
          <ComprehensiveAnalysisSection data={comprehensive} />

          {/* ── §13. Position Sizing Calculator ── */}
          <PositionSizingCalculator
            entryPrice={currentPrice}
            stopLoss={support}
            targetPrice={resistance}
            rrRatio={computedRR}
          />

          {/* ── §14. Price Levels Ladder ── */}
          <PriceLevelsLadderSection info={info} />

          {/* ── §15. Score Dashboard ── */}
          <ScoreDashboardSection info={info} />

          {/* ── Sharia Compliance (kept from Task 43) ── */}
          <ShariaSection data={sharia} />

          {/* ── Share ── */}
          <ShareButtons info={info} ticker={radarData.ticker ?? ticker.toUpperCase()} />

          {/* ── §16. Disclaimer ── */}
          <Card className="p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-amber-700 dark:text-amber-400 mb-1 text-sm">{t('specialist.k_143')}</h4>
                <p className="text-xs text-amber-700 dark:text-amber-500">
                  هذا التحليل لأغراض تعليمية وإعلامية فقط وليس توصية استثمارية.
                  القرار النهائي مسؤولية العميل. قرارات الاستثمار يجب أن تبنى على تقييمك الشخصي
                  ومشورة مستشار مالي محترف. الأداء السابق لا يضمن النتائج المستقبلية.
                </p>
              </div>
            </div>
          </Card>

          {/* ── Engine errors transparency (Rule 67) ── */}
          {radarData.db_source && (
            <Card className="p-3 bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700">
              <p className="text-xs text-muted-foreground">{t('specialist.k_144')}<span className="font-mono font-bold">{radarData.db_source}</span>{t('specialist.k_145')}</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default SpecialistAnalysisView;
