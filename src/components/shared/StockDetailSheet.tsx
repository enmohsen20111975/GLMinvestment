'use client';

/**
 * StockDetailSheet — تفاصيل السهم في Sheet/Drawer (بدون شاشة جديدة)
 * ============================================================================
 * ALPHA-UNIFIED (2026-10-15): مكون موحّد لعرض تفاصيل السهم عند النقر عليه
 * من أي شاشة (رادار السيولة / التوصيات / قائمة الأسهم / المحفظة).
 *
 * المميزات:
 *   - Sheet من الجانب (ديسكتوب) / Drawer من الأسفل (موبايل)
 *   - يعرض: StockInfographicCard + بيانات السيولة + UnifiedPublishButton
 *   - لا ينشئ شاشة جديدة — يُفتح فوق الشاشة الحالية
 *   - RTL محترم + dark/light mode محترم
 *
 * Usage:
 *   <StockDetailSheet ticker={selectedTicker} onClose={() => setSelectedTicker(null)} />
 *
 * أو عبر الـ store (موصى به):
 *   useAppStore.getState().openStockDetail('COMI');
 *   useAppStore.getState().closeStockDetail();
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
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { CompanyFundamentalsCard } from '@/modules/radar/components/CompanyFundamentalsCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StockInfo {
  name_ar?: string;
  sector?: string;
  current_price?: number;
  change_pct?: number;
  fair_value?: number;
  sharia_compliant?: boolean;
  whale_net_flow_5d?: number;
  liquidity_bucket?: string;
  support_level?: number | null;
  resistance_level?: number | null;
}

interface TradeSetup {
  entry_price: number;
  stop_loss: number;
  target_1: number;
  target_2?: number;
  rr_ratio: number;
  signal: string;
}

interface StockData {
  ticker: string;
  name?: string;
  name_ar?: string;
  sector?: string;
  market?: string;
  current_price?: number;
  change_pct?: number;
  change_value?: number;
  volume?: number;
  market_cap?: string;
  sharia_compliant?: boolean;
  signal?: string;
  master_score?: number;
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  rr_ratio?: number | null;
  confidence?: number;
  regime?: string;
  whale?: {
    net_flow_egp?: number;
    whale_present?: boolean;
    flow_strength?: string;
    buy_pct?: number;
    sell_pct?: number;
  };
  phase?: string;
  phase_reason?: string;
  targets_available?: boolean;
  falling_knife?: {
    is_falling_knife?: boolean;
    reason?: string;
  };
  entry_defense?: {
    entry_level?: number | null;
    defense_level?: number | null;
    resistance_level?: number | null;
  };
  // NEW: unified API state machine fields
  has_active_trade?: boolean;
  observation_status?: string;
  observation_reason?: string;
  trade_setup?: TradeSetup | null;
  stock_info?: StockInfo;
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

function getCurrency(market?: string): string {
  if (!market) return 'ج.م';
  const upper = market.toUpperCase();
  return MARKET_CURRENCY[upper] || 'ج.م';
}

interface StockDetailSheetProps {
  /** رمز السهم المراد عرض تفاصيله. null = مغلق */
  ticker: string | null;
  /** بيانات السهم الاختيارية (لو موجودة، تُستخدم مباشرة بدون API call) */
  stockData?: StockData | null;
  /** callback عند الإغلاق */
  onClose: () => void;
}

