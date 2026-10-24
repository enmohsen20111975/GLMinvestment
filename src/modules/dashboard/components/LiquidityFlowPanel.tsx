'use client';

/**
 * LiquidityFlowPanel — حركة السيولة القطاعية + تدفّق الأموال داخل الجلسة
 * ===================================================================
 * يعرض:
 * - جدول دوران القطاعات (top 12) مع اتجاه التدفّق (داخلة/خارجة/محايدة)
 * - قائمتين: سيولة داخلة (أخضر) | سيولة هاربة (أحمر)
 * - شريط تقدير نوع المستثمر (مؤسسي vs أفراد) + باكتات الصفقات الكبيرة
 * - ملخص إجمالي للسيولة وعدد القطاعات الصاعدة/الهابطة
 *
 * يقرأ currentMarket من useAppStore تلقائياً.
 * NO mock data — كل البيانات من /api/market/liquidity-flow (اللي بدوره من stocks.db).
 *
 * Phase 3 (WidgetCard adoption): الـ 3 branches (loading + error + main) اتدمجوا
 * في WidgetCard واحد مع `loading` prop + badge slot للـ market + flow badges
 * + period Select، والـ summary strip الـ 4 tiles بقت WidgetStatGrid cols=4.
 * الـ error state بقا WidgetError مع onRetry=refetch.
 */

