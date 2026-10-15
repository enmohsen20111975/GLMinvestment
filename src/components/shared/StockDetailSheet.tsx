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

interface StockData {
  ticker: string;
  name?: string;
  name_ar?: string;
  sector?: string;
  current_price?: number;
  change_pct?: number;
  change_value?: number;
  volume?: number;
  market_cap?: string;
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
                        {fmtFlow(data.whale.net_flow_egp)} EGP
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

              {/* ─── مستويات الدخول والدفاع ─── */}
              {data.entry_defense && (
                <div className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-3">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-semibold">
                      مستويات الدخول والدفاع
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">
                        الدخول
                      </span>
                      <span className="font-bold tabular-nums">
                        {fmtPrice(data.entry_defense.entry_level)}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">
                        الدفاع
                      </span>
                      <span className="font-bold tabular-nums text-amber-500">
                        {fmtPrice(data.entry_defense.defense_level)}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">
                        المقاومة
                      </span>
                      <span className="font-bold tabular-nums">
                        {fmtPrice(data.entry_defense.resistance_level)}
                      </span>
                    </div>
                  </div>
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

              {/* ─── أزرار النشر الموحّد ─── */}
              <div className="bg-card border border-border rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">نشر هذه التوصية</span>
                  <UnifiedPublishButton
                    content={`📊 ${ticker || '—'} — ${data?.name_ar || ''}
السعر: ${fmtPrice(data?.current_price)}
التغير: ${fmtPct(data?.change_pct)}
الإشارة: ${data?.signal || '—'}
${data?.entry_defense?.entry_level ? `الدخول: ${fmtPrice(data.entry_defense.entry_level)}` : ''}
${data?.entry_defense?.defense_level ? `الدفاع: ${fmtPrice(data.entry_defense.defense_level)}` : ''}

منصة دليل الاستثمار`}
                    title={`${ticker || '—'} — ${data?.name_ar || ''}`}
                    image={infographicRef}
                    filename={`${ticker || 'stock'}-analysis.png`}
                    hashtags={['EGX', 'استثمار', ticker || 'stock']}
                    variant="default"
                    size="sm"
                  />
                </div>
              </div>

              {/* ─── StockInfographicCard (مرجع للنشر) ─── */}
              <div ref={infographicRef} className="hidden">
                {/* StockInfographicCard يُعرض فقط عند الحاجة للتصدير كصورة */}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
