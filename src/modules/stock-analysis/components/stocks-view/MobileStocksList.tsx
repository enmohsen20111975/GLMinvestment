/**
 * stocks-view/MobileStocksList.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: mobile list + mobile-only pagination.
 *
 * قبل كده: الـ mobile list (~115 LOC) + الـ pagination block (~55 LOC) كانوا
 * inline في StocksView.tsx render. دلوقتي الاتنين هنا.
 * ============================================================================
 */

'use client';

import type { Stock } from '@/types';
import { cn, safeNum } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { TrendIndicator } from '@/components/shared/ui';
import { StockIconMini } from '../StockIcon';
import { formatPercent, getSectorColor } from './helpers';
import type { TranslationFn } from './types';

interface MobileStocksListProps {
  paginatedStocks: Array<Stock | Record<string, unknown>>;
  onRowClick: (ticker: string) => void;
  totalPages: number;
  safePage: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  t: TranslationFn;
}

export function MobileStocksList({
  paginatedStocks,
  onRowClick,
  totalPages,
  safePage,
  setPage,
  t,
}: MobileStocksListProps) {
  return (
    <>
      {/* Mobile List — compact view (ticker, name, price, change %, fair_value, upside) */}
      <div className="md:hidden divide-y divide-border/50">
        {paginatedStocks.map((itemRaw) => {
          const item = itemRaw as Stock & Record<string, unknown>;
          const change = item.change_1d != null ? item.change_1d : (item.price_change ?? 0);
          const change1w = item.change_1w ?? null;
          const fairValue = item.fair_value ?? null;
          const upside = item.upside_percent ?? null;
          const isPositive = Number(change) > 0;
          const isNegative = Number(change) < 0;
          return (
            <div
              key={item.ticker}
              className="p-4 active:bg-muted/50 cursor-pointer"
              onClick={() => onRowClick(item.ticker)}
            >
              <div className="flex items-center justify-between gap-3">
                <StockIconMini
                  ticker={item.ticker}
                  name={item.name}
                  sector={item.sector}
                  className="flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-sm text-profit ">
                      {item.ticker}
                    </span>
                    {(item as Stock).egx30_member && (
                      <span className="text-xs px-1 py-0.5 rounded bg-profit/10 text-profit border border-profit/20 font-medium">
                        30
                      </span>
                    )}
                    {(item as Stock).egx70_member && (
                      <span className="text-xs px-1 py-0.5 rounded bg-warning/10 text-warning dark:text-warning border border-warning/20/30 font-medium">
                        70
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mb-0.5" dir="rtl">
                    {item.name_ar}
                  </p>
                  <span className={cn(
                    'inline-block text-xs px-1.5 py-0.5 rounded font-medium',
                    getSectorColor(item.sector)
                  )}>
                    {item.sector || '—'}
                  </span>
                </div>
                <div className="text-left flex-shrink-0">
                  <p className="font-bold text-sm tabular-nums">
                    {safeNum(item.current_price).toFixed(2)}
                  </p>
                  <p
                    className={cn(
                      'text-xs font-medium tabular-nums flex items-center gap-0.5 justify-end',
                      isPositive
                        ? 'text-profit '
                        : isNegative
                          ? 'text-loss '
                          : 'text-muted-foreground'
                    )}
                  >
                    {isPositive ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : isNegative ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : (
                      <Minus className="w-3 h-3" />
                    )}
                    {formatPercent(change as number)}
                  </p>
                </div>
              </div>
              <div className="mt-2">
                <MiniSparkline ticker={item.ticker} height={24} width={120} showArea />
              </div>
              {/* Secondary row: 1w change + fair_value + upside */}
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="bg-muted/40 rounded-lg p-1.5 text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('stocks.mobile.week')}</p>
                  <TrendIndicator value={change1w} format="percent" size="xs" />
                </div>
                <div className="bg-muted/40 rounded-lg p-1.5 text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('stocks.mobile.fairValue')}</p>
                  <p className={cn(
                    'text-xs font-semibold tabular-nums',
                    fairValue != null && item.current_price && (fairValue as number) > Number(item.current_price)
                      ? 'text-profit '
                      : fairValue != null && item.current_price && (fairValue as number) < Number(item.current_price)
                        ? 'text-loss '
                        : 'text-muted-foreground'
                  )}>
                    {fairValue != null ? safeNum(fairValue as number).toFixed(1) : '—'}
                  </p>
                </div>
                <div className="bg-muted/40 rounded-lg p-1.5 text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">{t('stocks.mobile.opportunity')}</p>
                  <p className={cn(
                    'text-xs font-semibold tabular-nums',
                    upside != null && (upside as number) > 5 ? 'text-profit ' :
                    upside != null && (upside as number) < -5 ? 'text-loss ' :
                    'text-muted-foreground'
                  )}>
                    {upside != null ? formatPercent(upside as number, 1) : '—'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination — mobile only (desktop relies on scroll inside UnifiedTable) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30 md:hidden">
          <span className="text-xs text-muted-foreground">
            {t('stocks.pagination.page', { current: safePage, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="h-8 px-3"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (safePage <= 3) {
                  pageNum = i + 1;
                } else if (safePage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = safePage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={safePage === pageNum ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(pageNum)}
                    className={cn(
                      'h-8 w-8 p-0 text-xs',
                      safePage === pageNum && 'bg-profit hover:bg-profit'
                    )}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="h-8 px-3"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
