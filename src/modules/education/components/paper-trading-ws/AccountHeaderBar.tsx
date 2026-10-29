/**
 * paper-trading-ws/AccountHeaderBar.tsx
 * ======================================
 * Account header bar — virtual_balance, total_equity, total_pnl,
 * win_rate, total_trades, reset button (with AlertDialog confirmation).
 *
 * Extracted from PaperTradingWorkstation.tsx (1,550 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import {
  Activity,
  DollarSign,
  Loader2,
  Percent,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { fmtEgp, fmtNum, fmtPct, pnlColor } from './helpers';
import type { PaperTradingAccount } from './types';

export interface AccountHeaderBarProps {
  account: PaperTradingAccount;
  resetting: boolean;
  onReset: () => void;
}

export function AccountHeaderBar({ account, resetting, onReset }: AccountHeaderBarProps) {
  const pnlIsProfit = (account.total_pnl ?? 0) >= 0;
  return (
    <Card className="border-profit ">
      <CardContent className="pt-5 pb-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
          {/* Account title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-11 h-11 rounded-full bg-profit/10 text-profit border border-profit/20 ">
              <Wallet className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate">حساب التداول الورقي</h2>
              <p className="text-xs text-muted-foreground">رصيد افتراضي 100,000 ج.م</p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 flex-1">
            {/* Virtual balance */}
            <div className="rounded-lg border bg-card p-2.5">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                <DollarSign className="w-3 h-3" />
                الرصيد المتاح
              </div>
              <div className="text-sm font-bold tabular-nums">
                {fmtEgp(account.virtual_balance)}
                <span className="text-xs text-muted-foreground mr-1">ج.م</span>
              </div>
            </div>
            {/* Total equity */}
            <div className="rounded-lg border bg-card p-2.5">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                <Activity className="w-3 h-3" />
                إجمالي حقوق الملكية
              </div>
              <div className="text-sm font-bold tabular-nums">
                {fmtEgp(account.total_equity)}
                <span className="text-xs text-muted-foreground mr-1">ج.م</span>
              </div>
            </div>
            {/* Total P&L */}
            <div className="rounded-lg border bg-card p-2.5">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                {pnlIsProfit ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                إجمالي الربح/الخسارة
              </div>
              <div
                className={`text-sm font-bold tabular-nums ${pnlColor(account.total_pnl)}`}
              >
                {pnlIsProfit ? '+' : ''}
                {fmtEgp(account.total_pnl)}
                <span className="text-xs text-muted-foreground mr-1">ج.م</span>
              </div>
            </div>
            {/* Win rate */}
            <div className="rounded-lg border bg-card p-2.5">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                <Percent className="w-3 h-3" />
                معدل الربح
              </div>
              <div className="text-sm font-bold tabular-nums">
                {fmtPct(account.win_rate)}%
              </div>
            </div>
            {/* Total trades */}
            <div className="rounded-lg border bg-card p-2.5 col-span-2 md:col-span-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                <Zap className="w-3 h-3" />
                إجمالي الصفقات
              </div>
              <div className="text-sm font-bold tabular-nums">
                {fmtNum(account.total_trades)}
              </div>
            </div>
          </div>

          {/* Reset button */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={resetting}
                className="shrink-0"
              >
                {resetting ? (
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 ml-2" />
                )}
                تصفير الحساب
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>تأكيد تصفير الحساب الورقي</AlertDialogTitle>
                <AlertDialogDescription>
                  سيتم إلغاء جميع الصفقات المفتوحة وإعادة الرصيد إلى 100,000 ج.م. لا
                  يمكن التراجع عن هذه العملية. هل أنت متأكد؟
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={resetting}>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    onReset();
                  }}
                  disabled={resetting}
                  className="bg-loss hover:bg-loss text-white"
                >
                  {resetting ? (
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  ) : null}
                  نعم، صفّر الحساب
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
