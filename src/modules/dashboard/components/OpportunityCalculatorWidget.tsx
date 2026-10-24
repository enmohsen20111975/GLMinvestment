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
 * Data source (priority order):
 *   1. /api/market/top-movers (برافو B2 — هيجهزه) — الـ canonical endpoint
 *   2. Fallback: useAppStore.marketOverview.gainers — لو الـ endpoint لسه مش متاح
 *      (بيـ re-use نفس الـ data بتاعة LiveMonitor — صفر overhead إضافي)
 *
 * أول ما برافو يخلص B2، الـ widget هيتظبط أوتوماتيك (مش محتاج تعديل code).
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Sparkles, ArrowLeft, Wallet } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { WidgetCard } from '@/components/shared/WidgetCard';

// assumed hypothetical quantity for the "what if" calculation
const HYPOTHETICAL_QTY = 100;

interface GainerStock {
  ticker: string;
  name: string;
  name_ar?: string;
  sector?: string | null;
  current_price: number;
  change_percent: number;
  volume?: number;
  turnover_egp?: number;
  updated_at?: string;
}

interface TopMoversResponse {
  success: boolean;
  data?: {
    movers: GainerStock[];
    as_of?: string;
  };
  error?: string;
}

export function OpportunityCalculatorWidget() {
  const marketOverview = useAppStore((s) => s.marketOverview);
  const currentMarket = useAppStore((s) => s.currentMarket);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedTicker = useAppStore((s) => s.setSelectedTicker);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [movers, setMovers] = useState<GainerStock[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Try the canonical endpoint first (B2 from برافو). Falls back to store data if not ready.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/market/top-movers?market=${encodeURIComponent(currentMarket)}&limit=5`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: TopMoversResponse = await res.json();
        if (cancelled) return;
        if (json.success && json.data?.movers && json.data.movers.length > 0) {
          setMovers(json.data.movers);
        } else {
          setMovers(null); // will trigger fallback below
        }
      } catch {
        // Endpoint not ready yet (برافو still working on B2) — fall back to store data.
        if (cancelled) return;
        setMovers(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentMarket]);

  // Fallback: use store marketOverview.gainers (same data LiveMonitor uses — no extra fetch)
  const fallbackGainers: GainerStock[] = (marketOverview as any)?.gainers || [];
  const activeMovers: GainerStock[] = (movers && movers.length > 0) ? movers : fallbackGainers;
  const top3 = activeMovers.slice(0, 3);

  // Calculate hypothetical gains (real prices, hypothetical quantity — clearly labeled)
  const calcGain = (g: GainerStock) => {
    if (!g.change_percent || !g.current_price) return 0;
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

  // Loading skeleton (FCP ≤ 1.5s) handled by WidgetCard loading prop.
  // Empty state ("بيانات السوق غير متاحة") rendered inside children when top3 is empty.

  return (
    <WidgetCard
      title="لو كنت مالك السهم ده"
      icon={Sparkles}
      iconColor="text-profit"
      iconBg="bg-profit/10"
      loading={loading}
      skeletonRows={3}
      skeletonHeight="h-16"
      hideRefresh
      className="border-border bg-white shadow-sm"
      headerClassName="pb-3"
      badge={top3.length > 0 ? (
        <Badge variant="outline" className="gap-1 border-profit text-xs text-profit">
          <TrendingUp className="h-3 w-3" />
          لحظي
        </Badge>
      ) : undefined}
    >
      {top3.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          بيانات السوق غير متاحة دلوقتي — هتظهر الفرص تلقائيًا وقت الجلسة.
        </p>
      ) : (
        <>
          {/* Disclaimer — clear that this is hypothetical, not real holdings */}
          <p className="text-[10px] text-muted-foreground leading-snug">
            * الحساب افتراضي لـ {HYPOTHETICAL_QTY} سهم للتوضيح — مش محفظتك الحقيقية.
          </p>

          <div className="space-y-2">
            {top3.map((g) => {
              const gain = calcGain(g);
              const up = g.change_percent >= 0;
              const displayName = g.name_ar || g.name;
              return (
                <button
                  key={g.ticker}
                  onClick={() => goToStock(g.ticker)}
                  className="w-full rounded-lg border border-border bg-slate-50 p-3 text-right transition-colors hover:border-profit/40 hover:bg-profit/5 dark:bg-slate-950/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{displayName}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{g.ticker}</span>
                      </div>
                      {g.sector && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">قطاع: {g.sector}</p>
                      )}
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
        </>
      )}
    </WidgetCard>
  );
}
