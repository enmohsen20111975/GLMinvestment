/**
 * paper-trading-ws/OpenPositionsTable.tsx
 * ==========================================
 * Open positions table — auto-refreshing, color-coded P&L, close action
 * with confirmation AlertDialog, SL/TP columns.
 *
 * Extracted from PaperTradingWorkstation.tsx (1,550 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import {
  Activity,
  Clock,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { fmtPrice } from '@/lib/utils';
import {
  ASSET_TYPE_LABELS,
  type AssetType,
  type OpenPosition,
} from './types';
import {
  fmtEgp,
  fmtNum,
  fmtPct,
  pnlColor,
  rowBgClass,
  timeAgoAr,
} from './helpers';

export interface OpenPositionsTableProps {
  positions: OpenPosition[];
  livePrices: Record<string, number>;
  onRefresh: () => void;
  loading?: boolean;
  closeTarget: OpenPosition | null;
  onCloseTargetChange: (p: OpenPosition | null) => void;
  onConfirmClose: (p: OpenPosition) => void;
  closing: boolean;
}

export function OpenPositionsTable(props: OpenPositionsTableProps) {
  const {
    positions,
    livePrices,
    onRefresh,
    closeTarget,
    onCloseTargetChange,
    onConfirmClose,
    closing,
  } = props;

  const positionsSorted = [...positions].sort(
    (a, b) =>
      new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime(),
  );

  return (
    <Card className="lg:col-span-8 xl:col-span-9">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4 text-profit" />
            المراكز المفتوحة
            <Badge variant="secondary" className="text-xs">
              {fmtNum(positionsSorted.length)}
            </Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onRefresh} className="text-xs">
            <RefreshCw className="w-3.5 h-3.5 ml-1" />
            تحديث
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {positionsSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Clock className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">لا توجد مراكز مفتوحة حالياً</p>
            <p className="text-xs">ابدأ بتنفيذ أول أمر تداول من اللوحة الجانبية</p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <div className="lg:hidden px-3 py-1.5 text-xs text-muted-foreground border-b bg-muted/30">
              ← مرّر أفقياً لرؤية كل الأعمدة →
            </div>
            <table className="w-full text-xs min-w-[820px]">
              <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                <tr className="border-b">
                  <th className="text-right p-2 font-medium">السهم</th>
                  <th className="text-center p-2 font-medium">النوع</th>
                  <th className="text-center p-2 font-medium">الكمية</th>
                  <th className="text-center p-2 font-medium">سعر الدخول</th>
                  <th className="text-center p-2 font-medium">السعر الحالي</th>
                  <th className="text-center p-2 font-medium">القيمة السوقية</th>
                  <th className="text-center p-2 font-medium">P&amp;L غير محقق</th>
                  <th className="text-center p-2 font-medium">SL / TP</th>
                  <th className="text-center p-2 font-medium">منذ</th>
                  <th className="text-center p-2 font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {positionsSorted.map((pos) => {
                  const isBuy = pos.order_type === 'BUY';
                  const pnl = pos.unrealized_pnl ?? 0;
                  const livePx = livePrices[pos.ticker] ?? pos.current_price;
                  return (
                    <tr key={pos.id} className={`border-b transition-colors ${rowBgClass(pnl)}`}>
                      <td className="p-2">
                        <div className="font-mono font-semibold" dir="ltr">
                          {pos.ticker}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {ASSET_TYPE_LABELS[pos.asset_type as AssetType] ?? pos.asset_type}
                        </div>
                      </td>
                      <td className="p-2 text-center">
                        <Badge
                          variant="outline"
                          className={
                            isBuy
                              ? 'bg-profit/10 text-profit border border-profit/20 border-profit '
                              : 'bg-loss/10 text-loss border border-loss/20 border-loss '
                          }
                        >
                          {isBuy ? 'شراء' : 'بيع'}
                        </Badge>
                      </td>
                      <td className="p-2 text-center tabular-nums">{fmtNum(pos.shares)}</td>
                      <td className="p-2 text-center tabular-nums" dir="ltr">
                        {fmtPrice(pos.entry_price)}
                      </td>
                      <td className="p-2 text-center tabular-nums font-medium" dir="ltr">
                        {fmtPrice(livePx)}
                        {pos.current_price !== livePx && (
                          <span className="block text-xs text-muted-foreground">
                            ({fmtPrice(pos.current_price)})
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-center tabular-nums" dir="ltr">
                        {fmtEgp(pos.market_value)}
                      </td>
                      <td
                        className={`p-2 text-center tabular-nums font-semibold ${pnlColor(pnl)}`}
                      >
                        {pnl >= 0 ? '+' : ''}
                        {fmtEgp(pnl)}
                        <span className="block text-xs opacity-80">
                          ({pnl >= 0 ? '+' : ''}
                          {fmtPct(pos.unrealized_pnl_pct)}%)
                        </span>
                      </td>
                      <td className="p-2 text-center text-xs">
                        {pos.stop_loss != null ? (
                          <div className="text-loss tabular-nums" dir="ltr">
                            SL: {fmtPrice(pos.stop_loss)}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">SL: —</div>
                        )}
                        {pos.take_profit != null ? (
                          <div className="text-profit tabular-nums" dir="ltr">
                            TP: {fmtPrice(pos.take_profit)}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">TP: —</div>
                        )}
                      </td>
                      <td className="p-2 text-center text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgoAr(pos.opened_at)}
                      </td>
                      <td className="p-2 text-center">
                        <AlertDialog
                          open={closeTarget?.id === pos.id && !!closeTarget}
                          onOpenChange={(open) => {
                            if (!open) onCloseTargetChange(null);
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onCloseTargetChange(pos)}
                              className="h-7 text-xs px-2"
                            >
                              <X className="w-3 h-3 ml-1" />
                              إغلاق
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>تأكيد إغلاق المركز</AlertDialogTitle>
                              <AlertDialogDescription>
                                سيتم إغلاق مركز{' '}
                                <span className="font-mono font-semibold" dir="ltr">
                                  {closeTarget?.ticker}
                                </span>{' '}
                                ({closeTarget?.order_type === 'BUY' ? 'شراء' : 'بيع'}{' '}
                                {fmtNum(closeTarget?.shares ?? 0)} سهم) عند السعر الحالي{' '}
                                <span className="font-semibold tabular-nums" dir="ltr">
                                  {fmtPrice(closeTarget?.current_price ?? 0)}
                                </span>{' '}
                                ج.م. الربح/الخسارة المتوقع:{' '}
                                <span
                                  className={`font-semibold tabular-nums ${pnlColor(
                                    closeTarget?.unrealized_pnl,
                                  )}`}
                                >
                                  {(closeTarget?.unrealized_pnl ?? 0) >= 0 ? '+' : ''}
                                  {fmtEgp(closeTarget?.unrealized_pnl ?? 0)} ج.م
                                </span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={closing}>إلغاء</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (closeTarget) onConfirmClose(closeTarget);
                                }}
                                disabled={closing}
                                className="bg-loss hover:bg-loss text-white"
                              >
                                {closing ? (
                                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                ) : (
                                  <X className="w-4 h-4 ml-2" />
                                )}
                                تأكيد الإغلاق
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
