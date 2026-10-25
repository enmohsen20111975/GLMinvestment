'use client';

/**
 * InvestorsFlowPanel — حركة السيولة وتدفّق المستثمرين
 * ===================================================
 * بما إن مفيش جدول investors_data فعلي (بيانات المصريين/العرب/الأجانب) في الـ DB،
 * البانل ده بيعرض التحليل الحقيقي اللي بيجاوب على نفس السؤال:
 * - فين السيولة رايحة؟ (تدفّق القطاعات: inflow/outflow)
 * - حركة مؤسسات ولا أفراد؟ (تقدير institutional vs retail من تحليل حجم الصفقات)
 * - الأسهم اللي بيتجمّع فيها واللي بتفرّخ منها
 *
 * مصدر البيانات: /api/market/liquidity-flow (stocks.db.stock_daily_prices JOIN stocks)
 * - مفيش أي mock data — كل الأرقام من SQLite.
 *
 * Phase 3 (WidgetCard adoption): الـ 3 branches (loading + error + main) اتدمجوا
 * في WidgetCard واحد مع `loading` prop + badge slot للـ market + period buttons،
 * والـ error state بقا WidgetError مع onRetry=refetch.
 */

import React, { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { Users, Building2, User, TrendingUp, TrendingDown, Layers, Globe2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedEmptyState } from '@/components/shared/ui';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, type MarketType } from '@/lib/store';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { WidgetError } from '@/components/shared/WidgetError';
import { Label, NumText, ChangeText, PriceValue } from '@/components/shared/ui';

// ─── ALPHA-FIX: Data freshness + holiday filtering ──────────────────────────
// EGX weekend = Friday (5) + Saturday (6). Trading days = Sunday→Thursday.
// We filter out any rows whose date falls on a weekend, and warn the user
// if the latest valid data is older than 3 trading days.

/**
 * Parse a "YYYY-MM-DD" date string as a LOCAL date (not UTC) so the weekday
 * is correct regardless of timezone. Returns null if invalid.
 */
function parseLocalDate(dateStr: string | null): Date | null {
 if (!dateStr) return null;
 const parts = dateStr.trim().split('-');
 if (parts.length !== 3) return null;
 const [y, m, d] = parts.map(Number);
 if (!y || !m || !d) return null;
 return new Date(y, m - 1, d);
}

/** Returns true if the date is Friday (5) or Saturday (6) — EGX weekend. */
function isEGXWeekend(date: Date): boolean {
 const day = date.getDay(); // 0=Sun, 5=Fri, 6=Sat
 return day === 5 || day === 6;
}

/** Returns true if a date string falls on Friday or Saturday. */
function isWeekendDateStr(dateStr: string | null): boolean {
 const date = parseLocalDate(dateStr);
 if (!date) return false;
 return isEGXWeekend(date);
}

/**
 * FRESHNESS GATE (owner directive 2026-10-22: "لو البيانات مش حديثة أخفى المكون
 * بلاش فضايح"): Returns true if `latestDate` is older than `maxStaleTradingDays`
 * EGX trading days. Counts ONLY trading days (skips Fri/Sat EGX weekend).
 * If stale → the caller hides the component (no embarrassment from old data).
 */
function isInvestorDataStale(latestDate: Date | null, maxStaleTradingDays: number = 3): boolean {
 if (!latestDate) return true; // no date = stale
 const now = new Date();
 // Walk back from today, counting trading days (skip Fri/Sat).
 let tradingDaysBack = 0;
 const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
 // If today is a weekend, the "latest trading day" is the last non-weekend day.
 while (isEGXWeekend(cursor) && tradingDaysBack < 10) {
 cursor.setDate(cursor.getDate() - 1);
 }
 for (let i = 0; i < maxStaleTradingDays + 15; i++) { // +15 buffer to be safe
 if (!isEGXWeekend(cursor)) {
 tradingDaysBack++;
 if (tradingDaysBack > maxStaleTradingDays) {
 // The latest data is older than maxStaleTradingDays trading days ago.
 return latestDate < cursor;
 }
 }
 cursor.setDate(cursor.getDate() - 1);
 }
 return true; // fallback: treat as stale if we couldn't compute
}


