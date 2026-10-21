'use client';

/**
 * MarketTable — Unified market data table
 * ====================================================================
 * Per ALPHA Mission Directive 2026-10-20.
 *
 * A simple, reusable table for displaying market data (stocks, predictions,
 * etc.) with sorting support. Uses CSS variable tokens — no raw colors.
 *
 * Dumb component: receives data + columns via props. NO calculations.
 *
 * @example
 * <MarketTable
 *   columns={[
 *     { key: 'ticker', label: 'السهم', sortable: true },
 *     { key: 'price', label: 'السعر', align: 'center', render: (v) => <PriceText value={v} /> },
 *   ]}
 *   data={stocks}
 *   onRowClick={(row) => onSelect(row)}
 * />
 * ====================================================================
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

export interface MarketTableColumn<T = Record<string, unknown>> {
  /** Data key to access the cell value. */
  key: string;
  /** Column header label. */
  label: string;
  /** Column alignment. default: 'right'. */
  align?: 'right' | 'center' | 'left';
  /** Whether this column is sortable. default: false. */
  sortable?: boolean;
  /** Custom render function for the cell value. */
  render?: (value: unknown, row: T) => React.ReactNode;
  /** Hidden on screens smaller than this breakpoint. */
  hiddenOn?: 'sm' | 'md' | 'lg' | 'xl';
  /** Extra className for the th/td. */
  className?: string;
}

export interface MarketTableProps<T = Record<string, unknown>> {
  /** Column definitions. */
  columns: MarketTableColumn<T>[];
  /** Row data array. */
  data: T[];
  /** Unique key extractor for rows. default: uses index. */
  rowKey?: (row: T, index: number) => string;
  /** Row click handler. */
  onRowClick?: (row: T) => void;
  /** Empty state message. */
  emptyMessage?: string;
  /** Min width for the table (for horizontal scroll). */
  minWidth?: string;
  /** Extra className. */
  className?: string;
}

const ALIGN_CLASS = {
  right: 'text-right',
  center: 'text-center',
  left: 'text-left',
} as const;

const HIDDEN_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const;

export function MarketTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  onRowClick,
  emptyMessage = 'مفيش بيانات',
  minWidth = '700px',
  className,
}: MarketTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Sort data if sortKey is set
  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [data, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <div className={cn('rounded-md border border-border overflow-x-auto bg-card', className)}>
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'p-2 font-medium whitespace-nowrap',
                  ALIGN_CLASS[col.align || 'right'],
                  col.hiddenOn && HIDDEN_CLASS[col.hiddenOn],
                  col.className,
                )}
              >
                {col.sortable ? (
                  <button
                    onClick={() => handleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-4 text-center text-muted-foreground text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row, index) => (
              <tr
                key={rowKey ? rowKey(row, index) : String(index)}
                className={cn(
                  'border-t border-border transition-colors',
                  onRowClick && 'hover:bg-muted/40 cursor-pointer',
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => {
                  const value = row[col.key];
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        'p-2',
                        ALIGN_CLASS[col.align || 'right'],
                        col.hiddenOn && HIDDEN_CLASS[col.hiddenOn],
                        col.className,
                      )}
                    >
                      {col.render ? col.render(value, row) : (value != null ? String(value) : '—')}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default MarketTable;
