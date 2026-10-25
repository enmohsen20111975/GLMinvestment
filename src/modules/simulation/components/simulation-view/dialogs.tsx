import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Plus,
  Minus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { COMMISSION_RATE } from './constants';
import { formatCurrency, formatNumber } from './helpers';
import type { EGXStock, PendingTrade, Position } from './types';

/* ============================================================
 * SimulationView — Dialogs
 * Trade dialog + Confirm dialog + Reset dialog. All state is
 * controlled by the parent SimulationView component so these
 * remain presentational.
 * ============================================================ */

/* ─── Trade Dialog ─────────────────────────────────────────── */

interface TradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tradeType: 'buy' | 'sell';
  selectedStock: EGXStock | null;
  tradeQuantity: number;
  onTradeQuantityChange: (q: number) => void;
  balance: number;
  positions: Position[];
  onSubmit: () => void;
}

export function TradeDialog({
  open,
  onOpenChange,
  tradeType,
  selectedStock,
  tradeQuantity,
  onTradeQuantityChange,
  balance,
  positions,
  onSubmit,
}: TradeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tradeType === 'buy' ? (
              <span className="flex items-center gap-2 text-profit">
                <ArrowDownRight className="h-5 w-5" />
                شراء سهم
              </span>
            ) : (
              <span className="flex items-center gap-2 text-loss">
                <ArrowUpRight className="h-5 w-5" />
                بيع سهم
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {selectedStock && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
              <Row label="السهم" value={`${selectedStock.name_ar} (${selectedStock.ticker})`} />
              <Row label="السعر الحالي" value={`${formatNumber(selectedStock.price)} ج.م`} mono />
              <Row label="رصيدك" value={formatCurrency(balance)} mono />
              {tradeType === 'sell' && (() => {
                const pos = positions.find((p) => p.ticker === selectedStock.ticker);
                return pos ? (
                  <Row label="أسهمك" value={`${pos.shares} سهم`} mono />
                ) : null;
              })()}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">عدد الأسهم</label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  onClick={() => onTradeQuantityChange(Math.max(0, tradeQuantity - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  value={tradeQuantity || ''}
                  onChange={(e) => onTradeQuantityChange(Math.max(0, parseInt(e.target.value) || 0))}
                  className="text-center font-mono"
                  placeholder="0"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  onClick={() => onTradeQuantityChange(tradeQuantity + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                {tradeType === 'buy' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-xs"
                    onClick={() => {
                      const maxShares = Math.floor(balance / (selectedStock.price * (1 + COMMISSION_RATE)));
                      onTradeQuantityChange(maxShares);
                    }}
                  >
                    الأقصى
                  </Button>
                )}
                {tradeType === 'sell' && (() => {
                  const pos = positions.find((p) => p.ticker === selectedStock.ticker);
                  return pos ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs"
                      onClick={() => onTradeQuantityChange(pos.shares)}
                    >
                      الكل
                    </Button>
                  ) : null;
                })()}
              </div>
            </div>

            {tradeQuantity > 0 && (
              <div className="rounded-lg border p-3 space-y-1.5">
                <Row label="سعر السهم" value={`${formatNumber(selectedStock.price)} ج.م`} mono small />
                <Row label="عدد الأسهم" value={String(tradeQuantity)} mono small />
                <Row label="المجموع الفرعي" value={formatCurrency(tradeQuantity * selectedStock.price)} mono small />
                <Row
                  label={`العمولة (${(COMMISSION_RATE * 100).toFixed(2)}%)`}
                  value={`${formatNumber(tradeQuantity * selectedStock.price * COMMISSION_RATE)} ج.م`}
                  mono
                  small
                  valueClassName="text-warning"
                />
                <Separator />
                <div className="flex items-center justify-between font-bold">
                  <span>{tradeType === 'buy' ? 'الإجمالي' : 'صافي الإيرادات'}</span>
                  <span className="font-mono">
                    {tradeType === 'buy'
                      ? formatCurrency(tradeQuantity * selectedStock.price * (1 + COMMISSION_RATE))
                      : formatCurrency(tradeQuantity * selectedStock.price * (1 - COMMISSION_RATE))}
                  </span>
                </div>
              </div>
            )}

            {tradeType === 'buy' && tradeQuantity > 0 && tradeQuantity * selectedStock.price * (1 + COMMISSION_RATE) > balance && (
              <div className="flex items-center gap-2 text-sm text-loss bg-loss/10 rounded-lg p-3">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>رصيدك غير كافي لإتمام هذه الصفقة</span>
              </div>
            )}

            {tradeType === 'sell' && (() => {
              const pos = positions.find((p) => p.ticker === selectedStock.ticker);
              if (!pos) return (
                <div className="flex items-center gap-2 text-sm text-loss bg-loss/10 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>ليس لديك أسهم من هذا السهم لبيعها</span>
                </div>
              );
              if (tradeQuantity > pos.shares) return (
                <div className="flex items-center gap-2 text-sm text-loss bg-loss/10 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>عدد الأسهم المطلوبة أكبر مما تملك ({pos.shares})</span>
                </div>
              );
              return null;
            })()}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            className={cn(
              'gap-1.5',
              tradeType === 'buy' ? 'bg-profit hover:bg-profit' : 'bg-loss hover:bg-loss',
            )}
            onClick={onSubmit}
            disabled={tradeQuantity <= 0}
          >
            {tradeType === 'buy' ? (
              <span className="flex items-center gap-1.5"><ArrowDownRight className="h-4 w-4" /> تأكيد الشراء</span>
            ) : (
              <span className="flex items-center gap-1.5"><ArrowUpRight className="h-4 w-4" /> تأكيد البيع</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Confirm Dialog ───────────────────────────────────────── */

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingTrade: PendingTrade | null;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onOpenChange, pendingTrade, onConfirm }: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            تأكيد {pendingTrade?.type === 'buy' ? 'الشراء' : 'البيع'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingTrade && (
              <div className="space-y-2 mt-2 text-right" dir="rtl">
                <p>
                  هل أنت متأكد من{' '}
                  <span className="font-bold text-foreground">
                    {pendingTrade.type === 'buy' ? 'شراء' : 'بيع'}
                  </span>{' '}
                  <span className="font-bold text-foreground">
                    {pendingTrade.quantity} سهم
                  </span>{' '}
                  من{' '}
                  <span className="font-bold text-foreground">
                    {pendingTrade.stock.name_ar} ({pendingTrade.stock.ticker})
                  </span>{' '}
                  بسعر{' '}
                  <span className="font-mono font-bold text-foreground">
                    {formatNumber(pendingTrade.stock.price)} ج.م
                  </span>
                  ؟
                </p>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span>الإجمالي (شامل العمولة)</span>
                  <span className="font-mono font-bold">{formatCurrency(pendingTrade.total)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>العمولة</span>
                  <span className="font-mono">{formatNumber(pendingTrade.commission)} ج.م</span>
                </div>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(pendingTrade?.type === 'buy' ? 'bg-profit hover:bg-profit' : 'bg-loss hover:bg-loss')}
          >
            تأكيد التنفيذ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─── Reset Dialog ────────────────────────────────────────── */

interface ResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ResetDialog({ open, onOpenChange, onConfirm }: ResetDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            إعادة تعيين المحاكاة
          </AlertDialogTitle>
          <AlertDialogDescription>
            هل أنت متأكد من إعادة تعيين المحاكاة؟ سيتم حذف جميع البيانات بما في ذلك:
            <ul className="mt-2 space-y-1 text-right mr-4 list-disc">
              <li>جميع المعاملات السابقة</li>
              <li>جميع الأصول المحتفظ بها</li>
              <li>سجل الأداء</li>
              <li>قائمة الرغبات</li>
            </ul>
            <p className="mt-2 font-bold text-foreground">لا يمكن التراجع عن هذا الإجراء.</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive hover:bg-destructive/90">
            إعادة تعيين
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─── Local presentational helpers ────────────────────────── */

function Row({
  label,
  value,
  mono,
  small,
  valueClassName,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(mono && 'font-mono', small && 'text-xs', valueClassName)}>{value}</span>
    </div>
  );
}
