'use client';

/**
 * academy/LiveMarketScanner.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Trading Floor §1 — Live Market Scanner. Top tickers by activity from
 * /api/stocks (with graceful fallback to demo data if the API is unreachable,
 * handled by the useAcademyStocksData hook from Phase 2).
 *
 * Desktop: full table (ticker / price / change% / volume / action button).
 * Mobile: card list with same fields.
 * Sheet: quick analysis modal triggered by "حلّل" button — shows price +
 * change + volume + a tone-based hint (analysisHint).
 *
 * Data layer (Strangler F-Strangler-AcademyView): all fetch logic, polling,
 * and FALLBACK_STOCKS are owned by `useAcademyStocksData`. Component retains
 * only UI state: search (filter input), showAll (toggle), analysis (modal).
 * ============================================================================
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useAcademyStocksData } from '@/hooks/useAcademyData';
import type { AnalysisState } from './types';
import { analysisHint, changeTone, formatVolume } from './helpers';

export function LiveMarketScanner() {
  // ─── Data layer (Strangler F-Strangler-AcademyView) ───────────────────────
  // All fetch logic, normalization, FALLBACK_STOCKS, polling, and lastUpdated
  // are owned by useAcademyStocksData. Component retains only UI state:
  // search (filter input), showAll (toggle), analysis (modal open).
  const {
    stocks,
    loading,
    refreshing,
    error,
    lastUpdated,
    refetch,
  } = useAcademyStocksData();

  const [search, setSearch] = React.useState('');
  const [showAll, setShowAll] = React.useState(false);
  const [analysis, setAnalysis] = React.useState<AnalysisState>({ open: false, stock: null });

  const filtered = React.useMemo(() => {
    if (!search.trim()) return stocks;
    const q = search.trim().toLowerCase();
    return stocks.filter(
      (s) =>
        (s.ticker || '').toLowerCase().includes(q) ||
        (s.name_ar || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q),
    );
  }, [stocks, search]);

  const visible = showAll ? filtered : filtered.slice(0, 15);

  const timeLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <Card className="overflow-hidden border-profit/20 via-card to-card">
      <CardHeader className="gap-3 border-b bg-profit/10 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-profit/15 text-profit ">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base sm:text-lg">ماسح السوق الحي</CardTitle>
              <CardDescription className="text-xs">
                أعلى الأسهم نشاطاً · تحديث تلقائي كل ٦٠ ثانية
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث برمز أو اسم السهم…"
                className="h-9 pr-8"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={refreshing}
              className="border-profit/20 text-profit hover:bg-profit/10 "
            >
              <RefreshCw className={cn('ml-1 h-4 w-4', refreshing && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning ">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!error && lastUpdated && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            آخر تحديث: {timeLabel}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="ml-2 h-5 w-5 animate-spin" />
            جارٍ تحميل بيانات السوق…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            لا توجد نتائج مطابقة لبحثك.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pr-6">السهم</TableHead>
                    <TableHead className="text-left">السعر</TableHead>
                    <TableHead className="text-left">التغير %</TableHead>
                    <TableHead className="text-left">الحجم</TableHead>
                    <TableHead className="text-center">الإجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((s) => {
                    const tone = changeTone(s.change_percent);
                    return (
                      <TableRow key={s.ticker} className="group">
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span className="font-bold tracking-wide">{s.ticker}</span>
                            <span className="text-xs text-muted-foreground">
                              {s.name_ar || s.name || '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-left font-mono tabular-nums" dir="ltr">
                          {(s.current_price ?? 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-left">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
                              tone === 'up' && 'bg-profit/10 text-profit ',
                              tone === 'down' && 'bg-loss/10 text-loss ',
                              tone === 'flat' && 'bg-slate-500/10 text-muted-foreground dark:text-muted-foreground',
                            )}
                            dir="ltr"
                          >
                            {tone === 'up' ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : tone === 'down' ? (
                              <TrendingDown className="h-3 w-3" />
                            ) : null}
                            {(s.change_percent ?? 0) >= 0 ? '+' : ''}
                            {(s.change_percent ?? 0).toFixed(2)}%
                          </span>
                        </TableCell>
                        <TableCell
                          className="text-left font-mono text-xs tabular-nums text-muted-foreground"
                          dir="ltr"
                        >
                          {formatVolume(s.volume)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setAnalysis({ open: true, stock: s })}
                            className="h-8 bg-profit/15 text-profit hover:bg-profit/25 "
                          >
                            حلّل
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="grid gap-2 p-3 md:hidden">
              {visible.map((s) => {
                const tone = changeTone(s.change_percent);
                return (
                  <div
                    key={s.ticker}
                    className="flex items-center justify-between rounded-lg border bg-card p-3 shadow-sm"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold tracking-wide">{s.ticker}</span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {s.name_ar || s.name || '—'}
                      </span>
                      <span
                        className="font-mono text-xs tabular-nums text-muted-foreground"
                        dir="ltr"
                      >
                        {(s.current_price ?? 0).toFixed(2)} · {formatVolume(s.volume)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
                          tone === 'up' && 'bg-profit/10 text-profit ',
                          tone === 'down' && 'bg-loss/10 text-loss ',
                          tone === 'flat' && 'bg-slate-500/10 text-muted-foreground dark:text-muted-foreground',
                        )}
                        dir="ltr"
                      >
                        {(s.change_percent ?? 0) >= 0 ? '+' : ''}
                        {(s.change_percent ?? 0).toFixed(2)}%
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAnalysis({ open: true, stock: s })}
                        className="h-7 bg-profit/15 px-2 text-xs text-profit hover:bg-profit/25 "
                      >
                        حلّل
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Show more / less */}
            {filtered.length > 15 && (
              <div className="border-t bg-muted/20 px-4 py-3 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-profit hover:bg-profit/10 "
                >
                  {showAll
                    ? `عرض أقل (١٥ من ${filtered.length})`
                    : `عرض الكل (${filtered.length} سهم)`}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* Quick analysis sheet */}
      <Sheet
        open={analysis.open}
        onOpenChange={(o) => setAnalysis({ open: o, stock: analysis.stock })}
      >
        <SheetContent side="bottom" className="mx-auto max-w-xl rounded-t-2xl">
          {analysis.stock && (
            <>
              <SheetHeader className="text-right">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-bold tracking-wide">{analysis.stock.ticker}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {analysis.stock.name_ar || analysis.stock.name || ''}
                  </span>
                </SheetTitle>
                <SheetDescription>
                  تحليل سريع للسهم وفق الزخم الحالي — مجرد تلميح، ليس إشارة شراء أو بيع.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4 pb-6">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <div className="text-xs text-muted-foreground">السعر</div>
                    <div className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
                      {(analysis.stock.current_price ?? 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <div className="text-xs text-muted-foreground">التغير</div>
                    <div
                      className={cn(
                        'font-mono text-sm font-semibold tabular-nums',
                        changeTone(analysis.stock.change_percent) === 'up' &&
                          'text-profit ',
                        changeTone(analysis.stock.change_percent) === 'down' &&
                          'text-loss ',
                        changeTone(analysis.stock.change_percent) === 'flat' && 'text-muted-foreground',
                      )}
                      dir="ltr"
                    >
                      {(analysis.stock.change_percent ?? 0) >= 0 ? '+' : ''}
                      {(analysis.stock.change_percent ?? 0).toFixed(2)}%
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <div className="text-xs text-muted-foreground">الحجم</div>
                    <div className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
                      {formatVolume(analysis.stock.volume)}
                    </div>
                  </div>
                </div>
                {(() => {
                  const hint = analysisHint(analysis.stock.change_percent);
                  return (
                    <div
                      className={cn(
                        'rounded-lg border p-3 text-sm',
                        hint.tone === 'up' &&
                          'border-profit/20 bg-profit/10 text-profit ',
                        hint.tone === 'down' &&
                          'border-loss/20 bg-loss/10 text-loss ',
                        hint.tone === 'flat' &&
                          'border-warning/20 bg-warning/10 text-warning ',
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                        {hint.tone === 'up' && <CheckCircle2 className="h-4 w-4" />}
                        {hint.tone === 'down' && <XCircle className="h-4 w-4" />}
                        {hint.tone === 'flat' && <AlertTriangle className="h-4 w-4" />}
                        تلميح السيناريو
                      </div>
                      <p className="leading-relaxed">{hint.hint}</p>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
