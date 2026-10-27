'use client';

/**
 * CompanyFundamentalsCard.tsx — بطاقة الأساسيات المالية للشركة (8 تبويبات).
 *
 * (ALPHA-SCANNER-LIVE, Task 3 — owner directive 2026-10-27):
 * «أضف CompanyFundamentalsCard.tsx إلى Stock Detail View — 8 تبويبات مالية
 * (概览/现金流/资产负债表/损益表/估值/盈利能力/股息/技术分析)».
 *
 * المصدر: GET /api/maker-radar/fundamentals?ticker=X
 * الـ API بيقرا من stocks.db (64 عمود من TradingView Scanner) + fallback
 * على data_engine.db tab_* tables. يرجع 8 تبويبات:
 *   tab_valuation | tab_profitability | tab_balance_sheet | tab_income_statement
 *   tab_cash_flow | tab_dividends | tab_performance | tab_technical_analysis
 *
 * Rule 20 (financial-calc-backend-only): كل القيم من الـ backend — ما نحسبش
 * حاجة هنا. Rule 27 (NO-FAKE-DATA): القيم null → «—» (مش 0 أو رقم مزيف).
 *
 * In-Place Patching (Rule from prior work): useRef للبيانات + 3-state loading
 * (isInitialLoading / isBackgroundRefreshing / error). أول mount بس بيعرض
 * skeleton كامل؛ التحديثات الخلفية بتفضي الـ table ظاهر مع indicator خفيف.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, RefreshCw, AlertCircle, FileText } from 'lucide-react';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

interface FundamentalsTab {
  label: string;
  data: Record<string, string | null> | null;
}

interface FundamentalsResponse {
  success: boolean;
  ticker?: string;
  name_ar?: string;
  fundamentals?: Record<string, FundamentalsTab>;
  error?: string;
  message?: string;
}

export interface CompanyFundamentalsCardProps {
  ticker: string;
  /** اسم الشركة للعرض (optional — fallback على الـ ticker). */
  stockName?: string;
  /** التبويب الافتراضي. */
  defaultTab?: string;
  className?: string;
}

// ترتيب التبويبات (مطابق لتعليق الـ directive).
const TAB_ORDER = [
  'tab_valuation',
  'tab_profitability',
  'tab_balance_sheet',
  'tab_income_statement',
  'tab_cash_flow',
  'tab_dividends',
  'tab_performance',
  'tab_technical_analysis',
] as const;

// ─── Sub-components ─────────────────────────────────────────────────────────

/** صف مفتاح/قيمة واحد. null → «—» (Rule 27). */
function FundamentalsRow({ label, value }: { label: string; value: string | null }) {
  const isEmpty = value == null || value === '' || value === '—' || value === 'null';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground text-right flex-shrink-0">{label}</span>
      <span
        className={cn(
          'text-xs font-mono font-medium tabular-nums',
          isEmpty ? 'text-muted-foreground/50' : 'text-foreground',
        )}
        dir="ltr"
      >
        {isEmpty ? '—' : value}
      </span>
    </div>
  );
}

