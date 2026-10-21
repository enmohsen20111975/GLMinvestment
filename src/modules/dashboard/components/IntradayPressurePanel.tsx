'use client';

/**
 * IntradayPressurePanel — ضغط EGX30 الكلي + أعلى 10 أسهم قيادية
 * ===================================================================
 * ALPHA-PHASE1 (2026-10-20): Rewrite to consume Python backend.
 *
 * API: /api/market/intraday-pressure
 * Response:
 * {
 *   "cumulative_pressure": {
 *     "buy_pct": 96.4, "sell_pct": 3.6,
 *     "net_pressure_egp": 679748941, "direction": "BUYING"
 *   },
 *   "top_stocks": [
 *     { "ticker": "COMI", "price": 129.0, "change_pct": 2.46,
 *       "buy_pct": 62.3, "sell_pct": 37.7, "net_pressure_egp": 108674111 }
 *   ]
 * }
 *
 * NO mock data — كل الأرقام من Python Backend.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Gauge, TrendingUp, TrendingDown, Loader2, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── API Types (matching Python response) ───────────────────────────────

interface CumulativePressure {
  buy_pct: number;
  sell_pct: number;
  net_pressure_egp: number;
  direction: string;
}

interface TopStock {
  ticker: string;
  price: number;
  change_pct: number;
  buy_pct: number;
  sell_pct: number;
  net_pressure_egp: number;
}

interface PressureResponse {
  success: boolean;
  source?: string;
  cumulative_pressure?: CumulativePressure | null;
  top_stocks?: TopStock[];
  message?: string;
}

// ─── Helpers (NO calculations — just formatting from API values) ────────

function fmtEGP(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)} مليار`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} مليون`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)} ألف`;
  return `${sign}${abs.toFixed(0)}`;
}

function directionMeta(dir: string | undefined): { label: string; className: string } {
  const d = (dir || '').toUpperCase();
  if (d === 'BUYING') return { label: 'ضغط شرائي كاسح', className: 'bg-profit/10 text-profit border-profit/20' };
  if (d === 'SELLING') return { label: 'ضغط بيعي مكثف', className: 'bg-loss/10 text-loss border-loss/20' };
  return { label: 'سوق متوازن', className: 'bg-muted text-muted-foreground border-border' };
}

// ─── Component ──────────────────────────────────────────────────────────

export function IntradayPressurePanel() {
  const [data, setData] = useState<PressureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/market/intraday-pressure', {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PressureResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ─── Loading ───
  if (loading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            ضغط الجلسة — EGX30
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  // ─── Error ───
  if (error) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            ضغط الجلسة — EGX30
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">تعذّر تحميل البيانات: {error}</p>
        </CardContent>
      </Card>
    );
  }

  const cp = data?.cumulative_pressure;
  const stocks = data?.top_stocks || [];
  const dirInfo = directionMeta(cp?.direction);

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          ضغط الجلسة — EGX30
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* ─── (1) مؤشر ضغط السوق الكلي (Gauge / Progress Bar) ─── */}
        {cp ? (
          <div className="space-y-2">
            {/* الشريط العريض: شراء مقابل بيع */}
            <div className="relative h-8 rounded-full overflow-hidden bg-muted">
              <div
                className="absolute inset-y-0 right-0 bg-profit/80 flex items-center justify-end px-2"
                style={{ width: `${cp.buy_pct}%` }}
              >
                <span className="text-[10px] font-bold text-white">
                  {cp.buy_pct.toFixed(1)}% شراء
                </span>
              </div>
              <div
                className="absolute inset-y-0 left-0 bg-loss/80 flex items-center justify-start px-2"
                style={{ width: `${cp.sell_pct}%` }}
              >
                <span className="text-[10px] font-bold text-white">
                  {cp.sell_pct.toFixed(1)}% بيع
                </span>
              </div>
            </div>

            {/* صافي الضغط + شارة الاتجاه */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] text-muted-foreground block">صافي الضغط</span>
                <span className={cn(
                  'font-mono font-bold text-sm tabular-nums',
                  cp.net_pressure_egp >= 0 ? 'text-profit' : 'text-loss',
                )}>
                  {fmtEGP(cp.net_pressure_egp)} ج.م
                </span>
              </div>
              <Badge className={cn('border text-[10px] font-bold', dirInfo.className)}>
                {dirInfo.label}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-4">
            {data?.message || 'مفيش بيانات ضغط متاحة حالياً'}
          </div>
        )}

        {/* ─── (2) جدول أعلى 10 أسهم قيادية محركة للسيولة ─── */}
        {stocks.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-muted-foreground">أعلى الأسهم القيادية محركة للسيولة</div>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="p-1.5 text-right font-medium">السهم</th>
                    <th className="p-1.5 text-center font-medium">السعر</th>
                    <th className="p-1.5 text-center font-medium">التغير%</th>
                    <th className="p-1.5 text-center font-medium">شراء%</th>
                    <th className="p-1.5 text-center font-medium">بيع%</th>
                    <th className="p-1.5 text-center font-medium">صافي الضغط</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.slice(0, 10).map((s) => {
                    const isBuy = s.net_pressure_egp >= 0;
                    return (
                      <tr key={s.ticker} className="border-t border-border/50">
                        <td className="p-1.5 font-bold">{s.ticker}</td>
                        <td className="p-1.5 text-center font-mono tabular-nums">
                          {s.price?.toFixed(2) || '—'}
                        </td>
                        <td className={cn(
                          'p-1.5 text-center font-mono tabular-nums font-medium',
                          s.change_pct >= 0 ? 'text-profit' : 'text-loss',
                        )}>
                          {s.change_pct >= 0 ? '+' : ''}{s.change_pct?.toFixed(2) || '—'}%
                        </td>
                        <td className="p-1.5 text-center text-profit font-medium">
                          {s.buy_pct?.toFixed(1) || '—'}%
                        </td>
                        <td className="p-1.5 text-center text-loss font-medium">
                          {s.sell_pct?.toFixed(1) || '—'}%
                        </td>
                        <td className={cn(
                          'p-1.5 text-center font-mono tabular-nums font-bold',
                          isBuy ? 'text-profit' : 'text-loss',
                        )}>
                          {fmtEGP(s.net_pressure_egp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}

export default IntradayPressurePanel;