interface InvestorsDataRow {
 date: string | null;
 session_type: string | null;
 individuals_buys_value: number | null;
 individuals_sells_value: number | null;
 individuals_net_value: number | null;
 arab_institutions_buys_value: number | null;
 arab_institutions_sells_value: number | null;
 arab_institutions_net_value: number | null;
 foreign_buys_value: number | null;
 foreign_sells_value: number | null;
 foreign_net_value: number | null;
 total_buys_value: number | null;
 total_sells_value: number | null;
 number_of_trades: number | null;
}

interface InvestorsApiResponse {
 success: boolean;
 market: string;
 source: string;
 latest: boolean;
 days: number;
 rows: InvestorsDataRow[];
 latest_row: InvestorsDataRow | null;
 stats: {
 total_sessions: number;
 avg_individuals_net: number;
 avg_arab_net: number;
 avg_foreign_net: number;
 total_trades: number;
 };
 auto_seeded?: boolean;
}

interface SectorFlow {
 sector: string;
 total_turnover: number;
 total_volume: number;
 stocks_count: number;
 avg_change_pct: number;
 flow_direction: string;
 change_in_turnover_pct: number;
}

interface StockFlow {
 ticker: string;
 name_ar: string;
 sector: string;
 total_turnover: number;
 total_volume: number;
 latest_change_pct: number;
 latest_price: number;
}

interface InvestorTypeEstimate {
 institutional_pct: number;
 retail_pct: number;
 block_trades_count: number;
 avg_trade_value: number;
 large_blocks: StockFlow[];
}

interface LiquidityFlowData {
 success: boolean;
 market: string;
 days: number;
 sector_flow: SectorFlow[];
 top_inflow_stocks: StockFlow[];
 top_outflow_stocks: StockFlow[];
 investor_type_estimate: InvestorTypeEstimate;
 summary: {
 total_turnover: number;
 total_volume: number;
 net_flow_direction: string;
 advancing_sectors: number;
 declining_sectors: number;
 };
}

function fmtNum(n: number): string {
 const abs = Math.abs(n);
 if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
 if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
 if (abs >= 1_000) return (n / 1_000).toFixed(0) + 'K';
 return (n ?? 0).toFixed(0);
}

function fmtPct(n: number): string {
 const sign = n >= 0 ? '+' : '';
 return `${sign}${(n ?? 0).toFixed(2)}%`;
}

// ─── Columns for UnifiedTable (Sector Flow) ──────────────────────────────────
const sectorFlowColumns: Column<SectorFlow>[] = [
 {
 key: 'sector',
 header: 'القطاع',
 align: 'right',
 sortable: true,
 width: 'min-w-[140px]',
 className: 'font-medium truncate',
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
 className: 'tabular-nums text-muted-foreground',
 render: (s) => fmtNum(s.total_turnover),
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
 return <span className={cn(cls, 'font-semibold')}>{fmtPct(s.avg_change_pct)}</span>;
 },
 },
 {
 key: 'flow_direction',
 header: 'الاتجاه',
 align: 'center',
 render: (s) => {
 const isInflow = s.flow_direction === 'inflow';
 const isOutflow = s.flow_direction === 'outflow';
 return (
 <Badge
 className={cn(
 'text-xs px-1 py-0',
 isInflow && 'bg-profit/10 text-profit border-profit/20 ',
 isOutflow && 'bg-loss/10 text-loss border-loss/20 ',
 !isInflow && !isOutflow && 'bg-muted text-muted-foreground border-border'
 )}
 >
 {isInflow ? 'داخل' : isOutflow ? 'هارب' : 'محايد'}
 </Badge>
 );
 },
 },
];

const PERIOD_OPTIONS = [
 { value: '1', label: 'اليوم' },
 { value: '7', label: '7 أيام' },
 { value: '30', label: '30 يوم' },
 { value: '90', label: '90 يوم' },
];

