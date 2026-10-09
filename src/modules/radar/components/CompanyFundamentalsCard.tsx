'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Building2, ChevronDown, ChevronUp, TrendingUp, DollarSign,
  BarChart3, FileText, Coins, Activity, PieChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// CompanyFundamentalsCard — بيانات الشركة المالية من 8 جداول
// ============================================================================

interface FundamentalsData {
  success: boolean;
  ticker: string;
  fundamentals: Record<string, { label: string; data: Record<string, string | null> | null }>;
}

const TABLE_ICONS: Record<string, React.ReactNode> = {
  tab_valuation: <DollarSign className="h-3.5 w-3.5" />,
  tab_profitability: <TrendingUp className="h-3.5 w-3.5" />,
  tab_balance_sheet: <Building2 className="h-3.5 w-3.5" />,
  tab_income_statement: <FileText className="h-3.5 w-3.5" />,
  tab_cash_flow: <Coins className="h-3.5 w-3.5" />,
  tab_dividends: <PieChart className="h-3.5 w-3.5" />,
  tab_performance: <Activity className="h-3.5 w-3.5" />,
  tab_technical_analysis: <BarChart3 className="h-3.5 w-3.5" />,
};

// Arabic labels for common fundamental fields
const FIELD_LABELS_AR: Record<string, string> = {
  market_cap: 'القيمة السوقية',
  market_cap_perf: 'أداء القيمة السوقية',
  pe_ratio: 'مكرر الربحية (P/E)',
  peg_ratio: 'PEG',
  ps_ratio: 'مكرر المبيعات (P/S)',
  pb_ratio: 'مكرر القيمة الدفترية (P/B)',
  pcf_ratio: 'مكرر التدفق النقدي (PCF)',
  pfcf_ratio: 'مكرر التدفق النقدي الحر (PFCF)',
  ev: 'القيمة المؤسسية (EV)',
  ev_revenue: 'EV/الإيرادات',
  ev_ebit: 'EV/EBIT',
  ev_ebitda: 'EV/EBITDA',
  gross_margin: 'هامش الربح الإجمالي',
  operating_margin: 'هامش التشغيل',
  pretax_margin: 'هامش ما قبل الضريبة',
  net_margin: 'هامش صافي الربح',
  fcf_margin: 'هامش التدفق الحر',
  roa: 'العائد على الأصول (ROA)',
  roe: 'العائد على حقوق الملكية (ROE)',
  roc: 'العائد على رأس المال (ROC)',
  total_assets: 'إجمالي الأصول',
  total_liabilities: 'إجمالي الخصوم',
  total_equity: 'حقوق الملكية',
  cash: 'النقد',
  debt: 'الديون',
  current_assets: 'الأصول المتداولة',
  current_liabilities: 'الخصوم المتداولة',
  shares_outstanding: 'الأسهم القائمة',
  revenue: 'الإيرادات',
  revenue_growth: 'نمو الإيرادات',
  gross_profit: 'الربح الإجمالي',
  operating_income: 'الدخل التشغيلي',
  net_income: 'صافي الدخل',
  eps_basic: 'ربحية السهم (أساسي)',
  eps_diluted: 'ربحية السهم (المخفف)',
  operating_cf: 'التدفق التشغيلي',
  investing_cf: 'التدفق الاستثماري',
  financing_cf: 'التدفق التمويلي',
  free_cf: 'التدفق النقدي الحر',
  dps_ttm: 'توزيعات آخر 12 شهر',
  div_yield: 'عائد التوزيعات',
  div_yield_fwd: 'عائد التوزيعات (متوقع)',
  payout_ratio: 'نسبة التوزيع',
  dps_growth: 'نمو التوزيعات',
  perf_1w: 'أداء أسبوع',
  perf_1m: 'أداء شهر',
  perf_3m: 'أداء 3 شهر',
  perf_6m: 'أداء 6 شهر',
  perf_ytd: 'أداء من بداية السنة',
  perf_1y: 'أداء سنة',
  perf_5y: 'أداء 5 سنوات',
  technical_rating: 'التقييم الفني',
  ma_rating: 'تقييم المتوسطات',
  oscillators_rating: 'تقييم المذبذبات',
  rsi: 'RSI',
  macd: 'MACD',
  stoch: 'ستوكاستيك',
  adx: 'ADX',
  atr: 'ATR',
};

