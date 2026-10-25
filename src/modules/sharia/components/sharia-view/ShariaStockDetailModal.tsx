/**
 * sharia-view/ShariaStockDetailModal.tsx
 * =====================================
 * Stock detail dialog — opens on row click, fetches /api/sharia?symbol=…
 * and renders ShariaStockDetailBody (sources breakdown + purification
 * rates table) + MetricTile primitives.
 *
 * Extracted from ShariaView.tsx (1,478 LOC) in Task F-Phase3-FinalPush.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  STATUS_BADGE_CLASS,
  STATUS_EMOJI,
  STATUS_LABELS_AR,
  type ShariaDetailResponse,
  type ShariaStatus,
} from './types';
import { formatPct, safeNumber, GoldBorder, IslamicPattern, OrnamentDivider } from './helpers';

export interface StockDetailModalProps {
  symbol: string | null;
  onClose: () => void;
}

export function ShariaStockDetailModal({ symbol, onClose }: StockDetailModalProps) {
  const [data, setData] = useState<ShariaDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sharia?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: ShariaDetailResponse) => {
        if (cancelled) return;
        if (!json.success) throw new Error('لم يتم العثور على السهم');
        setData(json);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e?.message || e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (!symbol) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل التوافق الشرعي"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card rounded-2xl border border-profit shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative from-profit via-profit to-profit text-profit p-4">
          <IslamicPattern />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="text-lg font-bold">التوافق الشرعي — {symbol}</h3>
              </div>
              <p className="text-xs text-profit/80 mt-1">
                التفصيل حسب المصادر الثمانية + نسب التطهير
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-profit hover:bg-profit/10 hover:text-foreground"
              aria-label="إغلاق"
            >
              ✕
            </Button>
          </div>
        </div>
        <GoldBorder />

        <div className="p-4 space-y-4">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          )}
          {error && !loading && (
            <Card className="border-loss/20">
              <CardContent className="p-4 flex items-center gap-2 text-sm text-loss ">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </CardContent>
            </Card>
          )}
          {data && !loading && (
            <ShariaStockDetailBody data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

export function ShariaStockDetailBody({ data }: { data: ShariaDetailResponse }) {
  const metric = data.metric || {};
  const symbol = data.symbol;
  const isHalal = Number((metric as Record<string, unknown>).is_halal_consensus ?? 0) === 1;
  const compliantCount = Number((metric as Record<string, unknown>).compliant_sources_count ?? 0);
  const activeCount = Number((metric as Record<string, unknown>).active_sources_count ?? 0);
  const spPct = safeNumber((metric as Record<string, unknown>).sp_haram_earning_pct);
  const haramPct = safeNumber((metric as Record<string, unknown>).haram_earnings_pct);
  const loansPct = safeNumber((metric as Record<string, unknown>).loans_pct);
  const nameAr = (metric as Record<string, unknown>).name_ar as string | undefined;
  const categoryAr = (metric as Record<string, unknown>).category_ar as string | undefined;
  const price = data.price;

  return (
    <>
      {/* Headline */}
      <div className="rounded-lg border border-profit bg-profit/10 /20 p-3 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-profit text-lg">{symbol}</span>
          <Badge
            className={cn(
              'border',
              isHalal
                ? 'bg-profit/10 text-profit border border-profit/20 border-profit '
                : 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-warning ',
            )}
          >
            {isHalal ? '🟢 متوافق (إجماع)' : '🟡 مشمول بالقائمة'}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {compliantCount}/{activeCount || 8} مصدر
          </Badge>
        </div>
        {nameAr && <p className="text-sm text-muted-foreground">{nameAr}</p>}
        {categoryAr && <p className="text-xs text-muted-foreground/70">{categoryAr}</p>}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile label="نسبة S&P الحرام" value={formatPct(spPct)} accent="amber" />
        <MetricTile label="الأرباح المحرمة" value={formatPct(haramPct)} accent="amber" />
        <MetricTile label="نسبة القروض" value={formatPct(loansPct)} accent="amber" />
        <MetricTile
          label="سعر السوق"
          value={price?.current_price != null ? price.current_price.toFixed(2) : '—'}
          accent="emerald"
        />
      </div>

      <OrnamentDivider />

      {/* Sources breakdown */}
      <div>
        <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-profit" />
          تفصيل المصادر الثمانية
        </h4>
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs">المصدر</TableHead>
                <TableHead className="text-xs text-center">الحالة</TableHead>
                <TableHead className="text-xs text-center">النسبة</TableHead>
                <TableHead className="text-xs text-center hidden sm:table-cell">المنهجية</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sources.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">
                    لا توجد بيانات مصادر لهذا السهم.
                  </TableCell>
                </TableRow>
              )}
              {data.sources.map((s) => {
                const st = (s.status || 'not_available') as ShariaStatus;
                return (
                  <TableRow key={`${symbol}-${s.source_key}`} className="text-xs">
                    <TableCell className="font-medium">{s.source_name_ar}</TableCell>
                    <TableCell className="text-center">
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs', STATUS_BADGE_CLASS[st])}>
                        {STATUS_EMOJI[st]} {STATUS_LABELS_AR[st]}
                      </span>
                    </TableCell>
                    <TableCell className="text-center tabular-nums" dir="ltr">
                      {formatPct(s.percentage)}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground hidden sm:table-cell">
                      {s.methodology || '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Purification rates */}
      {data.purification_rates.length > 0 && (
        <>
          <OrnamentDivider />
          <div>
            <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
              <Scale className="w-4 h-4 text-warning" />
              نسب التطهير المعتمدة
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.purification_rates.map((r) => (
                <div
                  key={`${symbol}-${r.method_key}`}
                  className={cn(
                    'rounded-md border p-2 flex items-center justify-between',
                    r.is_primary === 1
                      ? 'border-warning bg-warning/10 '
                      : 'border-border bg-muted/30',
                  )}
                >
                  <div>
                    <div className="text-xs font-medium">
                      {r.method_name_ar || r.method_key}
                      {r.is_primary === 1 && (
                        <span className="text-xs text-warning mr-1">★ أساسي</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{r.basis || '—'}</div>
                  </div>
                  <div className="text-sm font-bold tabular-nums text-warning " dir="ltr">
                    {formatPct(r.rate_pct)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function MetricTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'emerald' | 'amber';
}) {
  return (
    <div
      className={cn(
        'rounded-md border p-2 text-center',
        accent === 'emerald'
          ? 'border-profit bg-profit/10 /20'
          : 'border-warning bg-warning/10 /20',
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-sm font-bold tabular-nums',
          accent === 'emerald'
            ? 'text-profit '
            : 'text-warning ',
        )}
        dir="ltr"
      >
        {value}
      </div>
    </div>
  );
}
