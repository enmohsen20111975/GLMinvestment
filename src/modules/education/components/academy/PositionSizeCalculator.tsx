'use client';

/**
 * academy/PositionSizeCalculator.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Practical Tools §1 — Position Size Calculator. Interactive calculator
 * that replaces the most-asked-about code block from lessons 01-12
 * (Task ID 32: owner feedback "أنت بتعرض كود برمجي حرفي لشخص مش مبرمج").
 *
 * Formula: maxShares = floor(capital × risk% / |entry − stop|).
 * Shows direction (Long vs Short), max loss, total value, % of portfolio,
 * per-share risk, and a practical note about liquidity.
 *
 * Palette: emerald + amber + slate + red (Rule 30 NO indigo/blue).
 * ============================================================================
 */

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Calculator } from 'lucide-react';

type PositionSizeResult =
  | {
      maxLoss: number;
      perShareRisk: number;
      maxShares: number;
      totalValue: number;
      positionPct: number;
      direction: string;
      error?: never;
    }
  | { error: string }
  | null;

export function PositionSizeCalculator() {
  const [capital, setCapital] = React.useState('');
  const [riskPct, setRiskPct] = React.useState('3');
  const [entryPrice, setEntryPrice] = React.useState('');
  const [stopPrice, setStopPrice] = React.useState('');

  const result = React.useMemo<PositionSizeResult>(() => {
    const cap = parseFloat(capital);
    const risk = parseFloat(riskPct);
    const entry = parseFloat(entryPrice);
    const stop = parseFloat(stopPrice);
    if (!isFinite(cap) || cap <= 0) return null;
    if (!isFinite(risk) || risk <= 0 || risk > 100) return null;
    if (!isFinite(entry) || entry <= 0) return null;
    if (!isFinite(stop) || stop <= 0) return null;
    if (entry === stop) return { error: 'سعر الدخول ووقف الخسارة لا يمكن أن يكونا متساويين' };
    const maxLoss = cap * (risk / 100);
    const perShareRisk = Math.abs(entry - stop);
    const maxShares = Math.floor(maxLoss / perShareRisk);
    const totalValue = maxShares * entry;
    const positionPct = (totalValue / cap) * 100;
    return {
      maxLoss,
      perShareRisk,
      maxShares,
      totalValue,
      positionPct,
      direction: entry > stop ? 'شراء (Long)' : 'بيع (Short)',
    };
  }, [capital, riskPct, entryPrice, stopPrice]);

  return (
    <Card className="overflow-hidden border-profit/20 via-card to-card">
      <CardHeader className="gap-2 border-b bg-profit/20 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-profit/15 text-profit ">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base sm:text-lg">حاسبة حجم الصفقة</CardTitle>
            <CardDescription className="text-xs">
              احسب الحجم الأقصى لصفقتك بناءً على المخاطرة المسموحة — قبل ما تدخل
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              رأس المال (جنيه مصري)
            </label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="100000"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              dir="ltr"
              className="text-right font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              نسبة المخاطرة (%)
            </label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="3"
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value)}
              dir="ltr"
              className="text-right font-mono"
            />
            <p className="text-xs text-muted-foreground">
              القاعدة الذهبية: ≤ 3% للصفقة، ≤ 6% إجمالي للمحفظة
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              سعر الدخول (جنيه)
            </label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="18.50"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              dir="ltr"
              className="text-right font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              سعر وقف الخسارة (جنيه)
            </label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="17.50"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              dir="ltr"
              className="text-right font-mono"
            />
          </div>
        </div>

        {result && 'error' in result ? (
          <div className="rounded-md border border-warning/20 bg-warning/10 /20 p-3 text-xs text-warning ">
            ⚠️ {result.error}
          </div>
        ) : result ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border border-profit/20 bg-profit/10 /20 p-2.5 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-profit ">
                  المخاطرة (جنيه)
                </div>
                <div className="mt-1 text-base font-bold text-profit " dir="ltr">
                  {result.maxLoss.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded-md border border-profit/20 bg-profit/10 /20 p-2.5 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-profit ">
                  الحجم الأقصى (سهم)
                </div>
                <div className="mt-1 text-base font-bold text-profit " dir="ltr">
                  {result.maxShares.toLocaleString('en-US')}
                </div>
              </div>
              <div className="rounded-md border border-slate-500/30 bg-slate-50/50 dark:bg-slate-950/20 p-2.5 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                  القيمة الإجمالية
                </div>
                <div className="mt-1 text-base font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                  {result.totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded-md border border-slate-500/30 bg-slate-50/50 dark:bg-slate-950/20 p-2.5 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                  % من المحفظة
                </div>
                <div className="mt-1 text-base font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                  {(result.positionPct ?? 0).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md border border-warning/20 bg-warning/10 /20 px-2 py-1 text-warning ">
                الاتجاه: {result.direction}
              </span>
              <span className="rounded-md border border-slate-500/30 bg-muted/40 px-2 py-1 text-muted-foreground" dir="ltr">
                المخاطرة/سهم: {(result.perShareRisk ?? 0).toFixed(3)} ج
              </span>
            </div>
            <div className="rounded-md border border-warning/20 bg-warning/10 /20 p-3 text-xs text-warning ">
              💡 <span className="font-semibold">ملاحظة عملية:</span> لو الحجم الأقصى أكبر من سيولة السهم في الـ order book → قلّل الكمية أو اختار stop أقرب لسعر الدخول. ما تدخلش بحجم يعادل أكتر من 10% من سيولة السهم اليومية.
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            أدخل القيم الأربعة (رأس المال + نسبة المخاطرة + سعر الدخول + سعر الـ Stop) لحساب الحجم الأقصى للصفقة.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