export function StockDetailSheet({ ticker, stockData, onClose }: StockDetailSheetProps) {
  const [data, setData] = useState<StockData | null>(stockData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = getCurrency(data?.market);
  const infographicRef = useRef<HTMLDivElement>(null);

  // جلب بيانات السهم من API عند فتح Sheet (لو stockData غير ممرّر)
  const fetchStockData = useCallback(async (tkr: string) => {
    if (stockData) {
      setData(stockData);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stocks/${tkr}/unified`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.success === false) {
        throw new Error(json.error || 'فشل في جلب البيانات');
      }
      setData(json.data || json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [stockData]);

  useEffect(() => {
    if (ticker) {
      fetchStockData(ticker);
    } else {
      setData(null);
      setError(null);
    }
  }, [ticker, fetchStockData]);

  const isOpen = !!ticker;

  // تنسيق الأرقام
  const fmtPrice = (v?: number | null) => {
    if (v === null || v === undefined) return '—';
    return v.toFixed(2);
  };

  const fmtFlow = (v?: number) => {
    if (!v) return '0';
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
  };

  const fmtPct = (v?: number) => {
    if (v === null || v === undefined) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  };

  const isPositive = (v?: number) => (v ?? 0) >= 0;
  const isBuySignal = ['BUY', 'STRONG_BUY', 'ACCUMULATE'].includes(
    (data?.signal || '').toUpperCase()
  );

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
                {data?.name_ar && (
                  <SheetDescription className="text-sm">
                    {data.name_ar}
                  </SheetDescription>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* السعر + التغير */}
          {data && (
            <div className="flex items-baseline gap-3 mt-3">
              <span className="text-3xl font-bold tabular-nums">
                {fmtPrice(data.current_price)}
              </span>
              {data.change_pct !== undefined && (
                <span
                  className={`text-lg font-semibold tabular-nums ${
                    isPositive(data.change_pct)
                      ? 'text-emerald-500'
                      : 'text-rose-500'
                  }`}
                >
                  {fmtPct(data.change_pct)}
                </span>
              )}
              {data.signal && (
                <Badge
                  variant={isBuySignal ? 'default' : 'destructive'}
                  className="ml-auto"
                >
                  {data.signal}
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
              {/* ═══ STATE MACHINE: has_active_trade ═══ */}
              {/* الحالة (أ): صفقة نشطة مكتملة الشروط → كارت الصفقة الأخضر */}
              {/* الحالة (ب): كاش وانتظار → كارت مراقبة مؤسسي (لا شُرَط فارغة!) */}
              {(() => {
                const trade = data.trade_setup || (data.has_active_trade === true ? {
                  entry_price: data.entry_price ?? data.entry_defense?.entry_level ?? 0,
                  stop_loss: data.stop_loss ?? data.entry_defense?.defense_level ?? 0,
                  target_1: data.target_price ?? data.entry_defense?.resistance_level ?? 0,
                  target_2: undefined,
                  rr_ratio: data.rr_ratio ?? 0,
                  signal: data.signal || 'BUY',
                } : null);
                const si = data.stock_info || {};
                const isActive = data.has_active_trade === true || (trade && trade.entry_price > 0 && trade.rr_ratio >= 1.5);
                if (isActive && trade) {
                  return (
                    <div ref={infographicRef} className="bg-gradient-to-br from-card to-emerald-500/5 border-2 border-emerald-500/20 rounded-2xl p-4 shadow-sm mb-4">
                      <div className="flex items-center justify-between mb-3 border-b border-border/50 pb-2.5">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-5 h-5 text-emerald-500" />
                          <span className="font-bold text-base text-foreground">صفقة نشطة مؤكدة</span>
                          {(data.sharia_compliant || si.sharia_compliant) && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">🟢 متوافق شرعياً</span>
                          )}
                        </div>
                        <UnifiedPublishButton
                          ticker={ticker || 'stock'}
                          content={`📊 ${ticker} — ${data.name_ar || si.name_ar || ''}\nسعر الدخول: ${fmtPrice(trade.entry_price)}\nوقف الخسارة: ${fmtPrice(trade.stop_loss)}\nالهدف 1: ${fmtPrice(trade.target_1)}\n${trade.target_2 ? `الهدف 2: ${fmtPrice(trade.target_2)}\n` : ''}نسبة R/R: 1:${Number(trade.rr_ratio).toFixed(1)}\nصافي سيولة الحيتان: ${fmtFlow(si.whale_net_flow_5d ?? data.whale?.net_flow_egp)} ${currency}\n\nمنصة دليل الاستثمار`}
                          title={`${ticker} — صفقة نشطة`}
                          image={infographicRef}
                          filename={`${ticker || 'stock'}-trade.png`}
                          hashtags={['تداول', 'استثمار', ticker || 'stock']}
                          variant="default"
                          size="sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-3">
                        <div className="bg-background/80 border border-border/60 rounded-xl p-2.5">
                          <span className="text-[11px] text-muted-foreground block mb-0.5">سعر الدخول</span>
                          <span className="font-mono tabular-nums font-bold text-base text-emerald-600 dark:text-emerald-400">{fmtPrice(trade.entry_price)}</span>
                        </div>
                        <div className="bg-background/80 border border-border/60 rounded-xl p-2.5">
                          <span className="text-[11px] text-muted-foreground block mb-0.5">وقف الخسارة</span>
                          <span className="font-mono tabular-nums font-bold text-base text-rose-600 dark:text-rose-400">{fmtPrice(trade.stop_loss)}</span>
                        </div>
                        <div className="bg-background/80 border border-border/60 rounded-xl p-2.5">
                          <span className="text-[11px] text-muted-foreground block mb-0.5">الهدف الأول</span>
                          <span className="font-mono tabular-nums font-bold text-base text-teal-600 dark:text-teal-400">{fmtPrice(trade.target_1)}</span>
                        </div>
                        <div className="bg-background/80 border border-border/60 rounded-xl p-2.5">
                          <span className="text-[11px] text-muted-foreground block mb-0.5">نسبة R/R</span>
                          <span className="font-mono tabular-nums font-bold text-base text-emerald-600 dark:text-emerald-400">1:{Number(trade.rr_ratio).toFixed(1)}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        {si.whale_net_flow_5d != null && (
                          <div className="flex items-center justify-between bg-muted/40 rounded-lg px-2.5 py-1.5">
                            <span className="text-muted-foreground">صافي سيولة الحيتان (5ج):</span>
                            <span className={`font-mono font-bold tabular-nums ${si.whale_net_flow_5d >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtFlow(si.whale_net_flow_5d)} {currency}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between bg-muted/40 rounded-lg px-2.5 py-1.5">
                          <span className="text-muted-foreground">القطاع:</span>
                          <span className="font-medium text-foreground truncate max-w-[110px]">{data.sector || si.sector || '—'}</span>
                        </div>
                        <div className="flex items-center justify-between bg-muted/40 rounded-lg px-2.5 py-1.5 col-span-2 sm:col-span-1">
                          <span className="text-muted-foreground">الإشارة:</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{trade.signal}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                // الحالة (ب): كاش وانتظار — لا شُرَط فارغة!
                return (
                  <div className="bg-muted/40 border border-border rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary">وضع المراقبة: كاش وانتظار ⏸️</Badge>
                      {(data.sharia_compliant || si.sharia_compliant) && <Badge variant="outline" className="text-emerald-500 border-emerald-500/20">🟢 متوافق شرعياً</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-foreground mb-1">{data.observation_status || 'لا توجد نقطة دخول آمنة بشروط المنصة حالياً'}</p>
                    <p className="text-xs text-muted-foreground mb-3">{data.observation_reason || 'نسبة العائد للمخاطرة غير مجزية أو السهم في مسار هابط. يُنصح بالحفاظ على السيولة ومراقبة مستويات الدعم.'}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-background rounded-lg p-2 border border-border/50">
                        <span className="text-muted-foreground block text-[10px]">السعر الحالي</span>
                        <span className="font-mono font-bold text-sm text-foreground">{fmtPrice(si.current_price ?? data.current_price)} {currency}</span>
                      </div>
                      {si.fair_value != null && (
                        <div className="bg-background rounded-lg p-2 border border-border/50">
                          <span className="text-muted-foreground block text-[10px]">القيمة العادلة</span>
                          <span className="font-mono font-bold text-sm text-teal-600">{fmtPrice(si.fair_value)}</span>
                        </div>
                      )}
                      {si.support_level != null && (
                        <div className="bg-background rounded-lg p-2 border border-border/50">
                          <span className="text-muted-foreground block text-[10px]">مستوى الدعم</span>
                          <span className="font-mono font-bold text-sm text-rose-500">{fmtPrice(si.support_level)}</span>
                        </div>
                      )}
                      {si.resistance_level != null && (
                        <div className="bg-background rounded-lg p-2 border border-border/50">
                          <span className="text-muted-foreground block text-[10px]">مستوى المقاومة</span>
                          <span className="font-mono font-bold text-sm text-emerald-500">{fmtPrice(si.resistance_level)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <Tabs defaultValue="liquidity" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="liquidity">السيولة ونبض الحيتان</TabsTrigger>
                  <TabsTrigger value="fundamentals">الميزانية والتدفقات</TabsTrigger>
                  <TabsTrigger value="chart">الرسم البياني الفني</TabsTrigger>
                </TabsList>
                <TabsContent value="liquidity" className="space-y-4 mt-4">
              {/* ─── MiniSparkline ─── */}
              <div className="bg-card border border-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    الرسم البياني المصغّر
                  </span>
                </div>
                <MiniSparkline
                  ticker={ticker || ''}
                  days={30}
                  height={60}
                  width={400}
                  showArea
                />
              </div>

              {/* ─── بيانات السيولة (Liquidity) ─── */}
              {data.whale && (
                <div className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-3">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-semibold">بيانات السيولة</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {/* صافي التدفق */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">
                        صافي التدفق
                      </span>
                      <div
                        className={`text-lg font-bold tabular-nums ${
                          (data.whale.net_flow_egp ?? 0) >= 0
                            ? 'text-emerald-500'
                            : 'text-rose-500'
                        }`}
                      >
                        {fmtFlow(data.whale.net_flow_egp)} {currency}
                      </div>
                    </div>

                    {/* قوة التدفق */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">
                        قوة التدفق
                      </span>
                      <div className="text-sm font-medium">
                        {data.whale.flow_strength || '—'}
                      </div>
                    </div>

                    {/* نسبة الشراء/البيع */}
                    {data.whale.buy_pct !== undefined && (
                      <div className="col-span-2 space-y-1">
                        <div className="flex justify-between text-xs tabular-nums">
                          <span className="text-emerald-500 font-semibold">
                            شراء {Math.round(data.whale.buy_pct)}%
                          </span>
                          <span className="text-rose-500">
                            بيع{' '}
                            {Math.round(
                              data.whale.sell_pct ?? 100 - data.whale.buy_pct
                            )}
                            %
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden flex">
                          <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${data.whale.buy_pct}%` }}
                          />
                          <div
                            className="h-full bg-rose-500 transition-all"
                            style={{
                              width: `${100 - (data.whale.buy_pct ?? 50)}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── المرحلة + السبب ─── */}
              {data.phase && (
                <div className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <BarChart3 className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-semibold">المرحلة</span>
                  </div>
                  <Badge variant="secondary" className="mb-2">
                    {data.phase}
                  </Badge>
                  {data.phase_reason && (
                    <p className="text-xs text-muted-foreground">
                      {data.phase_reason}
                    </p>
                  )}
                </div>
              )}

              {/* ─── مستويات الدخول والدفاع + R/R ─── */}
              {data.entry_defense && (
                <div className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-3">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-semibold">مستويات الدخول والدفاع</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">الدخول</span>
                      <span className="font-bold tabular-nums text-emerald-500">{fmtPrice(data.entry_defense.entry_level)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">الدفاع</span>
                      <span className="font-bold tabular-nums text-rose-500">{fmtPrice(data.entry_defense.defense_level)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">المقاومة</span>
                      <span className="font-bold tabular-nums text-teal-500">{fmtPrice(data.entry_defense.resistance_level)}</span>
                    </div>
                  </div>
                  {/* R/R Ratio */}
                  {data.rr_ratio != null && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">نسبة العائد/المخاطرة</span>
                      <span className="font-mono tabular-nums font-bold text-lg text-emerald-500">
                        1:{Number(data.rr_ratio).toFixed(1)}
                      </span>
                    </div>
                  )}
                  {/* Entry/Target/Stop from unified data */}
                  {(data.entry_price || data.target_price || data.stop_loss) && (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      {data.entry_price && (
                        <div className="text-center">
                          <span className="text-muted-foreground block">سعر الدخول</span>
                          <span className="font-mono tabular-nums font-semibold">{fmtPrice(data.entry_price)}</span>
                        </div>
                      )}
                      {data.target_price && (
                        <div className="text-center">
                          <span className="text-muted-foreground block">الهدف</span>
                          <span className="font-mono tabular-nums font-semibold text-emerald-500">{fmtPrice(data.target_price)}</span>
                        </div>
                      )}
                      {data.stop_loss && (
                        <div className="text-center">
                          <span className="text-muted-foreground block">الوقف</span>
                          <span className="font-mono tabular-nums font-semibold text-rose-500">{fmtPrice(data.stop_loss)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ─── Falling Knife Warning (Rule 78/79) ─── */}
              {data.targets_available === false && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-rose-500" />
                    <span className="text-sm font-semibold text-rose-500">
                      لا أهداف صاعدة متاحة
                    </span>
                  </div>
                  {data.falling_knife?.reason && (
                    <p className="text-xs text-rose-500/80 mt-1">
                      {data.falling_knife.reason}
                    </p>
                  )}
                </div>
              )}

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


                {/* المعطيات المؤسسية — كل الأرقام من /api/stocks/{ticker}/unified */}
                {ticker && data && (
                  <div className="flex flex-col gap-2 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      {/* السعر الحالي */}
                      <div className="bg-muted rounded-lg p-2">
                        <span className="text-xs text-muted-foreground block">السعر الحالي</span>
                        <span className="font-mono tabular-nums font-bold text-lg text-foreground">{fmtPrice(data.current_price)}</span>
                      </div>
                      {/* التغير */}
                      <div className="bg-muted rounded-lg p-2">
                        <span className="text-xs text-muted-foreground block">التغير</span>
                        <span className={`font-mono tabular-nums font-bold text-lg ${(data.change_pct ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {fmtPct(data.change_pct)}
                        </span>
                      </div>
                      {/* الدخول */}
                      {data.entry_defense && (
                        <>
                          <div className="bg-muted rounded-lg p-2">
                            <span className="text-xs text-muted-foreground block">سعر الدخول</span>
                            <span className="font-mono tabular-nums font-semibold text-emerald-500">{fmtPrice(data.entry_defense.entry_level)}</span>
                          </div>
                          {/* وقف الخسارة */}
                          <div className="bg-muted rounded-lg p-2">
                            <span className="text-xs text-muted-foreground block">وقف الخسارة</span>
                            <span className="font-mono tabular-nums font-semibold text-rose-500">{fmtPrice(data.entry_defense.defense_level)}</span>
                          </div>
                          {/* الهدف 1 (المقاومة) */}
                          <div className="bg-muted rounded-lg p-2">
                            <span className="text-xs text-muted-foreground block">الهدف 1</span>
                            <span className="font-mono tabular-nums font-semibold text-teal-500">{fmtPrice(data.entry_defense.resistance_level)}</span>
                          </div>
                          {/* الهدف 2 (من unified data) */}
                          {data.target_price != null && (
                            <div className="bg-muted rounded-lg p-2">
                              <span className="text-xs text-muted-foreground block">الهدف 2</span>
                              <span className="font-mono tabular-nums font-semibold text-teal-500">{fmtPrice(data.target_price)}</span>
                            </div>
                          )}
                        </>
                      )}
                      {/* نسبة R/R (من Python — لا حساب في الواجهة) */}
                      {data.rr_ratio != null && Number(data.rr_ratio) > 0 && (
                        <div className="bg-muted rounded-lg p-2 col-span-2">
                          <span className="text-xs text-muted-foreground block">نسبة العائد/المخاطرة (R/R)</span>
                          <span className="font-mono tabular-nums font-bold text-xl text-emerald-500">1:{Number(data.rr_ratio).toFixed(1)}</span>
                        </div>
                      )}
                      {/* صافي سيولة الحيتان */}
                      {data.whale?.net_flow_egp != null && (
                        <div className="bg-muted rounded-lg p-2 col-span-2">
                          <span className="text-xs text-muted-foreground block">صافي سيولة الحيتان</span>
                          <span className={`font-mono tabular-nums font-bold text-lg ${(data.whale.net_flow_egp ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {fmtFlow(data.whale.net_flow_egp)} {currency}
                          </span>
                        </div>
                      )}
                      {/* الإشارة */}
                      {data.signal && (
                        <div className="bg-muted rounded-lg p-2 col-span-2 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">الإشارة الفنية</span>
                          <Badge variant={data.signal.includes('BUY') ? 'default' : 'secondary'}>
                            {data.signal}
                          </Badge>
                        </div>
                      )}
                      {/* التوافق الشرعي */}
                      {data.sharia_compliant === true && (
                        <div className="bg-muted rounded-lg p-2 col-span-2 flex items-center gap-2">
                          <span className="text-xs">🟢 متوافق مع الشريعة الإسلامية</span>
                        </div>
                      )}
                      {/* القطاع */}
                      {data.sector && (
                        <div className="bg-muted rounded-lg p-2 col-span-2">
                          <span className="text-xs text-muted-foreground block">القطاع</span>
                          <span className="font-semibold text-foreground text-xs">{data.sector}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
