'use client';

/**
 * StockDetailSheet — تفاصيل السهم (State Machine: Active Trade | Observation)
 * ============================================================================
 * TASK-ALPHA-A (Owner Directive 2026-10-15): إصلاح كارثة كارت ACFR.
 *
 * الديساستر القديم: الشيت كان بيرسم مربعات دخول/وقف/هدف فاضية (—) + كارت
 * إنفوجرافيك مكرر تحت، لأنه كان بيفترض إن دايماً في صفقة نشطة.
 *
 * الحل (State Machine — حالتان لا ثالث لهما):
 *   (أ) has_active_trade === true  → كارت Hero أخضر فاخر بكل الأرقام + زر تيليجرام.
 *   (ب) has_active_trade === false → كارت مراقبة هادئ (كاش وانتظار). ممنوع مربعات فاضية.
 *
 * قراءة الحقول من /api/stocks/<ticker>/unified:
 *   - data.has_active_trade (الحاسم)
 *   - data.trade_setup { entry_price, stop_loss, target_1, target_2, rr_ratio, signal }
 *   - data.observation_status, data.observation_reason
 *   - data.stock_info { current_price, fair_value, support_level, resistance_level,
 *                       liquidity_bucket, liquidity_bucket_ar, sharia_compliant, ... }
 *   Fallback (لو Python unreachable): اقرأ من data.stock + data.technical + data.prediction.
 *
 * Rule 27: لا أرقام وهمية — كل حقل ناقص → "—" واحد بس موش مربع كامل فاضي.
 * Rule 30: emerald/teal/rose فقط.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  X,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  BarChart3,
  Loader2,
  ShieldAlert,
  Target,
  Flag,
  CircleDot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { CompanyFundamentalsCard } from '@/modules/radar/components/CompanyFundamentalsCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Types (the new canonical shape + nested fallback) ─────────────────────

interface TradeSetup {
  entry_price: number;
  stop_loss: number;
  target_1: number;
  target_2: number | null;
  rr_ratio: number;
  signal: string;
}

interface StockInfo {
  name_ar?: string | null;
  name?: string | null;
  sector?: string | null;
  market?: string | null;
  current_price?: number | null;
  change_pct?: number | null;
  fair_value?: number | null;
  sharia_compliant?: boolean | null;
  whale_net_flow_5d?: number | null;
  liquidity_bucket?: string | null;
  liquidity_bucket_ar?: string | null;
  support_level?: number | null;
  resistance_level?: number | null;
  low_52w?: number | null;
  high_52w?: number | null;
  volume?: number | null;
  avg_volume?: number | null;
}

interface UnifiedResponse {
  success: boolean;
  ticker: string;
  has_active_trade?: boolean;
  observation_status?: string | null;
  observation_reason?: string | null;
  trade_setup?: TradeSetup | null;
  stock_info?: StockInfo | null;
  // Nested fallback fields (local computation path):
  stock?: {
    ticker?: string;
    name?: string | null;
    name_ar?: string | null;
    current_price?: number | null;
    change_percent?: number | null;
    sector?: string | null;
    market?: string | null;
    volume?: number | null;
  } | null;
  technical?: {
    support?: number | null;
    resistance?: number | null;
    rsi?: number | null;
    low_52w?: number | null;
    high_52w?: number | null;
    ma_50?: number | null;
  } | null;
  canonical?: {
    signal?: string | null;
    phase?: string | null;
  } | null;
  prediction?: {
    entry_price?: number | null;
    stop_loss?: number | null;
    target_price?: number | null;
    target_price_2?: number | null;
    risk_reward?: number | null;
    signal_type?: string | null;
  } | null;
  radar?: {
    net_flow_egp?: number | null;
    buy_pct?: number | null;
    sell_pct?: number | null;
  } | null;
}

// Currency mapping per market
const MARKET_CURRENCY: Record<string, string> = {
  EGX: 'ج.م',
  TADAWUL: 'ر.س',
  KSE: 'د.ك',
  QSE: 'ر.ق',
  US: '$',
  CRYPTO: '$',
};

function getCurrency(market?: string | null): string {
  if (!market) return 'ج.م';
  const upper = market.toUpperCase();
  return MARKET_CURRENCY[upper] || 'ج.م';
}

interface StockDetailSheetProps {
  ticker: string | null;
  stockData?: unknown | null;
  onClose: () => void;
}

export function StockDetailSheet({ ticker, onClose }: StockDetailSheetProps) {
  const [data, setData] = useState<UnifiedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const infographicRef = useRef<HTMLDivElement>(null);

  const fetchStockData = useCallback(async (tkr: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stocks/${tkr}/unified`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: UnifiedResponse = await res.json();
      if (json.success === false) throw new Error('فشل في جلب البيانات');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ticker) {
      fetchStockData(ticker);
    } else {
      setData(null);
      setError(null);
    }
  }, [ticker, fetchStockData]);

  const isOpen = !!ticker;

  // ─── Derived values (read from stock_info OR nested fallback) ──────────────
  const si = data?.stock_info || null;
  const currentPrice = si?.current_price ?? data?.stock?.current_price ?? null;
  const changePct = si?.change_pct ?? data?.stock?.change_percent ?? null;
  const supportLevel = si?.support_level ?? data?.technical?.support ?? null;
  const resistanceLevel = si?.resistance_level ?? data?.technical?.resistance ?? null;
  const fairValue = si?.fair_value ?? null;
  const liquidityBucket = si?.liquidity_bucket ?? null;
  const liquidityBucketAr = si?.liquidity_bucket_ar ?? null;
  const sharia = si?.sharia_compliant ?? null;
  const market = si?.market ?? data?.stock?.market ?? null;
  const currency = getCurrency(market);
  const nameAr = si?.name_ar ?? data?.stock?.name_ar ?? data?.stock?.name ?? ticker;
  const hasActiveTrade = data?.has_active_trade === true;
  const tradeSetup = data?.trade_setup ?? null;
  const observationStatus = data?.observation_status ?? null;
  const observationReason = data?.observation_reason ?? null;

  // ─── Formatters ───────────────────────────────────────────────────────────
  const fmtPrice = (v?: number | null): string => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    return Number(v).toFixed(2);
  };
  const fmtPct = (v?: number | null): string => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    const sign = Number(v) >= 0 ? '+' : '';
    return `${sign}${Number(v).toFixed(2)}%`;
  };
  const fmtFlow = (v?: number | null): string => {
    if (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) === 0) return '0';
    const n = Number(v);
    const abs = Math.abs(n);
    const sign = n >= 0 ? '+' : '-';
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
    return `${sign}${abs.toFixed(0)}`;
  };

  const isPositive = (v?: number | null) => (v ?? 0) >= 0;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl lg:max-w-3xl overflow-y-auto p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex flex-col">
                <SheetTitle className="text-xl font-bold tabular-nums">
                  {ticker || '—'}
                </SheetTitle>
                {nameAr && (
                  <SheetDescription className="text-sm">
                    {nameAr}
                  </SheetDescription>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* السعر + التغير */}
          {data && (
            <div className="flex items-baseline gap-3 mt-3">
              <span className="text-3xl font-bold tabular-nums">
                {fmtPrice(currentPrice)}
              </span>
              {changePct !== null && changePct !== undefined && (
                <span
                  className={`text-lg font-semibold tabular-nums ${
                    isPositive(changePct) ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {fmtPct(changePct)}
                </span>
              )}
              {liquidityBucketAr && (
                <Badge variant="secondary" className="ml-auto">
                  {liquidityBucketAr}
                </Badge>
              )}
            </div>
          )}
        </SheetHeader>

        {/* المحتوى */}
        <div className="px-6 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">جارٍ التحميل...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-rose-500 text-sm">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => ticker && fetchStockData(ticker)}
              >
                إعادة المحاولة
              </Button>
            </div>
          )}

          {data && !loading && !error && (
            <>
              {/* ════════════════════════════════════════════════════════════════
                  STATE MACHINE: (أ) Active Trade — Hero Card
                  ════════════════════════════════════════════════════════════════ */}
              {hasActiveTrade && tradeSetup && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-2">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-emerald-500" />
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        صفقة نشطة — توصية شراء
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="default" className="bg-emerald-600 text-white">
                        {tradeSetup.signal}
                      </Badge>
                      {sharia === true && (
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                          🟢 متوافق شرعياً
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="bg-background rounded-lg p-2 border border-emerald-500/20 text-center">
                      <span className="text-muted-foreground block text-[10px] mb-0.5">سعر الدخول</span>
                      <span className="font-mono tabular-nums font-bold text-sm text-emerald-600 dark:text-emerald-400">
                        {fmtPrice(tradeSetup.entry_price)} {currency}
                      </span>
                    </div>
                    <div className="bg-background rounded-lg p-2 border border-rose-500/20 text-center">
                      <span className="text-muted-foreground block text-[10px] mb-0.5">وقف الخسارة</span>
                      <span className="font-mono tabular-nums font-bold text-sm text-rose-500">
                        {fmtPrice(tradeSetup.stop_loss)} {currency}
                      </span>
                    </div>
                    <div className="bg-background rounded-lg p-2 border border-teal-500/20 text-center">
                      <span className="text-muted-foreground block text-[10px] mb-0.5">الهدف 1</span>
                      <span className="font-mono tabular-nums font-bold text-sm text-teal-500">
                        {fmtPrice(tradeSetup.target_1)} {currency}
                      </span>
                    </div>
                    <div className="bg-background rounded-lg p-2 border border-teal-500/20 text-center">
                      <span className="text-muted-foreground block text-[10px] mb-0.5">الهدف 2</span>
                      <span className="font-mono tabular-nums font-bold text-sm text-teal-600">
                        {tradeSetup.target_2 ? `${fmtPrice(tradeSetup.target_2)} ${currency}` : '—'}
                      </span>
                    </div>
                  </div>

                  {/* R/R ratio — prominent */}
                  <div className="bg-background rounded-lg p-3 border border-emerald-500/20 flex items-center justify-between">
                    <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-emerald-500" />
                      نسبة العائد/المخاطرة
                    </span>
                    <span className="font-mono tabular-nums font-bold text-2xl text-emerald-500">
                      1:{Number(tradeSetup.rr_ratio).toFixed(1)}
                    </span>
                  </div>

                  {/* Unified publish button */}
                  <div className="mt-3 flex justify-end">
                    <UnifiedPublishButton
                      content={`📊 ${ticker || ''} — ${nameAr || ''}
الإشارة: ${tradeSetup.signal}
سعر الدخول: ${fmtPrice(tradeSetup.entry_price)} ${currency}
وقف الخسارة: ${fmtPrice(tradeSetup.stop_loss)} ${currency}
الهدف 1: ${fmtPrice(tradeSetup.target_1)} ${currency}
الهدف 2: ${tradeSetup.target_2 ? fmtPrice(tradeSetup.target_2) : '—'} ${currency}
R/R: 1:${Number(tradeSetup.rr_ratio).toFixed(1)}

منصة دليل الاستثمار`}
                      title={`${ticker || ''} — ${nameAr || ''}`}
                      image={infographicRef}
                      filename={`${ticker || 'stock'}-analysis.png`}
                      hashtags={['EGX', 'استثمار', ticker || 'stock']}
                      variant="default"
                      size="sm"
                    />
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════
                  STATE MACHINE: (ب) Observation — Cash & Wait Card
                  ════════════════════════════════════════════════════════════════ */}
              {!hasActiveTrade && (
                <div className="bg-muted/40 border border-border rounded-xl p-4 mb-2">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge variant="secondary" className="gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      {observationStatus || 'وضع المراقبة: كاش وانتظار ⏸️'}
                    </Badge>
                    {sharia === true && (
                      <Badge variant="outline" className="text-emerald-500 border-emerald-500/20">
                        🟢 متوافق شرعياً
                      </Badge>
                    )}
                    {liquidityBucketAr && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {liquidityBucketAr}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">
                    {observationStatus || 'وضع المراقبة: كاش وانتظار ⏸️'}
                  </p>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    {observationReason || 'لا توجد نقطة دخول آمنة بشروط المنصة حالياً. يُنصح بالحفاظ على السيولة ومراقبة مستويات الدعم.'}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-background rounded-lg p-2 border border-border/50">
                      <span className="text-muted-foreground block text-[10px]">السعر الحالي</span>
                      <span className="font-mono tabular-nums font-bold text-sm">
                        {fmtPrice(currentPrice)} {currency}
                      </span>
                    </div>
                    <div className="bg-background rounded-lg p-2 border border-border/50">
                      <span className="text-muted-foreground block text-[10px]">القيمة العادلة</span>
                      <span className="font-mono tabular-nums font-bold text-sm text-teal-500">
                        {fairValue !== null && fairValue !== undefined ? `${fmtPrice(fairValue)}` : '—'}
                      </span>
                    </div>
                    <div className="bg-background rounded-lg p-2 border border-border/50">
                      <span className="text-muted-foreground block text-[10px]">مستوى الدعم</span>
                      <span className="font-mono tabular-nums font-bold text-sm text-rose-500">
                        {fmtPrice(supportLevel)}
                      </span>
                    </div>
                    <div className="bg-background rounded-lg p-2 border border-border/50">
                      <span className="text-muted-foreground block text-[10px]">مستوى المقاومة</span>
                      <span className="font-mono tabular-nums font-bold text-sm text-emerald-500">
                        {fmtPrice(resistanceLevel)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Tabs: Liquidity / Fundamentals / Chart ─── */}
              <Tabs defaultValue="liquidity" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="liquidity">السيولة ونبض الحيتان</TabsTrigger>
                  <TabsTrigger value="fundamentals">الميزانية والتدفقات</TabsTrigger>
                  <TabsTrigger value="chart">الرسم البياني الفني</TabsTrigger>
                </TabsList>

                <TabsContent value="liquidity" className="space-y-4 mt-4">
                  {/* MiniSparkline */}
                  <div className="bg-card border border-border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-emerald-500" />
                        الرسم البياني المصغّر
                      </span>
                    </div>
                    <MiniSparkline ticker={ticker || ''} days={30} height={60} width={400} showArea />
                  </div>

                  {/* Whale flow summary (5d) */}
                  <div className="bg-card border border-border rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-3">
                      <DollarSign className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm font-semibold">صافي تدفق الحيتان (5 جلسات)</span>
                    </div>
                    <div className="text-2xl font-bold tabular-nums">
                      <span className={isPositive(si?.whale_net_flow_5d) ? 'text-emerald-500' : 'text-rose-500'}>
                        {fmtFlow(si?.whale_net_flow_5d)} {currency}
                      </span>
                    </div>
                    {liquidityBucket && (
                      <p className="text-xs text-muted-foreground mt-1">
                        التصنيف الكنسي: <span className="font-semibold">{liquidityBucketAr || liquidityBucket}</span>
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="fundamentals" className="mt-4">
                  {ticker && <CompanyFundamentalsCard ticker={ticker} />}
                </TabsContent>

                <TabsContent value="chart" className="mt-4">
                  <div className="bg-card border border-border rounded-xl p-3">
                    <MiniSparkline ticker={ticker || ''} days={90} height={120} width={500} showArea />
                  </div>
                </TabsContent>
              </Tabs>

              {/* Hidden infographic ref (only populated when there's an active trade —
                  the duplicate infographic card from the old design is REMOVED). */}
              {(hasActiveTrade && tradeSetup) && (
                <div ref={infographicRef} className="sr-only" aria-hidden="true">
                  <div className="bg-emerald-500/10 p-4 rounded-xl">
                    <p className="font-bold text-lg">{ticker} — {nameAr}</p>
                    <p>الإشارة: {tradeSetup.signal}</p>
                    <p>الدخول: {fmtPrice(tradeSetup.entry_price)} {currency}</p>
                    <p>الوقف: {fmtPrice(tradeSetup.stop_loss)} {currency}</p>
                    <p>الهدف: {fmtPrice(tradeSetup.target_1)} {currency}</p>
                    <p>R/R: 1:{Number(tradeSetup.rr_ratio).toFixed(1)}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