/** شبكة تبويب واحد — قائمة الصفوف. */
function TabContent({ tab }: { tab: FundamentalsTab }) {
  if (!tab || !tab.data) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        لا توجد بيانات متاحة لهذا القسم
      </div>
    );
  }
  const entries = Object.entries(tab.data);
  if (entries.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        لا توجد بيانات متاحة لهذا القسم
      </div>
    );
  }
  return (
    <div className="px-1 py-2 max-h-72 overflow-y-auto" dir="rtl">
      {entries.map(([key, val]) => (
        <FundamentalsRow key={key} label={key} value={val} />
      ))}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function CompanyFundamentalsCard({
  ticker,
  stockName,
  defaultTab = 'tab_valuation',
  className,
}: CompanyFundamentalsCardProps) {
  // In-Place Patching: useRef للبيانات عشان نحافظ عليها أثناء التحديث الخلفي.
  const dataRef = useRef<FundamentalsResponse | null>(null);
  const [data, setData] = useState<FundamentalsResponse | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(defaultTab);

  const fetchData = useCallback(
    async (isBackground = false) => {
      if (!ticker) return;
      if (isBackground) {
        setIsBackgroundRefreshing(true);
      } else {
        setIsInitialLoading(true);
      }
      setError(null);
      try {
        const res = await fetch(
          `/api/maker-radar/fundamentals?ticker=${encodeURIComponent(ticker)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as FundamentalsResponse;
        if (!json.success) {
          throw new Error(json.error || json.message || 'fetch failed');
        }
        dataRef.current = json;
        setData(json);
      } catch (e: any) {
        const msg = e?.message || String(e);
        // In-Place Patching: لا نمسح البيانات القديمة عند خطأ التحديث الخلفي.
        if (!isBackground) {
          setError(msg);
        }
        // لو فيه بيانات قديمة، نفضلها ظاهرة + نسجل الخطأ بصمت.
        if (dataRef.current == null) {
          setError(msg);
        }
      } finally {
        setIsInitialLoading(false);
        setIsBackgroundRefreshing(false);
      }
    },
    [ticker],
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  // التبويبات المتاحة فعليًا في الـ response (بعضها ممكن missing).
  const availableTabs = React.useMemo(() => {
    if (!data?.fundamentals) return [];
    return TAB_ORDER.filter((t) => data.fundamentals![t]);
  }, [data]);

  // عدّاد القيم الموجودة (للـ badge جنب العنوان).
  const filledCount = React.useMemo(() => {
    if (!data?.fundamentals) return 0;
    let count = 0;
    for (const tabKey of availableTabs) {
      const tab = data.fundamentals[tabKey];
      if (tab?.data) {
        for (const v of Object.values(tab.data)) {
          if (v != null && v !== '' && v !== '—' && v !== 'null') count++;
        }
      }
    }
    return count;
  }, [data, availableTabs]);

  const tickerLabel = stockName ? `${stockName} (${ticker})` : ticker;

  return (
    <WidgetCard
      title="الأساسيات المالية للشركة"
      icon={Building2}
      iconColor="text-primary"
      iconSize="w-4 h-4"
      titleClassName="text-base"
      contentClassName="pt-0"
      loading={isInitialLoading}
      skeletonRows={4}
      skeletonHeight="h-8"
      onRefresh={() => fetchData(true)}
      refreshing={isBackgroundRefreshing}
      className={className}
      badge={
        filledCount > 0 ? (
          <Badge variant="secondary" className="text-[10px] gap-1">
            <FileText className="w-3 h-3" />
            {filledCount} قيمة
          </Badge>
        ) : null
      }
    >
      {error && !data ? (
        <div className="py-6 flex flex-col items-center gap-2 text-center">
          <AlertCircle className="w-6 h-6 text-loss" />
          <p className="text-xs text-muted-foreground">
            تعذّر تحميل الأساسيات المالية
          </p>
          <p className="text-[10px] text-muted-foreground/70 font-mono" dir="ltr">
            {ticker}: {error}
          </p>
          <button
            onClick={() => fetchData(false)}
            className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
          >
            <RefreshCw className="w-3 h-3" />
            إعادة المحاولة
          </button>
        </div>
      ) : !data || availableTabs.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          لا توجد بيانات أساسية متاحة لهذا السهم
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          dir="rtl"
          className="w-full"
        >
          <TabsList className="w-full h-auto flex flex-wrap gap-1 bg-muted/50 p-1">
            {availableTabs.map((tabKey) => {
              const tab = data.fundamentals![tabKey];
              return (
                <TabsTrigger
                  key={tabKey}
                  value={tabKey}
                  className="text-[11px] px-2 py-1 h-auto data-[state=active]:bg-background data-[state=active]:text-primary"
                >
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {availableTabs.map((tabKey) => {
            const tab = data.fundamentals![tabKey];
            return (
              <TabsContent key={tabKey} value={tabKey} className="mt-2">
                <TabContent tab={tab} />
              </TabsContent>
            );
          })}
        </Tabs>
      )}
      {/* فوتر: آخر مصدر + ticker */}
      <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span className="font-mono" dir="ltr">{tickerLabel}</span>
        <span>المصدر: TradingView Scanner + data_engine</span>
      </div>
    </WidgetCard>
  );
}

export default CompanyFundamentalsCard;
