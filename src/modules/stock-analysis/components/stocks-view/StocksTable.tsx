/**
 * stocks-view/StocksTable.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: desktop UnifiedTable + column definitions.
 *
 * قبل كده: الـ column memo (~390 LOC) كان inline في StocksView.tsx، والـ
 * UnifiedTable كان inline في الـ render. دلوقتي الـ الاتنين هنا.
 * ============================================================================
 */

'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Stock } from '@/types';
import { cn, safeNum } from '@/lib/utils';
import { TrendIndicator } from '@/components/shared/ui';
import { ShareButton } from '@/components/share/ShareButton';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { StockIconMini } from '../StockIcon';
import {
  formatCleanTicker,
  formatVolume,
  formatTurnover,
  formatPercent,
  formatMarketCap,
  getSectorColor,
} from './helpers';
import { DEFAULT_SORT_KEY, DEFAULT_SORT_DIR } from './constants';
import type { DesktopRow, TranslationFn } from './types';

interface StocksTableProps {
  displayData: Array<Stock | Record<string, unknown>>;
  onRowClick: (ticker: string) => void;
  isCrypto: boolean;
  currencyLabel: string;
  emptyTextAr: string;
  t: TranslationFn;
}

export function StocksTable({
  displayData,
  onRowClick,
  isCrypto,
  currencyLabel,
  emptyTextAr,
  t,
}: StocksTableProps) {
  const stocksColumns: Column<DesktopRow>[] = useMemo(() => {
    const cols: Column<DesktopRow>[] = [
      {
        key: 'icon',
        header: '',
        align: 'right',
        width: 'w-12',
        render: (row) => (
          <StockIconMini
            ticker={String(row.ticker ?? '')}
            name={String(row.name ?? '')}
            sector={String(row.sector ?? '')}
          />
        ),
      },
      {
        key: 'ticker',
        header: t('stocks.columns.ticker'),
        align: 'right',
        sortable: true,
        filterable: true,
        render: (row) => (
          <div className="flex items-center gap-1">
            <span className="font-bold text-sm text-profit ">
              {formatCleanTicker(String(row.ticker ?? ''))}
            </span>
            {row.egx30_member && (
              <span className="text-xs px-1 py-0.5 rounded bg-profit/10 text-profit border border-profit/20 font-medium">
                30
              </span>
            )}
            {row.egx70_member && (
              <span className="text-xs px-1 py-0.5 rounded bg-warning/10 text-warning dark:text-warning border border-warning/20/30 font-medium">
                70
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'name_ar',
        header: t('stocks.columns.name'),
        align: 'right',
        sortable: true,
        filterable: true,
        render: (row) => {
          const name = (row.name_ar as string | null | undefined) || (row.name as string | null | undefined) || '';
          return (
            <div className="max-w-[180px] truncate text-sm" dir="rtl" title={name || undefined}>
              {name || '—'}
            </div>
          );
        },
      },
    ];

    if (!isCrypto) {
      cols.push({
        key: 'sector',
        header: t('stocks.columns.sector'),
        align: 'right',
        sortable: true,
        filterable: true,
        render: (row) => (
          <span
            className={cn(
              'inline-block text-xs px-2 py-0.5 rounded font-medium max-w-[120px] truncate',
              getSectorColor(row.sector as string | undefined),
            )}
            title={row.sector as string | undefined}
          >
            {(row.sector as string) || '—'}
          </span>
        ),
      });
    }

    cols.push(
      {
        key: 'current_price',
        header: t('stocks.columns.price', { currency: currencyLabel }),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (row) => (
          <span className="font-semibold text-sm tabular-nums">
            {safeNum(row.current_price as number).toFixed(2)}
          </span>
        ),
      },
      {
        key: 'change_1d',
        header: t('stocks.columns.dayPct'),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (row) => {
          const change = row.change_1d != null ? row.change_1d : (row.price_change ?? 0);
          const isPositive = Number(change) > 0;
          const isNegative = Number(change) < 0;
          return (
            <div
              className={cn(
                'flex items-center gap-1 justify-end text-sm font-medium tabular-nums',
                isPositive
                  ? 'text-profit '
                  : isNegative
                    ? 'text-loss '
                    : 'text-muted-foreground'
              )}
            >
              {isPositive ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : isNegative ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : (
                <Minus className="w-3.5 h-3.5" />
              )}
              {formatPercent(change as number)}
            </div>
          );
        },
      },
      {
        key: 'high_low',
        header: t('stocks.columns.highLow'),
        align: 'left',
        sortable: false,
        render: (row) => {
          const high = safeNum(row.high_price as number);
          const low = safeNum(row.low_price as number);
          if (high <= 0 && low <= 0) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              <span className="text-profit font-medium">{(high ?? 0).toFixed(2)}</span>
              <span className="mx-1 text-muted-foreground/60">/</span>
              <span className="text-loss font-medium">{(low ?? 0).toFixed(2)}</span>
            </span>
          );
        },
      },
      {
        key: 'sparkline',
        header: t('stocks.columns.chart7d'),
        align: 'center',
        width: 'w-32',
        render: (row) => (
          <div className="w-32 mx-auto" dir="ltr">
            <MiniSparkline
              ticker={String(row.ticker ?? '')}
              days={7}
              height={28}
              width={120}
              showArea
            />
          </div>
        ),
      },
      {
        key: 'change_1w',
        header: t('stocks.columns.weekPct'),
        align: 'left',
        sortable: true,
        filterable: true,
        render: (row) => {
          const change1w = row.change_1w ?? null;
          return <TrendIndicator value={change1w} format="percent" size="xs" />;
        },
      },
    );

    if (!isCrypto) {
      cols.push({
        key: 'change_1m',
        header: t('stocks.columns.monthPct'),
        align: 'left',
        sortable: true,
        filterable: true,
        hidden: true,
        render: (row) => {
          const change1m = row.change_1m ?? null;
          return <TrendIndicator value={change1m} format="percent" size="xs" />;
        },
      });
    }

    cols.push({
      key: 'volume_int',
      header: t('stocks.columns.volumeToday'),
      align: 'left',
      sortable: true,
      filterable: true,
      render: (row) => {
        const volToday = row.volume_int ?? (row.volume ?? 0);
        return (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatVolume(volToday)}
          </span>
        );
      },
    });

    if (!isCrypto) {
      cols.push({
        key: 'turnover',
        header: t('stocks.columns.turnover'),
        align: 'left',
        sortable: true,
        filterable: true,
        hidden: true,
        render: (row) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatTurnover((row.turnover_egp as number | null | undefined) ?? (row.value_traded as number | null | undefined) ?? null)}
          </span>
        ),
      });
    }

    if (!isCrypto) {
      cols.push(
        {
          key: 'volume_week',
          header: t('stocks.columns.volumeWeek'),
          align: 'left',
          sortable: true,
          filterable: true,
          hidden: true,
          render: (row) => {
            const volWeek = row.volume_week ?? null;
            return (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatVolume(volWeek)}
              </span>
            );
          },
        },
        {
          key: 'fair_value',
          header: t('stocks.columns.fairValue'),
          align: 'left',
          sortable: true,
          filterable: true,
          render: (row) => {
            const fairValue = row.fair_value ?? null;
            const currentPrice = Number(row.current_price ?? 0);
            return (
              <span
                className={cn(
                  'text-xs tabular-nums font-medium',
                  fairValue != null && currentPrice && fairValue > currentPrice
                    ? 'text-profit '
                    : fairValue != null && currentPrice && fairValue < currentPrice
                      ? 'text-loss '
                      : 'text-muted-foreground',
                )}
              >
                {fairValue != null ? safeNum(fairValue).toFixed(2) : '—'}
              </span>
            );
          },
        },
        {
          key: 'upside_percent',
          header: t('stocks.columns.opportunityPct'),
          align: 'left',
          sortable: true,
          filterable: true,
          render: (row) => {
            const upside = row.upside_percent ?? null;
            return (
              <span
                className={cn(
                  'text-xs tabular-nums font-medium',
                  upside != null && upside > 5 ? 'text-profit ' :
                  upside != null && upside < -5 ? 'text-loss ' :
                  'text-muted-foreground',
                )}
              >
                {upside != null ? formatPercent(upside as number, 1) : '—'}
              </span>
            );
          },
        },
        {
          key: 'pe_ratio',
          header: t('stocks.columns.pe'),
          align: 'left',
          sortable: true,
          filterable: true,
          hidden: true,
          render: (row) => {
            const peRatio = row.pe_ratio ?? null;
            return (
              <span className="text-xs tabular-nums">
                {peRatio != null && peRatio > 0 ? (peRatio as number).toFixed(1) : '—'}
              </span>
            );
          },
        },
      );
    }

    cols.push(
      {
        key: 'technical_signal',
        header: t('stocks.columns.signal'),
        align: 'center',
        sortable: true,
        filterable: false,
        hidden: true,
        render: (row) => {
          const signalRaw = (row.signal as string | null | undefined) ?? (row.technical_signal as string | null | undefined);
          if (signalRaw) {
            const s = String(signalRaw).toLowerCase();
            const isBuy = s.includes('buy') || s.includes('strong') || s.includes('bull');
            const isSell = s.includes('sell') || s.includes('bear') || s.includes('avoid');
            const label = isBuy ? t('stocks.signal.buy') : isSell ? t('stocks.signal.sell') : t('stocks.signal.hold');
            const cls = isBuy
              ? 'bg-profit/10 text-profit border border-profit/20 '
              : isSell
                ? 'bg-loss/10 text-loss border border-loss/20 '
                : 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ';
            return (
              <span className={cn('inline-block text-xs px-2 py-0.5 rounded font-bold', cls)}>
                {label}
              </span>
            );
          }
          return <span className="text-muted-foreground">—</span>;
        },
      },
      {
        key: 'market_cap',
        header: t('stocks.columns.marketCap'),
        align: 'right',
        sortable: true,
        filterable: true,
        hidden: true,
        render: (row) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatMarketCap(safeNum(row.market_cap as number))}
          </span>
        ),
      },
      {
        key: 'share',
        header: '',
        align: 'center',
        width: 'w-10',
        render: (row) => {
          const change = row.change_1d != null ? row.change_1d : (row.price_change ?? 0);
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <ShareButton
                iconOnly
                variant="ghost"
                size="icon"
                stockData={{
                  ticker: String(row.ticker ?? ''),
                  name: String(row.name ?? ''),
                  nameAr: String(row.name_ar ?? ''),
                  price: Number(row.current_price ?? 0),
                  change: change as number,
                  sector: String(row.sector ?? ''),
                }}
              />
            </div>
          );
        },
      },
    );

    return cols;
  }, [isCrypto, currencyLabel, t]);

  return (
    <div className="hidden md:block">
      <UnifiedTable<Record<string, unknown>>
        columns={stocksColumns}
        data={displayData as unknown as Record<string, unknown>[]}
        keyField="ticker"
        onRowClick={(row) => onRowClick(String(row.ticker))}
        stickyHeader
        dense={false}
        maxHeight="max-h-[70vh]"
        emptyTextAr={emptyTextAr}
        filterable
        columnToggle
        initialSort={{ key: DEFAULT_SORT_KEY, dir: DEFAULT_SORT_DIR }}
      />
    </div>
  );
}
