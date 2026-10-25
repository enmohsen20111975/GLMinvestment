/**
 * super-learning/columns.tsx
 * =========================
 * UnifiedTable column definitions for the Super Learning System:
 * - sectorReportColumns: per-sector breakdown (4 cols).
 * - engineReportColumns: per-engine breakdown (3 cols).
 * - tradesColumns: per-trade list (6 cols: ticker, dates, prices, return, correct).
 *
 * All column defs are pure render descriptors; the render fns reference the
 * shared helpers (safeToFixed / safeNumber) for safe number formatting.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { Column } from '@/components/shared/UnifiedTable';
import type { BacktestTrade } from '@/hooks/useSuperLearningData';
import type { SectorBreakdownRow, EngineBreakdownRow } from './types';
import { safeToFixed, safeNumber } from './helpers';

export function buildSectorReportColumns(): Column<SectorBreakdownRow>[] {
  return [
    {
      key: 'sector',
      header: 'القطاع',
      sortable: true,
      filterable: true,
      className: 'text-xs font-medium',
    },
    {
      key: 'trades',
      header: 'التوقعات',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-xs text-center font-mono',
    },
    {
      key: 'winRate',
      header: 'نسبة النجاح',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (r) => (
        <Badge variant="outline" className="bg-profit/10 text-profit font-mono text-xs">
          {r.winRate}%
        </Badge>
      ),
    },
    {
      key: 'returnPct',
      header: 'العائد',
      align: 'left',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'text-xs text-left font-mono font-semibold text-profit',
      render: (r) => `+${r.returnPct}%`,
    },
  ];
}

export function buildEngineReportColumns(): Column<EngineBreakdownRow>[] {
  return [
    {
      key: 'model',
      header: 'نموذج المحرك',
      sortable: true,
      filterable: true,
      className: 'text-xs font-medium',
    },
    {
      key: 'trades',
      header: 'التوقعات',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-xs text-center font-mono',
    },
    {
      key: 'winRate',
      header: 'نسبة النجاح',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (r) => (
        <Badge variant="outline" className="bg-primary/10 text-primary font-mono text-xs">
          {r.winRate}%
        </Badge>
      ),
    },
  ];
}

export function buildTradesColumns(): Column<BacktestTrade>[] {
  return [
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      className: 'font-medium',
      render: (t) => t?.ticker || '-',
    },
    {
      key: 'entry_date',
      header: 'التاريخ',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (t) => t?.entry_date || '-',
    },
    {
      key: 'entry_price',
      header: 'الدخول',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (t) => safeToFixed(t?.entry_price, 2),
    },
    {
      key: 'exit_price',
      header: 'الخروج',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (t) => safeToFixed(t?.exit_price, 2),
    },
    {
      key: 'actual_return',
      header: 'العائد',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (t) => (
        <span className={safeNumber(t?.actual_return) >= 0 ? "text-success" : "text-loss"}>
          {safeNumber(t?.actual_return) >= 0 ? '+' : ''}{safeToFixed(t?.actual_return, 2)}%
        </span>
      ),
    },
    {
      key: 'analysis_correct',
      header: 'صحيح؟',
      align: 'center',
      width: 'w-20',
      render: (t) => t?.analysis_correct ? (
        <CheckCircle2 className="w-4 h-4 text-success inline-block" />
      ) : (
        <XCircle className="w-4 h-4 text-loss inline-block" />
      ),
    },
  ];
}
