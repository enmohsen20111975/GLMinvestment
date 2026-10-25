/**
 * sharia-view/SingleTradePurificationCalculator.tsx
 * ================================================
 * Purification calculator for a single trade.
 * POSTs {symbol, quantity, buy_price?, sell_price?, method, include_capital_gain}
 * to /api/sharia/purification and renders PurificationResultCard on success.
 *
 * Extracted from ShariaView.tsx (1,478 LOC) in Task F-Phase3-FinalPush.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';
import type { PurificationResponse } from './types';
import { formatPct, Alert } from './helpers';

export interface PurificationCalculatorProps {
  defaultSymbol?: string;
}

export function SingleTradePurificationCalculator({ defaultSymbol }: PurificationCalculatorProps) {
  const [symbol, setSymbol] = useState(defaultSymbol || '');
  const [quantity, setQuantity] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [method, setMethod] = useState('S&P');
  const [includeCapitalGain, setIncludeCapitalGain] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PurificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultSymbol) setSymbol(defaultSymbol);
  }, [defaultSymbol]);

  const canSubmit =
    symbol.trim().length > 0 &&
    Number(quantity) > 0 &&
    !loading;

  const handleCalculate = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        symbol: symbol.trim().toUpperCase(),
        quantity: Number(quantity),
        method,
        include_capital_gain: includeCapitalGain,
      };
      const buy = Number(buyPrice);
      const sell = Number(sellPrice);
      if (Number.isFinite(buy) && buy > 0) body.buy_price = buy;
      if (Number.isFinite(sell) && sell > 0) body.sell_price = sell;

      const res = await fetch('/api/sharia/purification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as PurificationResponse;
      if (!json.success) {
        throw new Error(json.error || json.detail || 'فشل الحساب');
      }
      setResult(json);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [symbol, quantity, buyPrice, sellPrice, method, includeCapitalGain, canSubmit]);

  return (
    <Card className="border-profit ">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="w-4 h-4 text-profit" />
          حاسبة تطهير صفقة واحدة
        </CardTitle>
        <CardDescription className="text-xs">
          أدخل رمز السهم وعدد الأسهم وسعري الشراء والبيع لحساب قيمة التطهير الواجب إخراجها.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">رمز السهم</label>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="مثال: ABUK"
              className="font-mono"
              dir="ltr"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">عدد الأسهم</label>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="مثال: 500"
              dir="ltr"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">سعر الشراء (ج.م)</label>
            <Input
              type="number"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              placeholder="اختياري"
              dir="ltr"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">سعر البيع (ج.م)</label>
            <Input
              type="number"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              placeholder="اختياري"
              dir="ltr"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
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
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeCapitalGain}
              onChange={(e) => setIncludeCapitalGain(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-profit"
            />
            تضمين الربح الرأسمالي المحقق
          </label>
        </div>

        <Button
          onClick={handleCalculate}
          disabled={!canSubmit}
          className="w-full bg-profit hover:bg-profit text-white gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              جارٍ الحساب...
            </>
          ) : (
            <>
              <Calculator className="w-4 h-4" />
              احسب قيمة التطهير
            </>
          )}
        </Button>

        {error && (
          <Alert variant="error">{error}</Alert>
        )}

        {result && (
          <PurificationResultCard result={result} />
        )}
      </CardContent>
    </Card>
  );
}

export function PurificationResultCard({ result }: { result: PurificationResponse }) {
  const amount = typeof result.purification_amount === 'number' ? result.purification_amount : null;
  const rate = typeof result.purification_rate_pct === 'number' ? result.purification_rate_pct : null;
  const dividends = typeof result.dividends === 'number' ? result.dividends : null;
  const capitalGain = typeof result.realized_capital_gain === 'number' ? result.realized_capital_gain : null;

  return (
    <div className="rounded-lg border-2 border-warning from-warning to-warning dark:dark:dark:p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-warning font-semibold">
            قيمة التطهير الواجبة
          </p>
          <p className="text-2xl font-bold text-warning tabular-nums" dir="ltr">
            {amount != null ? `${amount.toFixed(2)} ج.م` : '—'}
          </p>
        </div>
        <div className="text-left">
          <p className="text-xs text-muted-foreground">المنهجية</p>
          <p className="text-xs font-bold">{result.method || result.primary_method || 'S&P'}</p>
        </div>
      </div>
      <Separator className="my-2 bg-warning " />
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-muted-foreground">نسبة التطهير</p>
          <p className="text-sm font-bold tabular-nums" dir="ltr">{formatPct(rate)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">التوزيعات</p>
          <p className="text-sm font-bold tabular-nums" dir="ltr">
            {dividends != null ? `${dividends.toFixed(2)}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">الربح المحقق</p>
          <p className="text-sm font-bold tabular-nums" dir="ltr">
            {capitalGain != null ? `${capitalGain.toFixed(2)}` : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
