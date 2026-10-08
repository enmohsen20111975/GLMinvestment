'use client';

/**
 * LiquidityFlowPanel — حركة السيولة القطاعية + تدفّق الأموال داخل الجلسة
 * ===================================================================
 * يعرض:
 *  - جدول دوران القطاعات (top 12) مع اتجاه التدفّق (داخلة/خارجة/محايدة)
 *  - قائمتين: سيولة داخلة (أخضر) | سيولة هاربة (أحمر)
 *  - شريط تقدير نوع المستثمر (مؤسسي vs أفراد) + باكتات الصفقات الكبيرة
 *  - ملخص إجمالي للسيولة وعدد القطاعات الصاعدة/الهابطة
 *
 * يقرأ currentMarket من useAppStore تلقائياً.
 * NO mock data — كل البيانات من /api/market/liquidity-flow (اللي بدوره من stocks.db).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Waves, TrendingUp, TrendingDown, Activity, Building2, Loader2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, type MarketType } from '@/lib/store';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';

interface SectorFlow {
  sector: string;
  total_turnover: number;
  total_volume: number;
  stocks_count: number;
  avg_change_pct: number;
  flow_direction: 'inflow' | 'outflow' | 'neutral';
  change_in_turnover_pct: number;
}

interface StockFlowItem {
  ticker: string;
  name_ar: string;
  sector: string;
  total_turnover: number;
  total_volume: number;
  latest_change_pct: number;
  latest_price: number;
}

interface LargeBlock {
  ticker: string;
  name_ar: string;
  sector: string;
  estimated_value: number;
}

interface LiquidityData {
  success: boolean;
  market: string;
  days: number;
  sector_flow: SectorFlow[];
  top_inflow_stocks: StockFlowItem[];
  top_outflow_stocks: StockFlowItem[];
  investor_type_estimate: {
    institutional_pct: number;
    retail_pct: number;
    block_trades_count: number;
    avg_trade_value: number;
    large_blocks: LargeBlock[];
  } | null;
  summary: {
    total_turnover: number;
    total_volume: number;
    net_flow_direction: 'inflow' | 'outflow' | 'neutral';
    advancing_sectors: number;
    declining_sectors: number;
  } | null;
  note?: string;
}

type PeriodKey = '7' | '30' | '90';
const PERIOD_LABEL: Record<PeriodKey, string> = {
  '7': '7 أيام',
  '30': '30 يوم',
  '90': '90 يوم',
};

function FlowDirectionBadge({ direction }: { direction: SectorFlow['flow_direction'] }) {
  if (direction === 'inflow') {
    return (
      <Badge className="text-[10px] bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
        <ArrowDownToLine className="w-3 h-3 ml-1" />
        داخلة
      </Badge>
    );
  }
  if (direction === 'outflow') {
    return (
      <Badge className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30 hover:bg-red-500/20">
        <ArrowUpFromLine className="w-3 h-3 ml-1" />
        خارجة
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20">
      محايدة
    </Badge>
  );
}

// ─── Columns for UnifiedTable (Sector Flow — LiquidityFlowPanel) ─────────────
// نفس أعمدة الـ table القديم بس بـ UnifiedTable (عشان الترتيب + الفلترة + الـ sort).
const sectorFlowColumns: Column<SectorFlow>[] = [
  {
    key: 'sector',
    header: 'القطاع',
    align: 'right',
    sortable: true,
    width: 'min-w-[140px]',
    className: 'font-medium',
    render: (s) => (
      <span className="truncate block max-w-[180px]" title={s.sector}>
        {s.sector}
      </span>
    ),
  },
  {
    key: 'total_turnover',
    header: 'السيولة',
    align: 'center',
    sortable: true,
    className: 'tabular-nums font-semibold',
    render: (s) => formatNumber(s.total_turnover),
  },
  {
    key: 'total_volume',
    header: 'الحجم',
    align: 'center',
    sortable: true,
    className: 'tabular-nums text-muted-foreground',
    render: (s) => formatNumber(s.total_volume),
  },
  {
    key: 'stocks_count',
    header: 'أسهم',
    align: 'center',
    sortable: true,
    className: 'tabular-nums',
  },
  {
    key: 'avg_change_pct',
    header: 'التغيّر %',
    align: 'center',
    sortable: true,
    className: 'tabular-nums font-semibold',
    render: (s) => {
      const cls = s.avg_change_pct > 0
        ? 'text-emerald-500 dark:text-emerald-400'
        : s.avg_change_pct < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground';
      return (
        <span className={cn(cls, 'font-semibold')}>
          {(s.avg_change_pct ?? 0) > 0 ? '+' : ''}
          {(s.avg_change_pct ?? 0).toFixed(2)}%
        </span>
      );
    },
  },
  {
    key: 'flow_direction',
    header: 'التدفّق',
    align: 'center',
    render: (s) => <FlowDirectionBadge direction={s.flow_direction} />,
  },
];

function StockFlowRow({ stock }: { stock: StockFlowItem }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/30 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate" title={stock.name_ar}>
          {stock.ticker}
        </div>
        <div className="text-[10px] text-muted-foreground truncate" title={stock.name_ar}>
          {stock.name_ar}
        </div>
      </div>
      <div className="text-left flex-shrink-0">
        <div className="text-[10px] text-muted-foreground">
          {formatNumber(stock.total_turnover)}
        </div>
        <div
          className={cn(
            'text-[11px] font-bold',
            stock.latest_change_pct > 0
              ? 'text-emerald-500 dark:text-emerald-400'
              : stock.latest_change_pct < 0
              ? 'text-red-600 dark:text-red-400'
              : 'text-muted-foreground'
          )}
        >
          {(stock.latest_change_pct ?? 0) > 0 ? '+' : ''}
          {(stock.latest_change_pct ?? 0).toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

export function LiquidityFlowPanel() {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const [period, setPeriod] = useState<PeriodKey>('30');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LiquidityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/market/liquidity-flow?market=${currentMarket}&days=${period}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError('تعذّر جلب البيانات. يرجى المحاولة مرة أخرى.');
        setData(null);
        return;
      }
      const json = (await res.json()) as LiquidityData;
      if (!json.success) {
        setError(json.note || 'تعذّر جلب البيانات');
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError('تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [currentMarket, period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const marketNameAr = MARKET_NAMES_AR[currentMarket];
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket];

  if (loading) {
    return (
      <Card dir="rtl" className="w-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Waves className="w-4 h-4 text-cyan-500" />
            حركة السيولة
            <Badge variant="outline" className="text-[10px]">{marketNameAr}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data || !data.summary) {
    return (
      <Card dir="rtl" className="w-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Waves className="w-4 h-4 text-cyan-500" />
            حركة السيولة
            <Badge variant="outline" className="text-[10px]">{marketNameAr}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-xs text-muted-foreground py-6">
            {error ? (
              <span className="text-red-600 dark:text-red-400">خطأ: {error}</span>
            ) : (
              'لا توجد بيانات سيولة لهذا السوق'
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const { summary, sector_flow, top_inflow_stocks, top_outflow_stocks, investor_type_estimate } = data;
  const noData = sector_flow.length === 0 && top_inflow_stocks.length === 0 && top_outflow_stocks.length === 0;

  return (
    <Card dir="rtl" className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Waves className="w-4 h-4 text-cyan-500" />
            حركة السيولة
            <Badge variant="outline" className="text-[10px] text-cyan-700 dark:text-cyan-400 border-cyan-500/30">
              {marketNameAr}
            </Badge>
            {summary.net_flow_direction === 'inflow' && (
              <Badge className="text-[10px] bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30">
                <TrendingUp className="w-3 h-3 ml-1" />
                صافي تدفّق داخلي
              </Badge>
            )}
            {summary.net_flow_direction === 'outflow' && (
              <Badge className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">
                <TrendingDown className="w-3 h-3 ml-1" />
                صافي تدفّق خارجة
              </Badge>
            )}
          </CardTitle>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="h-7 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{PERIOD_LABEL['7']}</SelectItem>
              <SelectItem value="30">{PERIOD_LABEL['30']}</SelectItem>
              <SelectItem value="90">{PERIOD_LABEL['90']}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {noData ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            لا توجد بيانات سيولة لهذا السوق في النافذة المحددة
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-[10px] text-muted-foreground">إجمالي السيولة</div>
                <div className="text-sm font-bold">{formatNumber(summary.total_turnover)} {currencyLabel}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-[10px] text-muted-foreground">إجمالي الحجم</div>
                <div className="text-sm font-bold">{formatNumber(summary.total_volume)}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-[10px] text-muted-foreground">قطاعات صاعدة</div>
                <div className="text-sm font-bold text-emerald-500 dark:text-emerald-400">{summary.advancing_sectors}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-[10px] text-muted-foreground">قطاعات هابطة</div>
                <div className="text-sm font-bold text-red-600 dark:text-red-400">{summary.declining_sectors}</div>
              </div>
            </div>

            {/* Sector rotation table */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-semibold">دوران القطاعات</span>
                <Badge variant="outline" className="text-[9px]">{sector_flow.length} قطاع</Badge>
              </div>
              <UnifiedTable<SectorFlow>
                data={sector_flow}
                columns={sectorFlowColumns}
                keyField="sector"
                maxHeight="max-h-80"
                dense
                filterable
              />
            </div>

            {/* Two columns: inflow vs outflow */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-500 dark:text-emerald-400">سيولة داخلة</span>
                </div>
                {top_inflow_stocks.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground py-2">لا توجد سيولة داخلة في النافذة الحالية</div>
                ) : (
                  <div className="max-h-56 overflow-y-auto
                                  [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent
                                  [&::-webkit-scrollbar-thumb]:bg-emerald-500/40 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {top_inflow_stocks.map((s) => (
                      <StockFlowRow key={s.ticker} stock={s} />
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ArrowUpFromLine className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400">سيولة هاربة</span>
                </div>
                {top_outflow_stocks.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground py-2">لا توجد سيولة خارجة في النافذة الحالية</div>
                ) : (
                  <div className="max-h-56 overflow-y-auto
                                  [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent
                                  [&::-webkit-scrollbar-thumb]:bg-red-500/40 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {top_outflow_stocks.map((s) => (
                      <StockFlowRow key={s.ticker} stock={s} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Investor type estimate */}
            {investor_type_estimate && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Building2 className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-xs font-semibold">تقدير نوع المستثمر</span>
                  <Badge variant="outline" className="text-[9px]">
                    {investor_type_estimate.block_trades_count} صفقة كتلة
                  </Badge>
                </div>
                <div className="rounded-md border border-border/30 bg-muted/10 p-2.5 space-y-2">
                  {/* Bar */}
                  <div className="flex h-6 w-full overflow-hidden rounded-md border border-border/40">
                    <div
                      className="bg-purple-500/70 flex items-center justify-center text-[10px] text-white font-semibold"
                      style={{ width: `${Math.max(investor_type_estimate.institutional_pct, 5)}%` }}
                      title={`مؤسسي ${investor_type_estimate.institutional_pct}%`}
                    >
                      {investor_type_estimate.institutional_pct > 12 ? `مؤسسي ${investor_type_estimate.institutional_pct}%` : ''}
                    </div>
                    <div
                      className="bg-cyan-500/60 flex items-center justify-center text-[10px] text-white font-semibold"
                      style={{ width: `${Math.max(investor_type_estimate.retail_pct, 5)}%` }}
                      title={`أفراد ${investor_type_estimate.retail_pct}%`}
                    >
                      {investor_type_estimate.retail_pct > 12 ? `أفراد ${investor_type_estimate.retail_pct}%` : ''}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>متوسط قيمة الصفقة: <span className="font-semibold text-foreground">{formatNumber(investor_type_estimate.avg_trade_value)} {currencyLabel}</span></span>
                    <span>صفقات الكتل: <span className="font-semibold text-foreground">{investor_type_estimate.block_trades_count}</span></span>
                  </div>
                  {investor_type_estimate.large_blocks.length > 0 && (
                    <div className="pt-1 border-t border-border/30">
                      <div className="text-[10px] text-muted-foreground mb-1">أكبر الصفقات المؤسسية المقدّرة:</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {investor_type_estimate.large_blocks.slice(0, 6).map((b) => (
                          <div key={b.ticker + b.estimated_value} className="flex items-center justify-between gap-1 text-[10px] py-0.5">
                            <span className="font-semibold truncate" title={b.name_ar}>{b.ticker}</span>
                            <span className="text-muted-foreground">{formatNumber(b.estimated_value)} {currencyLabel}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
