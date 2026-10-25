// src/modules/screener/components/screener-advanced/topPerformerColumns.tsx
// F-Phase3-Split-Screener — UnifiedTable column definitions for the top
// performers table (Tab 2 — TopPerformersTab).

import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { cn } from '@/lib/utils';
import type { TopPerformerStock } from '@/hooks/useScreenerData';
import { formatNumber, formatVolume } from './helpers';
import type { TFunc } from './types';

export function buildTopPerformerColumns(t: TFunc): Column<TopPerformerStock>[] {
  return [
    {
      key: 'ticker',
      header: t('screener.advanced.performers.columns.stock'),
      align: 'right',
      sortable: true,
      filterable: true,
      render: (s) => (
        <div>
          <div className="font-mono font-bold text-sm">{s.ticker}</div>
          <div className="text-xs text-muted-foreground truncate max-w-[180px]">
            {s.name_ar || s.name}
          </div>
        </div>
      ),
    },
    {
      key: 'sector',
      header: t('screener.advanced.performers.columns.sector'),
      align: 'right',
      sortable: true,
      filterable: true,
      render: (s) => <span className="text-xs text-muted-foreground">{s.sector || '—'}</span>,
    },
    {
      key: 'start_price',
      header: t('screener.advanced.performers.columns.startPrice'),
      align: 'left',
      sortable: true,
      filterable: true,
      render: (s) => <span className="font-mono text-sm">{formatNumber(s.start_price)}</span>,
    },
    {
      key: 'end_price',
      header: t('screener.advanced.performers.columns.endPrice'),
      align: 'left',
      sortable: true,
      filterable: true,
      render: (s) => <span className="font-mono text-sm">{formatNumber(s.end_price)}</span>,
    },
    {
      key: 'change_pct',
      header: t('screener.advanced.performers.columns.changePct'),
      align: 'left',
      sortable: true,
      filterable: true,
      render: (s) => (
        <span
          className={cn(
            'font-mono font-bold',
            s.change_pct >= 0 ? 'text-profit' : 'text-loss',
          )}
        >
          {s.change_pct >= 0 ? '+' : ''}
          {s.change_pct}%
        </span>
      ),
    },
    {
      key: 'period_days',
      header: t('screener.advanced.performers.columns.days'),
      align: 'left',
      sortable: true,
      filterable: true,
      render: (s) => (
        <span className="font-mono text-xs text-muted-foreground">{s.period_days} يوم</span>
      ),
    },
    {
      key: 'end_volume',
      header: t('screener.advanced.performers.columns.volume'),
      align: 'left',
      sortable: true,
      filterable: true,
      render: (s) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatVolume(s.end_volume)}
        </span>
      ),
    },
  ];
}
