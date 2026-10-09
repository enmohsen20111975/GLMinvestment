'use client';

/**
 * InvestorsFlowPanel — حركة السيولة وتدفّق المستثمرين
 * ===================================================
 * بما إن مفيش جدول investors_data فعلي (بيانات المصريين/العرب/الأجانب) في الـ DB،
 * البانل ده بيعرض التحليل الحقيقي اللي بيجاوب على نفس السؤال:
 *  - فين السيولة رايحة؟ (تدفّق القطاعات: inflow/outflow)
 *  - حركة مؤسسات ولا أفراد؟ (تقدير institutional vs retail من تحليل حجم الصفقات)
 *  - الأسهم اللي بيتجمّع فيها واللي بتفرّخ منها
 *
 * مصدر البيانات: /api/market/liquidity-flow (stocks.db.stock_daily_prices JOIN stocks)
 * - مفيش أي mock data — كل الأرقام من SQLite.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Building2, User, TrendingUp, TrendingDown, Loader2, Layers, Globe2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, type MarketType } from '@/lib/store';

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
        ? 'text-emerald-500 dark:text-emerald-400'
        : s.avg_change_pct < 0
        ? 'text-red-600 dark:text-red-400'
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
            'text-[9px] px-1 py-0',
            isInflow && 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 dark:text-emerald-300',
            isOutflow && 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300',
            !isInflow && !isOutflow && 'bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-300'
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
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LiquidityFlowData | null>(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState('30');
  // Investor-flow data (Egyptians / Arabs / Foreigners buy/sell/net)
  const [invData, setInvData] = useState<InvestorsDataRow[] | null>(null);
  const [invSource, setInvSource] = useState<string>('');
  const [invAutoSeeded, setInvAutoSeeded] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [flowRes, invRes] = await Promise.all([
        fetch(`/api/market/liquidity-flow?market=${currentMarket}&days=${days}`),
        fetch(`/api/egx/investors?latest=false&days=${days}`).catch(() => null),
      ]);
      if (!flowRes.ok) {
        setError(true);
        setData(null);
      } else {
        const flowJson = (await flowRes.json()) as LiquidityFlowData;
        if (flowJson.success) {
          setData(flowJson);
        } else {
          setError(true);
          setData(null);
        }
      }
      // Investor flow data (only meaningful for EGX). Don't fail the panel if absent.
      if (invRes && invRes.ok) {
        const invJson = (await invRes.json()) as InvestorsApiResponse;
        if (invJson.success && invJson.rows && invJson.rows.length > 0) {
          setInvData(invJson.rows);
          setInvSource(invJson.source || '');
          setInvAutoSeeded(!!invJson.auto_seeded);
        } else {
          setInvData(null);
          setInvSource(invJson.source || '');
          setInvAutoSeeded(!!invJson.auto_seeded);
        }
      } else {
        setInvData(null);
      }
    } catch { // silent fallback (safe-by-design)
      setError(true);
      setData(null);
      setInvData(null);
    } finally {
      setLoading(false);
    }
  }, [currentMarket, days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const marketNameAr = MARKET_NAMES_AR[currentMarket];

  if (loading) {
    return (
      <Card dir="rtl" className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          جاري تحميل بيانات تدفّق السيولة...
        </div>
      </Card>
    );
  }

  if (error || !data || (data.sector_flow.length === 0 && data.summary.total_turnover === 0)) {
    return (
      <Card dir="rtl" className="p-4">
        <div className="text-center text-xs text-muted-foreground py-4 space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-amber-600 dark:text-amber-400">
            <Users className="w-3.5 h-3.5" />
            <span className="font-semibold">تدفّق السيولة — {marketNameAr}</span>
          </div>
          <p>لا توجد بيانات سيولة متاحة لهذا السوق حالياً</p>
          <p className="text-[10px]">
            {error
              ? `سبب التعطّل: ${error}`
              : 'بانتظار تحديث بيانات الجلسة — جرّب «تحديث» بعد دقيقة'}
          </p>
        </div>
      </Card>
    );
  }

  const inst = data.investor_type_estimate;
  const instPct = Math.round(inst.institutional_pct || 0);
  const retailPct = Math.round(inst.retail_pct || 0);

  return (
    <Card dir="rtl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Users className="w-4 h-4 text-amber-500" />
          حركة السيولة وتدفّق المستثمرين
          <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/30">
            {marketNameAr}
          </Badge>
          <div className="flex gap-1 mr-auto">
            {PERIOD_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={days === opt.value ? 'default' : 'outline'}
                className="h-6 px-2 text-[10px]"
                onClick={() => setDays(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Investor Type Split — مؤسسات vs أفراد */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1 font-medium">
              <Building2 className="w-3 h-3 text-cyan-600" />
              مؤسسات
              <span className="text-cyan-600 dark:text-cyan-400 font-bold">{instPct}%</span>
            </span>
            <span className="flex items-center gap-1 font-medium">
              <span className="text-amber-600 dark:text-amber-400 font-bold">{retailPct}%</span>
              أفراد
              <User className="w-3 h-3 text-amber-500" />
            </span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="bg-cyan-500 dark:bg-cyan-500"
              style={{ width: `${instPct}%` }}
            />
            <div
              className="bg-amber-400 dark:bg-amber-500"
              style={{ width: `${retailPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>صفقات كبيرة: {inst.block_trades_count?.toLocaleString('ar-EG') || 0}</span>
            <span>متوسط قيمة الصفقة: {fmtNum(inst.avg_trade_value || 0)}</span>
          </div>
        </div>

        {/* Sector Flow Table (UnifiedTable) */}
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground pb-1 border-b border-border/50">
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
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-500 dark:text-emerald-400">
              <TrendingUp className="w-3 h-3" />
              سيولة داخلة
            </div>
            <div className="space-y-0.5">
              {data.top_inflow_stocks.slice(0, 4).map((s) => (
                <div key={s.ticker} className="flex items-center justify-between text-[10px] py-0.5">
                  <div className="truncate" title={s.name_ar}>
                    <span className="font-bold">{s.ticker}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-emerald-500 font-semibold tabular-nums">{fmtPct(s.latest_change_pct)}</span>
                    <span className="text-muted-foreground tabular-nums">{fmtNum(s.total_turnover)}</span>
                  </div>
                </div>
              ))}
              {data.top_inflow_stocks.length === 0 && (
                <div className="text-[10px] text-muted-foreground py-1">بانتظار البيانات</div>
              )}
            </div>
          </div>

          {/* Outflow */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
              <TrendingDown className="w-3 h-3" />
              سيولة هاربة
            </div>
            <div className="space-y-0.5">
              {data.top_outflow_stocks.slice(0, 4).map((s) => (
                <div key={s.ticker} className="flex items-center justify-between text-[10px] py-0.5">
                  <div className="truncate" title={s.name_ar}>
                    <span className="font-bold">{s.ticker}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-red-600 font-semibold tabular-nums">{fmtPct(s.latest_change_pct)}</span>
                    <span className="text-muted-foreground tabular-nums">{fmtNum(s.total_turnover)}</span>
                  </div>
                </div>
              ))}
              {data.top_outflow_stocks.length === 0 && (
                <div className="text-[10px] text-muted-foreground py-1">بانتظار البيانات</div>
              )}
            </div>
          </div>
        </div>

        {/* Egyptians / Arabs / Foreigners buy/sell/net — investor-flow table */}
        {invData && invData.length > 0 && (
          <InvestorsTable rows={invData} source={invSource} autoSeeded={invAutoSeeded} />
        )}

        {/* Summary */}
        <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            إجمالي السيولة: <span className="font-bold text-foreground">{fmtNum(data.summary.total_turnover)}</span>
          </span>
          <span>
            قطاعات صاعدة: <span className="font-bold text-emerald-500">{data.summary.advancing_sectors}</span>
            {' / '}
            <span className="font-bold text-red-600">{data.summary.declining_sectors}</span> هابطة
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * InvestorsTable — جدول تدفّق المستثمرين (مصريين / عرب / أجانب)
 * يعرض آخر 3 جلسات من investors_data.
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
  const slice = rows.slice(0, 3);
  if (slice.length === 0) return null;

  const fmtM = (n: number | null): string => {
    if (n == null) return '—';
    return fmtNum(n);
  };
  const fmtNet = (n: number | null): { text: string; cls: string } => {
    if (n == null) return { text: '—', cls: 'text-muted-foreground' };
    const sign = n >= 0 ? '+' : '';
    return {
      text: `${sign}${fmtNum(n)}`,
      cls: n > 0 ? 'text-emerald-500 dark:text-emerald-400' : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
    };
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground pb-1 border-b border-border/50">
        <span className="flex items-center gap-1">
          <Globe2 className="w-3 h-3" />
          تدفّق المستثمرين (مصريين / عرب / أجانب)
        </span>
        <Badge
          variant="outline"
          className={cn(
            'text-[9px] px-1 py-0',
            autoSeeded
              ? 'text-amber-600 dark:text-amber-400 border-amber-500/30'
              : 'text-emerald-500 dark:text-emerald-400 border-emerald-500/30'
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
            <div key={r.date || i} className="rounded border border-border/40 p-1.5 text-[10px]">
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

                <div className="text-amber-600 dark:text-amber-400 font-medium">مصريين</div>
                <div className="text-center tabular-nums">{fmtM(r.individuals_buys_value)}</div>
                <div className="text-center tabular-nums">{fmtM(r.individuals_sells_value)}</div>
                <div className={cn('text-center tabular-nums font-bold', egy.cls)}>{egy.text}</div>

                <div className="text-cyan-600 dark:text-cyan-400 font-medium">عرب</div>
                <div className="text-center tabular-nums">{fmtM(r.arab_institutions_buys_value)}</div>
                <div className="text-center tabular-nums">{fmtM(r.arab_institutions_sells_value)}</div>
                <div className={cn('text-center tabular-nums font-bold', arab.cls)}>{arab.text}</div>

                <div className="text-violet-600 dark:text-violet-400 font-medium">أجانب</div>
                <div className="text-center tabular-nums">{fmtM(r.foreign_buys_value)}</div>
                <div className="text-center tabular-nums">{fmtM(r.foreign_sells_value)}</div>
                <div className={cn('text-center tabular-nums font-bold', forNet.cls)}>{forNet.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-muted-foreground pt-0.5" title={source}>
        المصدر: {source || 'stocks.db.investors_data'}
      </div>
    </div>
  );
}
