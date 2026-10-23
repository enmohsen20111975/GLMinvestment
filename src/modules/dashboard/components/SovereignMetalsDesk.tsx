'use client';

/**
 * SovereignMetalsDesk — مكتب الذهب والعملات السيادي
 * ===================================================================
 * ALPHA-PHASE2 (2026-10-20): Independent gold + FX widget.
 *
 * API: /api/market/metals-forex/summary
 * NO stocks, NO crypto — gold + currencies only.
 *
 * NO calculations in React — all values from API.
 *
 * F2.2 (2026-10-23): Migrated from manual fetch + useState + setInterval
 * to useApiQuery (TanStack Query). Benefits: caching (60s), retry (2x),
 * background refetch, no manual loading state.
 */

import React from 'react';
import { Gem } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiQuery } from '@/hooks/use-api-query';

interface MetalsForexData {
  success: boolean;
  gold?: {
    karat24?: number | null;
    karat21?: number | null;
    karat18?: number | null;
    gold_coin?: number | null;
  } | null;
  forex?: {
    usd_bank?: number | null;
    usd_parallel?: number | null;
    eur?: number | null;
    sar?: number | null;
  } | null;
  source?: string;
  message?: string;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function GoldCard({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-lg border border-profit/15 bg-profit/5 p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-bold tabular-nums text-profit">
        {fmtPrice(value)}
      </div>
    </div>
  );
}

function FxCard({ label, value, suffix }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-1.5 text-center">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="font-mono text-xs font-bold tabular-nums">
        {fmtPrice(value)}{suffix && <span className="text-[9px] text-muted-foreground ml-0.5">{suffix}</span>}
      </div>
    </div>
  );
}

export function SovereignMetalsDesk() {
  // F2.2: useApiQuery replaces manual fetch + useState + setInterval.
  // 2 min polling preserved via refetchInterval. Retry + caching handled by TanStack.
  const { data, isLoading } = useApiQuery<MetalsForexData>('/api/market/metals-forex/summary', {
    queryOptions: {
      refetchInterval: 120_000, // 2 min (was setInterval)
      refetchOnWindowFocus: false,
    },
    fetchOptions: { signal: AbortSignal.timeout(10000) } as RequestInit,
  });

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gem className="h-4 w-4 text-profit" />
            الذهب والعملات
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  const gold = data?.gold;
  const fx = data?.forex;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gem className="h-4 w-4 text-profit" />
          الذهب والعملات
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* كروت الصاغة المصرية */}
        {gold && (
          <div className="grid grid-cols-4 gap-1.5">
            <GoldCard label="عيار 24" value={gold.karat24} />
            <GoldCard label="عيار 21" value={gold.karat21} />
            <GoldCard label="عيار 18" value={gold.karat18} />
            <GoldCard label="الجنيه ذهب" value={gold.gold_coin} />
          </div>
        )}

        {/* شريط العملات السيادي */}
        {fx && (
          <div className="grid grid-cols-4 gap-1.5">
            <FxCard label="دولار بنكي" value={fx.usd_bank} />
            <FxCard label="دولار موازي" value={fx.usd_parallel} />
            <FxCard label="يورو" value={fx.eur} />
            <FxCard label="ريال سعودي" value={fx.sar} />
          </div>
        )}

        {/* Empty state */}
        {!gold && !fx && (
          <p className="text-xs text-muted-foreground text-center py-4">
            {data?.message || 'مفيش بيانات ذهب أو عملات متاحة حالياً'}
          </p>
        )}

      </CardContent>
    </Card>
  );
}

export default SovereignMetalsDesk;
