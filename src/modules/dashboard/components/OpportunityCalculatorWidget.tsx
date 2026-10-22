'use client';

/**
 * OpportunityCalculatorWidget — "لو كنت مالك السهم"
 * ====================================================================
 * FIX (owner directive — "الجرعة التخفيذية" للعميل الجديد):
 *
 * بدل ما نعرض محفظة demo وهمية (مخالفة Rule 27)، نعرض **حاسبة فرصة واقعية**
 * ببيانات حقيقية 100% من top gainers اليوم:
 *   - السعر الحالي + التغيّر %
 *   - "لو كنت مالك 100 سهم من امبارح، كنت كسبت كام"
 *   - CTA واضح: "ابدأ محفظتك الحقيقية مجانًا"
 *
 * Rule 27 SAFE — كل الأرقام بيانات حقيقية، الـ "100 سهم" هي quantity افتراضية
 * لعرض القيمة الحسابية (مش ادعاء ملكية). واضح إنه "لو كنت مالك" مش "أنت مالك".
 *
 * البيانات: من useAppStore.marketOverview.gainers (نفس مصدر LiveMonitor).
 * مش بـ fetch تاني — Rule 20 (Python=Brain) + صفر overhead على الـ backend.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Sparkles, ArrowLeft, Wallet } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

// assumed hypothetical quantity for the "what if" calculation
const HYPOTHETICAL_QTY = 100;

interface GainerStock {
  ticker: string;
  name: string;
  current_price: number;
  change_percent: number;
  volume: number;
  updated_at: string;
}

export function OpportunityCalculatorWidget() {
  const marketOverview = useAppStore((s) => s.marketOverview);
  const currentMarket = useAppStore((s) => s.currentMarket);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedTicker = useAppStore((s) => s.setSelectedTicker);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // gainers from marketOverview (same data LiveMonitor uses — no extra fetch)
  const gainers: GainerStock[] = (marketOverview as any)?.gainers || [];
  const top3 = gainers.slice(0, 3);

  if (top3.length === 0) {
    // No data yet (market closed / weekend / loading) — render nothing, don't fake it.
    // Rule 27: ممنوع نعرض أرقام لو مفيش بيانات حقيقية.
    return (
      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-profit/10">
              <Sparkles className="h-4 w-4 text-profit" />
            </div>
            <div>
              <CardTitle className="text-base">لو كنت مالك السهم ده</CardTitle>
              <CardDescription className="text-xs">فرص النهاردة</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            بيانات السوق غير متاحة دلوقتي — هتظهر الفرص تلقائيًا وقت الجلسة.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Calculate hypothetical gains (real prices, hypothetical quantity — clearly labeled)
  const calcGain = (g: GainerStock) => {
    if (!g.change_percent || !g.current_price) return 0;
    // gain per share today = current_price - (current_price / (1 + change/100))
    const yesterdayPrice = g.current_price / (1 + g.change_percent / 100);
    const gainPerShare = g.current_price - yesterdayPrice;
    return gainPerShare * HYPOTHETICAL_QTY;
  };

  const goToStock = (ticker: string) => {
    setSelectedTicker(ticker);
    setCurrentView('stock-detail');
    if (typeof window !== 'undefined') window.location.hash = 'stock-detail';
  };

  const goToAuth = () => {
    setCurrentView('auth');
    if (typeof window !== 'undefined') window.location.hash = 'auth';
  };

  return (
    <Card className="border-border bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-profit/10">
              <Sparkles className="h-4 w-4 text-profit" />
            </div>
            <div>
              <CardTitle className="text-base">لو كنت مالك السهم ده</CardTitle>
              <CardDescription className="text-xs">
                فرص النهاردة — بيانات حقيقية
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="gap-1 border-profit text-xs text-profit">
            <TrendingUp className="h-3 w-3" />
            لحظي
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Disclaimer — clear that this is hypothetical, not real holdings */}
        <p className="text-[10px] text-muted-foreground leading-snug">
          * الحساب افتراضي لـ {HYPOTHETICAL_QTY} سهم للتوضيح — مش محفظتك الحقيقية.
        </p>

        <div className="space-y-2">
          {top3.map((g) => {
            const gain = calcGain(g);
            const up = g.change_percent >= 0;
            return (
              <button
                key={g.ticker}
                onClick={() => goToStock(g.ticker)}
                className="w-full rounded-lg border border-border bg-slate-50 p-3 text-right transition-colors hover:border-profit/40 hover:bg-profit/5 dark:bg-slate-950/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{g.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{g.ticker}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      السعر الحالي: <span dir="ltr" className="tabular-nums font-medium">{g.current_price.toFixed(2)}</span> ج.م
                    </p>
                    <p className={cn('mt-1 text-xs font-bold tabular-nums', up ? 'text-profit' : 'text-loss')}>
                      التغيّر اليوم: {up ? '+' : ''}{g.change_percent.toFixed(2)}%
                    </p>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <p className="text-[10px] text-muted-foreground">لو كنت مالك {HYPOTHETICAL_QTY} سهم</p>
                    <p className={cn('text-sm font-bold tabular-nums', gain >= 0 ? 'text-profit' : 'text-loss')} dir="ltr">
                      {gain >= 0 ? '+' : ''}{gain.toFixed(2)} ج.م
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* CTA — converts guest to registered user */}
        {!isAuthenticated && (
          <Button
            onClick={goToAuth}
            className="w-full bg-primary hover:bg-primary text-primary-foreground font-bold text-xs h-9 gap-1.5"
          >
            <Wallet className="h-3.5 w-3.5" />
            ابدأ محفظتك الحقيقية مجانًا
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
