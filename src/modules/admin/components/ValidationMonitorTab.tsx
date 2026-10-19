'use client';

/**
 * ValidationMonitorTab
 * ===================
 * Task 28-B (Fix 3 — Fix Battalion):
 *   Admin UI for the Data Validation Layer (Rule 65 — DATA-VALIDATION-LAYER).
 *
 *   Surfaces the count of stocks with INVALID fields, ranks which fields
 *   fail most often, and shows recently-nullified support/resistance
 *   findings (the CRST-class bug from Rule 65).
 *
 *   Fetches /api/admin/validation which mirrors vps-service/data/validation.py
 *   logic in TypeScript (read-only — Rule 20).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  ShieldCheck, RefreshCw, AlertTriangle, XCircle, CheckCircle2,
  Activity, Bug, Layers, FileWarning,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Status = 'VALID' | 'INVALID' | 'SUSPECT' | 'MISSING';

interface ValidationResponse {
  success: boolean;
  error?: string;
  detail?: string;
  timestamp?: string;
  source?: string;
  total_stocks?: number;
  total_invalid_tickers?: number;
  summary?: Record<string, Record<Status, number>>;
  fields_by_invalid_count?: Array<{
    field: string;
    invalid_count: number;
    suspect_count: number;
    missing_count: number;
  }>;
  top_invalid_tickers?: Array<{
    ticker: string;
    name_ar: string | null;
    market: string | null;
    current_price: number | null;
    invalid_count: number;
    findings: Array<{ field: string; status: Status; value: number | null; reason: string }>;
  }>;
  recent_nullified?: Array<{
    ticker: string;
    field: string;
    value: number | null;
    reason: string;
    market: string | null;
  }>;
}

const FIELD_LABELS_AR: Record<string, string> = {
  current_price: 'السعر الحالي',
  high_52w: 'أعلى 52 أسبوع',
  low_52w: 'أدنى 52 أسبوع',
  support: 'الدعم',
  resistance: 'المقاومة',
  ma_50: 'المتوسط 50',
  ma_200: 'المتوسط 200',
  rsi: 'RSI',
};

const STATUS_COLORS: Record<Status, string> = {
  VALID: 'bg-profit',
  INVALID: 'bg-loss',
  SUSPECT: 'bg-warning',
  MISSING: 'bg-sky-500',
};

const STATUS_LABELS_AR: Record<Status, string> = {
  VALID: 'سليم',
  INVALID: 'باطل',
  SUSPECT: 'مشبوه',
  MISSING: 'مفقود',
};

export function ValidationMonitorTab() {
  const [data, setData] = useState<ValidationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchValidation = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/validation', { credentials: 'same-origin', cache: 'no-store' });
      const json: ValidationResponse = await res.json();
      setData(json);
      if (!json.success) {
        toast.error(json.error || 'فشل تحميل بيانات التحقق');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchValidation();
  }, [fetchValidation]);

  const totalStocks = data?.total_stocks ?? 0;
  const totalInvalidTickers = data?.total_invalid_tickers ?? 0;
  const totalFields = data?.fields_by_invalid_count?.length ?? 0;
  const totalNullified = data?.recent_nullified?.length ?? 0;
  const invalidPct = totalStocks > 0 ? Math.round((totalInvalidTickers / totalStocks) * 100) : 0;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <Card className="border-profit dark:border-profit/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="w-5 h-5 text-profit" />
                مراقبة التحقق — Rule 65
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                مرآة لـ vps-service/data/validation.py — عدد الحقول الباطلة لكل سهم + الحقول الأكثر فشلاً + آخر الحقول المخفّرة (دعم/مقاومة).
              </CardDescription>
            </div>
            <Button onClick={fetchValidation} disabled={loading} variant="ghost" size="sm" className="gap-2">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="إجمالي الأسهم المُتحقَّق منها"
          value={totalStocks}
          icon={<Activity className="w-4 h-4 text-profit" />}
        />
        <StatBox
          label="أسهم بحقول باطلة"
          value={totalInvalidTickers}
          sub={`${invalidPct}% من الإجمالي`}
          icon={<XCircle className="w-4 h-4 text-loss" />}
        />
        <StatBox
          label="الحقول المراقَبة"
          value={totalFields}
          icon={<Layers className="w-4 h-4 text-sky-500" />}
        />
        <StatBox
          label="حقول مخفّرة (دعم/مقاومة)"
          value={totalNullified}
          icon={<FileWarning className="w-4 h-4 text-warning" />}
        />
      </div>

      {/* Loading */}
      {loading && !data && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {!loading && data && !data.success && (
        <Card className="border-loss bg-loss dark:bg-loss/20 dark:border-loss/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-loss shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-loss dark:text-loss">فشل تحميل بيانات التحقق</p>
              <p className="text-xs text-muted-foreground mt-1">{data.error}</p>
              {data.detail && (
                <p className="text-[11px] text-muted-foreground mt-1" dir="ltr">{data.detail}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Critical alert */}
      {data?.success && invalidPct > 30 && (
        <Card className="border-loss bg-loss dark:bg-loss/20 dark:border-loss/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-loss shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-loss dark:text-loss">
                {invalidPct}% من الأسهم بها حقول باطلة — جودة البيانات منخفضة
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                راجع السكرابرز والمصادر الكنسية. الحقول الباطلة تُخفّر تلقائياً من التحليل لكنها قد تشير إلى مشكلة أعمق (مصدر ملوّث، بيانات قديمة، تلوث بين الأسهم).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fields by INVALID count */}
      {data?.success && data.fields_by_invalid_count && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bug className="w-4 h-4 text-loss" />
              الحقول الأكثر إخفاقاً (مرتبة حسب INVALID)
            </CardTitle>
            <CardDescription className="text-xs">
              لكل حقل: عدد الباطل (INVALID) + المشبوه (SUSPECT) + المفقود (MISSING) + السليم (VALID).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.fields_by_invalid_count.map((f) => {
                const summary = data.summary?.[f.field];
                if (!summary) return null;
                const total = (summary.VALID || 0) + (summary.INVALID || 0)
                  + (summary.SUSPECT || 0) + (summary.MISSING || 0);
                const validPct = total > 0 ? (summary.VALID / total) * 100 : 0;
                return (
                  <div key={f.field} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{FIELD_LABELS_AR[f.field] || f.field}</span>
                        <code className="text-[10px] text-muted-foreground" dir="ltr">{f.field}</code>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px] border-loss text-loss">
                          {f.invalid_count} باطل
                        </Badge>
                        <Badge variant="outline" className="text-[9px] border-warning text-warning">
                          {f.suspect_count} مشبوه
                        </Badge>
                        <Badge variant="outline" className="text-[9px] border-sky-500 text-sky-700">
                          {f.missing_count} مفقود
                        </Badge>
                      </div>
                    </div>
                    {/* Stacked bar */}
                    <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                      {(['VALID', 'INVALID', 'SUSPECT', 'MISSING'] as Status[]).map(s => {
                        const count = summary[s] || 0;
                        const pct = total > 0 ? (count / total) * 100 : 0;
                        if (pct === 0) return null;
                        return (
                          <div
                            key={s}
                            className={cn('h-full', STATUS_COLORS[s])}
                            style={{ width: `${pct}%` }}
                            title={`${STATUS_LABELS_AR[s]}: ${count} (${(pct ?? 0).toFixed(1)}%)`}
                          />
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      سليم: {summary.VALID || 0} ({(validPct ?? 0).toFixed(1)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top invalid tickers */}
      {data?.success && data.top_invalid_tickers && data.top_invalid_tickers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <XCircle className="w-4 h-4 text-loss" />
              أكثر الأسهم إخفاقاً ({data.top_invalid_tickers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="text-right border-b">
                    <th className="p-2 font-medium">الرمز</th>
                    <th className="p-2 font-medium">السوق</th>
                    <th className="p-2 font-medium">السعر</th>
                    <th className="p-2 font-medium">إخفاقات</th>
                    <th className="p-2 font-medium">الحقول الباطلة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_invalid_tickers.map((t) => (
                    <tr key={t.ticker} className="border-b hover:bg-muted/30">
                      <td className="p-2">
                        <div className="font-mono font-bold" dir="ltr">{t.ticker}</div>
                        {t.name_ar && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[12rem]">{t.name_ar}</div>
                        )}
                      </td>
                      <td className="p-2">
                        {t.market && <Badge variant="outline" className="text-[10px]">{t.market}</Badge>}
                      </td>
                      <td className="p-2 font-mono" dir="ltr">
                        {t.current_price !== null ? (t.current_price ?? 0).toFixed(2) : '—'}
                      </td>
                      <td className="p-2">
                        <Badge variant="destructive" className="text-[10px]">{t.invalid_count}</Badge>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {t.findings
                            .filter(f => f.status === 'INVALID' || f.status === 'SUSPECT')
                            .slice(0, 4)
                            .map((f, i) => (
                              <Badge
                                key={i}
                                variant="outline"
                                className={cn(
                                  'text-[9px]',
                                  f.status === 'INVALID'
                                    ? 'border-loss text-loss'
                                    : 'border-warning text-warning',
                                )}
                                title={f.reason}
                              >
                                {FIELD_LABELS_AR[f.field] || f.field}
                              </Badge>
                            ))}
                          {t.findings.filter(f => f.status === 'INVALID' || f.status === 'SUSPECT').length > 4 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{t.findings.filter(f => f.status === 'INVALID' || f.status === 'SUSPECT').length - 4}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recently nullified findings */}
      {data?.success && data.recent_nullified && data.recent_nullified.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-warning" />
              آخر الحقول المخفّرة (دعم/مقاومة باطل)
            </CardTitle>
            <CardDescription className="text-xs">
              هذه الحقول ستُمنع من التأثير على الـ score والتوقّع (Rule 24: INVALID &gt; fake).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <div className="space-y-2">
                {data.recent_nullified.slice(0, 30).map((n, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-lg border border-warning bg-warning dark:bg-warning/20 dark:border-warning/40 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold" dir="ltr">{n.ticker}</span>
                        {n.market && <Badge variant="outline" className="text-[9px]">{n.market}</Badge>}
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[9px]',
                            n.field === 'support'
                              ? 'border-loss text-loss'
                              : 'border-loss text-loss',
                          )}
                        >
                          {FIELD_LABELS_AR[n.field] || n.field}
                        </Badge>
                      </div>
                      <span className="font-mono text-[11px]" dir="ltr">
                        value: {n.value !== null ? (n.value ?? 0).toFixed(2) : 'null'}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground" dir="ltr">{n.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data?.success && totalInvalidTickers === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-profit" />
            <p className="font-bold text-profit">كل البيانات سليمة</p>
            <p className="text-xs mt-1">لا توجد حقول باطلة أو مشبوهة في {totalStocks} سهم.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helper                                       */
/* ------------------------------------------------------------------ */

function StatBox({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