import React, { useState } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { Waves, TrendingUp, TrendingDown, Activity, Building2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, type MarketType } from '@/lib/store';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { WidgetStat, WidgetStatGrid } from '@/components/shared/WidgetStat';
import { WidgetError } from '@/components/shared/WidgetError';

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
 <Badge className="text-xs bg-profit/10 text-profit border-profit/20 hover:bg-profit/20">
 <ArrowDownToLine className="w-3 h-3 ml-1" />
 داخلة
 </Badge>
 );
 }
 if (direction === 'outflow') {
 return (
 <Badge className="text-xs bg-loss/10 text-loss border-loss/20 hover:bg-loss/20">
 <ArrowUpFromLine className="w-3 h-3 ml-1" />
 خارجة
 </Badge>
 );
 }
 return (
 <Badge className="text-xs bg-warning/10 text-warning border-warning/20 hover:bg-warning/20">
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
 ? 'text-profit '
 : s.avg_change_pct < 0
 ? 'text-loss '
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
 <div className="text-xs text-muted-foreground truncate" title={stock.name_ar}>
 {stock.name_ar}
 </div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className="text-xs text-muted-foreground">
 {formatNumber(stock.total_turnover)}
 </div>
 <div
 className={cn(
 'text-xs font-bold',
 stock.latest_change_pct > 0
 ? 'text-profit '
 : stock.latest_change_pct < 0
 ? 'text-loss '
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

 // F2.2: useApiQuery replaces manual fetch + useState + useEffect.
 // queryKey includes currentMarket + period so refetch happens when they change.
 const {
 data: raw,
 isLoading: loading,
 error: queryError,
 refetch,
 } = useApiQuery<LiquidityData>('/api/market/liquidity-flow', {
   params: { market: currentMarket, days: period },
   queryOptions: {
     refetchOnWindowFocus: false,
   },
 });

 // Derive data + error from query result (handle both success=false + network error)
 const data = raw && raw.success ? raw : null;
 const error = queryError
   ? 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'
   : (raw && !raw.success ? (raw.note || 'تعذّر جلب البيانات') : null);

 const marketNameAr = MARKET_NAMES_AR[currentMarket];
 const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket];

 if (error || !data || !data.summary) {
 return (
 <WidgetError
 title="حركة السيولة"
 message={error || 'لا توجد بيانات سيولة لهذا السوق'}
 onRetry={() => refetch()}
 className="border-border"
 />
 );
 }

 const { summary, sector_flow, top_inflow_stocks, top_outflow_stocks, investor_type_estimate } = data;
 const noData = sector_flow.length === 0 && top_inflow_stocks.length === 0 && top_outflow_stocks.length === 0;

 return (
 <WidgetCard
 title="حركة السيولة"
 icon={Waves}
 iconColor="text-whale"
 loading={loading}
 hideRefresh
 className="border-border w-full"
 headerClassName="pb-2"
 titleClassName="text-sm"
 badge={
 <>
 <Badge variant="outline" className="text-xs text-whale dark:text-whale border-whale/20">
 {marketNameAr}
 </Badge>
 {summary.net_flow_direction === 'inflow' && (
 <Badge className="text-xs bg-profit/10 text-profit border-profit/20">
 <TrendingUp className="w-3 h-3 ml-1" />
 صافي تدفّق داخلي
 </Badge>
 )}
 {summary.net_flow_direction === 'outflow' && (
 <Badge className="text-xs bg-loss/10 text-loss border-loss/20">
 <TrendingDown className="w-3 h-3 ml-1" />
 صافي تدفّق خارجة
 </Badge>
 )}
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
 </>
 }
 contentClassName="space-y-4"
 >
 {noData ? (
 <div className="text-center text-xs text-muted-foreground py-6">
 لا توجد بيانات سيولة لهذا السوق في النافذة المحددة
 </div>
 ) : (
 <>
 {/* Summary strip — adopted WidgetStatGrid (Phase 3) */}
 <WidgetStatGrid cols={4}>
 <WidgetStat label="إجمالي السيولة" value={formatNumber(summary.total_turnover)} suffix={currencyLabel} />
 <WidgetStat label="إجمالي الحجم" value={formatNumber(summary.total_volume)} />
 <WidgetStat label="قطاعات صاعدة" value={summary.advancing_sectors} valueClass="text-profit" />
 <WidgetStat label="قطاعات هابطة" value={summary.declining_sectors} valueClass="text-loss" />
 </WidgetStatGrid>

 {/* Sector rotation table */}
 <div>
 <div className="flex items-center gap-1.5 mb-1.5">
 <Activity className="w-3.5 h-3.5 text-warning" />
 <span className="text-xs font-semibold">دوران القطاعات</span>
 <Badge variant="outline" className="text-xs">{sector_flow.length} قطاع</Badge>
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
 <div className="rounded-md border border-profit/20 bg-profit/5 p-2">
 <div className="flex items-center gap-1.5 mb-1.5">
 <ArrowDownToLine className="w-3.5 h-3.5 text-profit " />
 <span className="text-xs font-semibold text-profit ">سيولة داخلة</span>
 </div>
 {top_inflow_stocks.length === 0 ? (
 <div className="text-xs text-muted-foreground py-2">لا توجد سيولة داخلة في النافذة الحالية</div>
 ) : (
 <div className="max-h-56 overflow-y-auto
 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent
 [&::-webkit-scrollbar-thumb]:bg-profit/10 [&::-webkit-scrollbar-thumb]:rounded-full">
 {top_inflow_stocks.map((s) => (
 <StockFlowRow key={s.ticker} stock={s} />
 ))}
 </div>
 )}
 </div>

 <div className="rounded-md border border-loss/20 bg-loss/5 p-2">
 <div className="flex items-center gap-1.5 mb-1.5">
 <ArrowUpFromLine className="w-3.5 h-3.5 text-loss " />
 <span className="text-xs font-semibold text-loss ">سيولة هاربة</span>
 </div>
 {top_outflow_stocks.length === 0 ? (
 <div className="text-xs text-muted-foreground py-2">لا توجد سيولة خارجة في النافذة الحالية</div>
 ) : (
 <div className="max-h-56 overflow-y-auto
 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent
 [&::-webkit-scrollbar-thumb]:bg-loss/10 [&::-webkit-scrollbar-thumb]:rounded-full">
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
 <Building2 className="w-3.5 h-3.5 text-primary" />
 <span className="text-xs font-semibold">تقدير نوع المستثمر</span>
 <Badge variant="outline" className="text-xs">
 {investor_type_estimate.block_trades_count} صفقة كتلة
 </Badge>
 </div>
 <div className="rounded-md border border-border/30 bg-muted/10 p-2.5 space-y-2">
 {/* Bar */}
 <div className="flex h-6 w-full overflow-hidden rounded-md border border-border/40">
 <div
 className="bg-primary/70 flex items-center justify-center text-xs text-foreground font-semibold"
 style={{ width: `${Math.max(investor_type_estimate.institutional_pct, 5)}%` }}
 title={`مؤسسي ${investor_type_estimate.institutional_pct}%`}
 >
 {investor_type_estimate.institutional_pct > 12 ? `مؤسسي ${investor_type_estimate.institutional_pct}%` : ''}
 </div>
 <div
 className="bg-whale/60 flex items-center justify-center text-xs text-foreground font-semibold"
 style={{ width: `${Math.max(investor_type_estimate.retail_pct, 5)}%` }}
 title={`أفراد ${investor_type_estimate.retail_pct}%`}
 >
 {investor_type_estimate.retail_pct > 12 ? `أفراد ${investor_type_estimate.retail_pct}%` : ''}
 </div>
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>متوسط قيمة الصفقة: <span className="font-semibold text-foreground">{formatNumber(investor_type_estimate.avg_trade_value)} {currencyLabel}</span></span>
 <span>صفقات الكتل: <span className="font-semibold text-foreground">{investor_type_estimate.block_trades_count}</span></span>
 </div>
 {investor_type_estimate.large_blocks.length > 0 && (
 <div className="pt-1 border-t border-border/30">
 <div className="text-xs text-muted-foreground mb-1">أكبر الصفقات المؤسسية المقدّرة:</div>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
 {investor_type_estimate.large_blocks.slice(0, 6).map((b) => (
 <div key={b.ticker + b.estimated_value} className="flex items-center justify-between gap-1 text-xs py-0.5">
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
 </WidgetCard>
 );
}
