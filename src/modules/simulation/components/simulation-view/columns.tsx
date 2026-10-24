import { ArrowDownRight, ArrowUpRight, Minus, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Column } from '@/components/shared/UnifiedTable';
import { formatCurrency, formatNumber } from './helpers';
import { COMMISSION_RATE } from './constants';
import type { EGXStock, Position, Transaction } from './types';

/* ============================================================
 * SimulationView — Columns
 * Factory functions that build UnifiedTable columns for the
 * stock list, holdings, and transactions tables. The factories
 * accept the runtime context (currency label + openTradeDialog
 * callback) so the column closures stay isolated from the
 * container component.
 * ============================================================ */

export type OpenTradeDialog = (stock: EGXStock, type: 'buy' | 'sell') => void;

export function buildStockListColumns(
  openTradeDialog: OpenTradeDialog,
): Column<EGXStock>[] {
  return [
    {
      key: 'name_ar',
      header: 'السهم',
      sortable: true,
      filterable: true,
      className: 'font-medium',
      render: (s) => s.name_ar,
    },
    {
      key: 'ticker',
      header: 'الرمز',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (s) => <Badge variant="outline" className="font-mono">{s.ticker}</Badge>,
    },
    {
      key: 'sector',
      header: 'القطاع',
      sortable: true,
      filterable: true,
      className: 'text-muted-foreground text-sm',
    },
    {
      key: 'price',
      header: 'السعر',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'font-mono font-bold',
      render: (s) => formatNumber(s.price),
    },
    {
      key: 'change',
      header: 'التغير',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (s) => (
        <span className={cn('font-mono inline-flex items-center gap-1', s.change >= 0 ? 'text-profit' : 'text-loss')}>
          {s.change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {s.change >= 0 ? '+' : ''}{formatNumber(s.change)}
        </span>
      ),
    },
    {
      key: 'changePercent',
      header: 'النسبة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (s) => (
        <Badge
          variant={s.changePercent >= 0 ? 'default' : 'destructive'}
          className={cn(s.changePercent >= 0 ? 'bg-profit/10 text-profit border border-profit/20 ' : '')}
        >
          {s.changePercent >= 0 ? '+' : ''}{(s.changePercent ?? 0).toFixed(2)}%
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      align: 'center',
      width: 'w-32',
      hideable: false,
      render: (s) => (
        <div className="flex items-center justify-center gap-1">
          <Button size="sm" className="h-7 text-xs gap-1 bg-profit hover:bg-profit" onClick={(e) => { e.stopPropagation(); openTradeDialog(s, 'buy'); }}>
            <Plus className="h-3 w-3" />
            شراء
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); openTradeDialog(s, 'sell'); }}>
            <Minus className="h-3 w-3" />
            بيع
          </Button>
        </div>
      ),
    },
  ];
}

export type HoldingsRow = Position & {
  _stock?: EGXStock;
  _currentValue?: number;
  _pnl?: number;
  _pnlPercent?: number;
};

export function buildHoldingsColumns(
  openTradeDialog: OpenTradeDialog,
  currencyLabel: string,
): Column<HoldingsRow>[] {
  return [
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      render: (p) => (
        <div>
          <p className="font-medium">{p._stock?.name_ar || p.ticker}</p>
          <Badge variant="outline" className="font-mono text-xs">{p.ticker}</Badge>
        </div>
      ),
    },
    {
      key: 'shares',
      header: 'العدد',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'font-mono',
    },
    {
      key: 'avgCost',
      header: 'متوسط التكلفة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'font-mono',
      render: (p) => formatNumber(p.avgCost),
    },
    {
      key: '_currentPrice',
      header: 'السعر الحالي',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'font-mono',
      render: (p) => formatNumber(p._stock?.price ?? 0),
    },
    {
      key: '_currentValue',
      header: 'القيمة الحالية',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-32',
      className: 'font-mono font-bold',
      render: (p) => formatCurrency(p._currentValue ?? 0, currencyLabel),
    },
    {
      key: '_pnl',
      header: 'الربح/الخسارة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-36',
      render: (p) => (
        <div className={cn('font-mono font-medium', (p._pnl ?? 0) >= 0 ? 'text-profit' : 'text-loss')}>
          <p>{(p._pnl ?? 0) >= 0 ? '+' : ''}{formatCurrency(p._pnl ?? 0, currencyLabel)}</p>
          <p className="text-xs">({(p._pnlPercent ?? 0) >= 0 ? '+' : ''}{(p._pnlPercent ?? 0).toFixed(2)}%)</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      align: 'center',
      width: 'w-24',
      hideable: false,
      render: (p) => (
        <div className="flex items-center justify-center">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 text-loss hover:text-loss border-loss hover:bg-loss"
            onClick={(e) => { if (p._stock) { e.stopPropagation(); openTradeDialog(p._stock, 'sell'); } }}
          >
            <Minus className="h-3 w-3" />
            بيع
          </Button>
        </div>
      ),
    },
  ];
}

export type TransactionRow = Transaction & { _stockName?: string };

export function buildTransactionsColumns(currencyLabel: string): Column<TransactionRow>[] {
  return [
    {
      key: 'date',
      header: 'التاريخ',
      sortable: true,
      filterable: true,
      width: 'w-32',
      render: (t) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {new Date(t.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'النوع',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (t) => (
        <Badge variant={t.type === 'buy' ? 'default' : 'destructive'} className={cn(t.type === 'buy' ? 'bg-profit/10 text-profit border border-profit/20 ' : '')}>
          {t.type === 'buy' ? (
            <span className="flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> شراء</span>
          ) : (
            <span className="flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> بيع</span>
          )}
        </Badge>
      ),
    },
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      filterable: true,
      render: (t) => (
        <div>
          <p className="font-medium text-sm">{t._stockName || t.ticker}</p>
          <Badge variant="outline" className="font-mono text-xs">{t.ticker}</Badge>
        </div>
      ),
    },
    {
      key: 'shares',
      header: 'العدد',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-20',
      className: 'font-mono',
    },
    {
      key: 'price',
      header: 'السعر',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'font-mono',
      render: (t) => formatNumber(t.price),
    },
    {
      key: 'commission',
      header: 'العمولة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'font-mono text-muted-foreground text-xs',
      render: (t) => formatNumber(t.commission),
    },
    {
      key: 'total',
      header: 'الإجمالي',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'font-mono font-bold',
      render: (t) => formatCurrency(t.total, currencyLabel),
    },
    {
      key: 'pnl',
      header: 'الربح/الخسارة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (t) => (
        t.pnl !== undefined ? (
          <span className={cn('font-mono font-medium text-sm', t.pnl >= 0 ? 'text-profit' : 'text-loss')}>
            {t.pnl >= 0 ? '+' : ''}{formatCurrency(t.pnl, currencyLabel)}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )
      ),
    },
  ];
}

/* Suppress unused-import warnings for re-exported constants */
export { COMMISSION_RATE };
