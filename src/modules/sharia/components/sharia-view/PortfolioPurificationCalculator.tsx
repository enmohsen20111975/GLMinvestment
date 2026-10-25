/**
 * sharia-view/PortfolioPurificationCalculator.tsx
 * ==============================================
 * Portfolio purification calculator.
 * POSTs {user_id, method, include_capital_gain} to /api/sharia/purification
 * and renders PortfolioResultCard on success.
 *
 * Extracted from ShariaView.tsx (1,478 LOC) in Task F-Phase3-FinalPush.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Scale, Users } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAppStore } from '@/lib/store';
import type { PurificationResponse } from './types';
import { Alert, safeNumber } from './helpers';

export function PortfolioPurificationCalculator() {
  const user = useAppStore((s) => s.user);
  const [userId, setUserId] = useState('');
  const [method, setMethod] = useState('S&P');
  const [includeCapitalGain, setIncludeCapitalGain] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) setUserId(user.id);
  }, [user?.id]);

  const canSubmit = userId.trim().length > 0 && !loading;

  const handleCalculate = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/sharia/purification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId.trim(),
          method,
          include_capital_gain: includeCapitalGain,
        }),
      });
      const json = (await res.json()) as PurificationResponse & Record<string, unknown>;
      if (!json.success) {
        throw new Error(json.error || json.detail || 'فشل الحساب');
      }
      setResult(json);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [userId, method, includeCapitalGain, canSubmit]);

  return (
    <Card className="border-warning ">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="w-4 h-4 text-warning" />
          تطهير المحفظة بالكامل
        </CardTitle>
        <CardDescription className="text-xs">
          احسب إجمالي قيمة التطهير الواجب إخراجها لكامل محفظتك عبر أسهم متعددة.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">معرّف المستخدم</label>
            <Input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="معرّف حسابك في المنصة"
              dir="ltr"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">المنهجية</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="S&P">معيار S&P (أساسي)</SelectItem>
                <SelectItem value="musaffa">مصفّى</SelectItem>
                <SelectItem value="kashif">كاشف</SelectItem>
                <SelectItem value="osoul">أسطول</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeCapitalGain}
            onChange={(e) => setIncludeCapitalGain(e.target.checked)}
            className="w-4 h-4 rounded border-border accent-profit"
          />
          تضمين الأرباح الرأسمالية المحققة
        </label>

        <Button
          onClick={handleCalculate}
          disabled={!canSubmit}
          className="w-full bg-warning hover:bg-warning text-white gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              جارٍ حساب المحفظة...
            </>
          ) : (
            <>
              <Scale className="w-4 h-4" />
              احسب تطهير المحفظة
            </>
          )}
        </Button>

        {error && <Alert variant="error">{error}</Alert>}

        {result && <PortfolioResultCard result={result} />}
      </CardContent>
    </Card>
  );
}

export function PortfolioResultCard({ result }: { result: Record<string, unknown> }) {
  // Try common fields the calculator may return; fall back gracefully.
  const totalPurification = safeNumber(result.total_purification ?? result.purification_amount ?? result.purification);
  const tradesCount = safeNumber(result.trades_count ?? result.positions_count ?? result.assets_count);
  const totalDividends = safeNumber(result.total_dividends ?? result.dividends);
  const totalCapitalGain = safeNumber(result.total_realized_capital_gain ?? result.realized_capital_gain);
  const perSymbol = Array.isArray(result.per_symbol) ? (result.per_symbol as Array<Record<string, unknown>>) : [];

  return (
    <div className="rounded-lg border-2 border-profit from-profit to-profit /30 /10 /30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-profit font-semibold">
            إجمالي التطهير للمحفظة
          </p>
          <p className="text-2xl font-bold text-profit tabular-nums" dir="ltr">
            {totalPurification != null ? `${totalPurification.toFixed(2)} ج.م` : '—'}
          </p>
        </div>
        <div className="text-left">
          <p className="text-xs text-muted-foreground">عدد المراكز</p>
          <p className="text-sm font-bold tabular-nums">{tradesCount != null ? tradesCount : '—'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-md border border-border bg-background/60 p-2">
          <p className="text-xs text-muted-foreground">إجمالي التوزيعات</p>
          <p className="text-sm font-bold tabular-nums" dir="ltr">
            {totalDividends != null ? totalDividends.toFixed(2) : '—'}
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/60 p-2">
          <p className="text-xs text-muted-foreground">إجمالي الربح المحقق</p>
          <p className="text-sm font-bold tabular-nums" dir="ltr">
            {totalCapitalGain != null ? totalCapitalGain.toFixed(2) : '—'}
          </p>
        </div>
      </div>

      {perSymbol.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1">تفصيل لكل سهم</p>
          <div className="rounded-md border border-border overflow-hidden max-h-48 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">السهم</TableHead>
                  <TableHead className="text-xs text-center">الكمية</TableHead>
                  <TableHead className="text-xs text-center">قيمة التطهير</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perSymbol.map((row, i) => (
                  <TableRow key={String(row.symbol || i)} className="text-xs">
                    <TableCell className="font-mono font-medium">
                      {String(row.symbol || row.ticker || '—')}
                    </TableCell>
                    <TableCell className="text-center tabular-nums" dir="ltr">
                      {safeNumber(row.quantity ?? row.shares) != null
                        ? safeNumber(row.quantity ?? row.shares)?.toString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-center tabular-nums font-bold text-warning " dir="ltr">
                      {safeNumber(row.purification_amount ?? row.purification ?? row.amount) != null
                        ? `${safeNumber(row.purification_amount ?? row.purification ?? row.amount)?.toFixed(2)}`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