function fmtField(key: string, value: string | null): { label: string; value: string; color: string } | null {
  if (value == null || value === '' || value === 'null' || value === '—') return null;
  const label = FIELD_LABELS_AR[key] || key.replace(/_/g, ' ');
  let color = 'text-foreground';

  // Color code certain fields
  if (key === 'roe' || key === 'roa' || key === 'roc') {
    const num = parseFloat(value);
    if (!isNaN(num)) color = num > 15 ? 'text-emerald-600 dark:text-emerald-400' : num > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
  }
  if (key === 'net_margin' || key === 'operating_margin' || key === 'gross_margin') {
    const num = parseFloat(value);
    if (!isNaN(num)) color = num > 20 ? 'text-emerald-600 dark:text-emerald-400' : num > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
  }
  if (key === 'debt' && value !== '0') color = 'text-rose-600 dark:text-rose-400';
  if (key === 'cash' && value !== '0') color = 'text-emerald-600 dark:text-emerald-400';
  if ((key.includes('perf_') || key === 'market_cap_perf') && value.includes('-')) color = 'text-rose-600 dark:text-rose-400';
  else if (key.includes('perf_') || key === 'market_cap_perf') color = 'text-emerald-600 dark:text-emerald-400';

  return { label, value, color };
}

export function CompanyFundamentalsCard({ ticker }: { ticker: string }) {
  const [data, setData] = useState<FundamentalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const fetchFundamentals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maker-radar/fundamentals?ticker=${ticker}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
        // Auto-expand first table that has data
        const firstWith = Object.keys(json.fundamentals).find(t => json.fundamentals[t]?.data);
        if (firstWith) setExpandedTable(firstWith);
      } else {
        setError(json.error || 'فشل تحميل البيانات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { fetchFundamentals(); }, [fetchFundamentals]);

  if (loading) {
    return (
      <Card className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="h-4 w-4 text-primary dark:text-slate-400" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="p-3 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          <span>{error || 'تعذّر تحميل بيانات الشركة'}</span>
        </div>
      </Card>
    );
  }

  // Count tables with data
  const tablesWithData = Object.entries(data.fundamentals).filter(([, v]) => v?.data && Object.keys(v.data).length > 0);
  if (tablesWithData.length === 0) {
    return (
      <Card className="p-3 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          <span>لا توجد بيانات أساسية متاحة لهذا السهم</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary dark:text-slate-400" />
          <div>
            <div className="text-xs font-semibold">بيانات الشركة المالية</div>
            <div className="text-[10px] text-muted-foreground">{tablesWithData.length} جداول متاحة</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={fetchFundamentals}
          title="تحديث"
        >
          <Activity className="h-3 w-3" />
        </Button>
      </div>

      {/* Collapsible sections per table */}
      <div className="space-y-1.5">
        {tablesWithData.map(([tableKey, tableInfo]) => {
          const isExpanded = expandedTable === tableKey;
          const fields = Object.entries(tableInfo.data!).filter(([, v]) => v != null);
          const fieldCount = fields.length;

          return (
            <div key={tableKey} className="rounded-md border border-border/50 overflow-hidden">
              {/* Header — clickable to expand/collapse */}
              <button
                onClick={() => setExpandedTable(isExpanded ? null : tableKey)}
                className="w-full flex items-center justify-between p-2 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{TABLE_ICONS[tableKey]}</span>
                  <span className="text-xs font-medium">{tableInfo.label}</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1">{fieldCount}</Badge>
                </div>
                {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
              </button>

              {/* Expanded fields */}
              {isExpanded && (
                <div className="p-2 pt-0 grid grid-cols-2 gap-1.5">
                  {fields.map(([key, value]) => {
                    const formatted = fmtField(key, value);
                    if (!formatted) return null;
                    return (
                      <div key={key} className="flex items-center justify-between text-[10px] gap-1 p-1 rounded bg-muted/20">
                        <span className="text-muted-foreground truncate">{formatted.label}</span>
                        <span className={cn('font-mono font-semibold text-right whitespace-nowrap', formatted.color)}>
                          {formatted.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