export function InvestorsFlowPanel() {
 const currentMarket = useAppStore((s) => s.currentMarket) as MarketType;
 const [days, setDays] = useState('30');

 // F2.2: 2 useApiQuery hooks replace Promise.all + manual fetch + useState.
 // Each query cached + retried independently.

 // 1) Liquidity flow data
 const {
 data: flowRaw,
 isLoading: loadingFlow,
 error: flowError,
 refetch,
 } = useApiQuery<LiquidityFlowData>('/api/market/liquidity-flow', {
   params: { market: currentMarket, days },
   queryOptions: { refetchOnWindowFocus: false },
 });
 const data = useMemo(() => (flowRaw && flowRaw.success) ? flowRaw : null, [flowRaw]);
 const error = !!flowError || (flowRaw && !flowRaw.success);

 // 2) Investor flow data (Egyptians/Arabs/Foreigners — EGX only). Don't fail if absent.
 const { data: invRaw } = useApiQuery<InvestorsApiResponse>('/api/egx/investors', {
   params: { latest: 'false', days },
   queryOptions: { refetchOnWindowFocus: false },
 });
 const invData = useMemo(() => (invRaw?.success && invRaw.rows?.length) ? invRaw.rows : null, [invRaw]);
 const invSource = invRaw?.source ?? '';
 const invAutoSeeded = !!invRaw?.auto_seeded;

 const loading = loadingFlow;

 const marketNameAr = MARKET_NAMES_AR[currentMarket];

 if (error || !data || (data.sector_flow.length === 0 && data.summary.total_turnover === 0)) {
 return (
 <WidgetError
 title="حركة السيولة وتدفّق المستثمرين"
 message={error
 ? 'تعذّر تحميل بيانات تدفّق السيولة. يرجى المحاولة مرة أخرى.'
 : 'لا توجد بيانات سيولة متاحة لهذا السوق حالياً (بانتظار تحديث بيانات الجلسة).'}
 onRetry={() => refetch()}
 className="border-border"
 />
 );
 }

 const inst = data.investor_type_estimate;
 const instPct = Math.round(inst.institutional_pct || 0);
 const retailPct = Math.round(inst.retail_pct || 0);

 return (
 <WidgetCard
 title="حركة السيولة وتدفّق المستثمرين"
 icon={Users}
 iconColor="text-warning"
 loading={loading}
 hideRefresh
 className="border-border w-full"
 headerClassName="pb-2"
 titleClassName="text-sm flex-wrap"
 badge={
 <>
 <Badge variant="outline" className="text-xs text-warning border-warning/20">
 {marketNameAr}
 </Badge>
 <div className="flex gap-1">
 {PERIOD_OPTIONS.map((opt) => (
 <Button
 key={opt.value}
 size="sm"
 variant={days === opt.value ? 'default' : 'outline'}
 className="h-6 px-2 text-xs"
 onClick={() => setDays(opt.value)}
 >
 {opt.label}
 </Button>
 ))}
 </div>
 </>
 }
 contentClassName="space-y-3"
 >
 {/* Investor Type Split — مؤسسات vs أفراد */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between text-xs">
 <span className="flex items-center gap-1 font-medium">
 <Building2 className="w-3 h-3 text-whale" />
 مؤسسات
 <span className="text-whale font-bold">{instPct}%</span>
 </span>
 <span className="flex items-center gap-1 font-medium">
 <span className="text-warning font-bold">{retailPct}%</span>
 أفراد
 <User className="w-3 h-3 text-warning" />
 </span>
 </div>
 <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
 <div
 className="bg-whale"
 style={{ width: `${instPct}%` }}
 />
 <div
 className="bg-warning "
 style={{ width: `${retailPct}%` }}
 />
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>صفقات كبيرة: {inst.block_trades_count?.toLocaleString('ar-EG') || 0}</span>
 <span>متوسط قيمة الصفقة: {fmtNum(inst.avg_trade_value || 0)}</span>
 </div>
 </div>

 {/* Sector Flow Table (UnifiedTable) */}
 <div className="space-y-1">
 <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground pb-1 border-b border-border/50">
 <Layers className="w-3 h-3" />
 تدفّق القطاعات
 </div>
 <UnifiedTable<SectorFlow>
 columns={sectorFlowColumns}
 data={data.sector_flow.slice(0, 10)}
 keyField="sector"
 maxHeight="max-h-72"
 dense
 emptyTextAr="بانتظار تدفّق القطاعات — يظهر تلقائياً عند بدء الجلسة"
 />
 </div>

 {/* Top Buy / Sell Pressure */}
 <div className="grid grid-cols-2 gap-2">
 {/* Inflow */}
 <div className="space-y-1">
 <div className="flex items-center gap-1 text-xs font-semibold text-profit ">
 <TrendingUp className="w-3 h-3" />
 سيولة داخلة
 </div>
 <div className="space-y-0.5">
 {data.top_inflow_stocks.slice(0, 4).map((s) => (
 <div key={s.ticker} className="flex items-center justify-between text-xs py-0.5">
 <div className="truncate" title={s.name_ar}>
 <span className="font-bold">{s.ticker}</span>
 </div>
 <div className="flex items-center gap-1">
 <span className="text-profit font-semibold tabular-nums">{fmtPct(s.latest_change_pct)}</span>
 <span className="text-muted-foreground tabular-nums">{fmtNum(s.total_turnover)}</span>
 </div>
 </div>
 ))}
 {/* P0-COMPONENT-UNIFICATION Phase 2.2: UnifiedEmptyState */}
 {data.top_inflow_stocks.length === 0 && (
 <UnifiedEmptyState variant="loading" title="بانتظار البيانات" />
 )}
 </div>
 </div>
 {/* Outflow */}
 <div className="space-y-1">
 <div className="flex items-center gap-1 text-xs font-semibold text-loss ">
 <TrendingDown className="w-3 h-3" />
 سيولة هاربة
 </div>
 <div className="space-y-0.5">
 {data.top_outflow_stocks.slice(0, 4).map((s) => (
 <div key={s.ticker} className="flex items-center justify-between text-xs py-0.5">
 <div className="truncate" title={s.name_ar}>
 <span className="font-bold">{s.ticker}</span>
 </div>
 <div className="flex items-center gap-1">
 <span className="text-loss font-semibold tabular-nums">{fmtPct(s.latest_change_pct)}</span>
 <span className="text-muted-foreground tabular-nums">{fmtNum(s.total_turnover)}</span>
 </div>
 </div>
 ))}
 {/* P0-COMPONENT-UNIFICATION Phase 2.2: UnifiedEmptyState */}
 {data.top_outflow_stocks.length === 0 && (
 <UnifiedEmptyState variant="loading" title="بانتظار البيانات" />
 )}
 </div>
 </div>
 </div>

 {/* Egyptians / Arabs / Foreigners buy/sell/net — investor-flow table */}
 {invData && invData.length > 0 && (() => {
 // ALPHA-FIX: filter out Friday/Saturday rows (EGX weekend — no trading)
 const filteredRows = invData.filter((r) => !isWeekendDateStr(r.date));
 if (filteredRows.length === 0) return null;
 // FRESHNESS GATE (owner directive 2026-10-22): hide the table entirely if the
 // latest data is older than 3 EGX trading days. No embarrassment from stale
 // data (e.g. showing 2026-09-24 when today is 2026-10-22). Better to show
 // nothing than to show old data and mislead users.
 const latestDate = parseLocalDate(filteredRows[0].date);
 if (isInvestorDataStale(latestDate, 3)) {
 return null; // hide — data is stale
 }
 return (
 <InvestorsTable rows={filteredRows} source={invSource} autoSeeded={invAutoSeeded} />
 );
 })()}

 {/* Summary */}
 <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
 <span>
 إجمالي السيولة: <span className="font-bold text-foreground">{fmtNum(data.summary.total_turnover)}</span>
 </span>
 <span>
 قطاعات صاعدة: <span className="font-bold text-profit">{data.summary.advancing_sectors}</span>
 {' / '}
 <span className="font-bold text-loss">{data.summary.declining_sectors}</span> هابطة
 </span>
 </div>
 </WidgetCard>
 );
}

/**
 * InvestorsTable — جدول تدفّق المستثمرين (مصريين / عرب / أجانب)
 * يعرض آخر 5 جلسات من investors_data. الجدول دائماً يظهر بالبيانات
 * الحقيقية المتاحة — لا fabrication ولا إخفاء بتحذيرات وهمية (Rule 27).
 */
function InvestorsTable({
 rows,
 source,
 autoSeeded,
}: {
 rows: InvestorsDataRow[];
 source: string;
 autoSeeded: boolean;
}) {
 // الجدول دائماً يظهر بالبيانات الحقيقية المتاحة (Rule 27 NO-FAKE-DATA).
 const slice = rows.slice(0, 5);
 if (slice.length === 0) return null;

 // SANITY CHECK (2026-10-22): if the latest row's values are suspiciously small
 // (< 10,000), the scraper parsed wrong numbers from the EGX page. EGX investor
 // flow values are in hundreds of millions to billions of EGP. If we see values
 // like 2, -1, -72 → garbage. Hide the table, don't show garbage to the client.
 const latest = slice[0];
 const maxAbs = Math.max(
 Math.abs(latest.individuals_buys_value ?? 0),
 Math.abs(latest.individuals_sells_value ?? 0),
 Math.abs(latest.arab_buys_value ?? 0),
 Math.abs(latest.arab_sells_value ?? 0),
 Math.abs(latest.foreign_buys_value ?? 0),
 Math.abs(latest.foreign_sells_value ?? 0),
 );
 if (maxAbs < 10000) {
 // Garbage data — hide the table entirely.
 return null;
 }

 const fmtM = (n: number | null): string => {
 if (n == null) return '—';
 return fmtNum(n);
 };
 const fmtNet = (n: number | null): { text: string; cls: string } => {
 if (n == null) return { text: '—', cls: 'text-muted-foreground' };
 const sign = n >= 0 ? '+' : '';
 return {
 text: `${sign}${fmtNum(n)}`,
 cls: n > 0 ? 'text-profit ' : n < 0 ? 'text-loss ' : 'text-muted-foreground',
 };
 };

 return (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground pb-1 border-b border-border/50">
 <span className="flex items-center gap-1">
 <Globe2 className="w-3 h-3" />
 تدفّق المستثمرين (مصريين / عرب / أجانب)
 </span>
 <Badge
 variant="outline"
 className={cn(
 'text-xs px-1 py-0',
 autoSeeded
 ? 'text-warning border-warning/20'
 : 'text-profit border-profit/20'
 )}
 title={source}
 >
 {autoSeeded ? 'تقدير محسوب' : 'بيانات رسمية'}
 </Badge>
 </div>
 <div className="max-h-60 overflow-y-auto pr-1 -mr-1 custom-scrollbar space-y-1.5">
 {slice.map((r, i) => {
 const egy = fmtNet(r.individuals_net_value);
 const arab = fmtNet(r.arab_institutions_net_value);
 const forNet = fmtNet(r.foreign_net_value);
 return (
 <div key={r.date || i} className="rounded border border-border/40 p-1.5 text-xs">
 <div className="flex items-center justify-between mb-1">
 <span className="font-semibold text-foreground">{r.date}</span>
 {r.number_of_trades != null && (
 <span className="text-muted-foreground tabular-nums">
 صفقات: {(r.number_of_trades / 1000).toFixed(0)}K
 </span>
 )}
 </div>
 <div className="grid grid-cols-4 gap-1 items-center">
 <div className="text-muted-foreground">النوع</div>
 <div className="text-center tabular-nums text-muted-foreground">شراء</div>
 <div className="text-center tabular-nums text-muted-foreground">بيع</div>
 <div className="text-center tabular-nums text-muted-foreground">صافي</div>

 <div className="text-warning font-medium">مصريين</div>
 <div className="text-center tabular-nums">{fmtM(r.individuals_buys_value)}</div>
 <div className="text-center tabular-nums">{fmtM(r.individuals_sells_value)}</div>
 <div className={cn('text-center tabular-nums font-bold', egy.cls)}>{egy.text}</div>

 <div className="text-whale font-medium">عرب</div>
 <div className="text-center tabular-nums">{fmtM(r.arab_institutions_buys_value)}</div>
 <div className="text-center tabular-nums">{fmtM(r.arab_institutions_sells_value)}</div>
 <div className={cn('text-center tabular-nums font-bold', arab.cls)}>{arab.text}</div>

 <div className="text-info font-medium">أجانب</div>
 <div className="text-center tabular-nums">{fmtM(r.foreign_buys_value)}</div>
 <div className="text-center tabular-nums">{fmtM(r.foreign_sells_value)}</div>
 <div className={cn('text-center tabular-nums font-bold', forNet.cls)}>{forNet.text}</div>
 </div>
 </div>
 );
 })}
 </div>
 <div className="text-xs text-muted-foreground pt-0.5" title={source}>
 {/* Source hidden — client doesn't need to see internal data source */}
 </div>
 </div>
 );
}
