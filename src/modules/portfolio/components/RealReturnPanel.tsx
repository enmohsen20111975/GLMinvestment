'use client';

/* ============================================================
   ROBO-ADVISOR-P3: RealReturnPanel — محرك العائد الحقيقي
   ============================================================
   - بيعرض معدل التضخم المصري
   - بيحسب العائد الحقيقي لكل أصل دخل ثابت (yield - inflation)
   - بيطلق تحذيرات "فلوسك بتذوب" للعائد السالب
   - فيه input لتعديل معدل التضخم يدوياً
   ============================================================ */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingDown, TrendingUp, RefreshCw, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AssetAnalysis {
  id: number;
  name: string;
  type: string;
  asset_class: string;
  annual_yield: number;
  inflation_rate: number;
  real_return: number;
  total_invested: number;
  real_loss_amount: number;
  warning: string | null;
  severity: 'none' | 'mild' | 'severe';
}

interface RealReturnData {
  success: boolean;
  inflation: { rate: number; source: string; date: string | null };
  assets: AssetAnalysis[];
  summary: {
    total_invested: number;
    weighted_yield: number;
    weighted_real_return: number;
    total_real_loss: number;
    has_warnings: boolean;
    warning_count: number;
  };
}

function formatEgp(n: number): string {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(Math.abs(n));
}

export function RealReturnPanel() {
  const [data, setData] = useState<RealReturnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [inflationInput, setInflationInput] = useState('');

  const fetchRealReturn = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/real-return', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setInflationInput(String(d.inflation?.rate || ''));
      }
    } catch (e) {
      console.error('[RealReturnPanel]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRealReturn();
  }, [fetchRealReturn]);

  const handleSetInflation = async () => {
    const rate = Number(inflationInput);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('أدخل نسبة تضخم صحيحة (0-100)');
      return;
    }
    try {
      const res = await fetch('/api/finance/inflation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate, source: 'manual' }),
      });
      if (res.ok) {
        toast.success(`تم تحديث معدل التضخم إلى ${rate}%`);
        fetchRealReturn();
      }
    } catch {
      toast.error('فشل تحديث التضخم');
    }
  };

  if (loading) {
    return (
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>جاري حساب العائد الحقيقي...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.success) {
    return (
      <Card className="border-border">
        <CardContent className="p-4 text-sm text-muted-foreground">
          تعذر حساب العائد الحقيقي. تأكد من وجود أصول في المحفظة.
        </CardContent>
      </Card>
    );
  }

  const inflation = data.inflation.rate;
  const hasWarnings = data.summary.has_warnings;

  return (
    <Card className={cn('border-border', hasWarnings && 'border-red-300 dark:border-red-800')}>
      <CardContent className="p-4 space-y-4">
        {/* العنوان + معدل التضخم */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Flame className={cn('h-5 w-5', hasWarnings ? 'text-red-500' : 'text-amber-500')} />
            <h3 className="font-bold text-base">محرك العائد الحقيقي</h3>
            {hasWarnings && (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border border-red-300">
                {data.summary.warning_count} تحذير
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">التضخم:</span>
            <Input
              type="number"
              value={inflationInput}
              onChange={(e) => setInflationInput(e.target.value)}
              className="w-20 h-8 text-sm"
              placeholder="30"
            />
            <span className="text-xs">%</span>
            <Button size="sm" variant="outline" onClick={handleSetInflation} className="h-8">حفظ</Button>
          </div>
        </div>

        {/* الملخص */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div className="p-2 rounded-md bg-muted/50">
            <div className="text-xs text-muted-foreground">إجمالي المستثمر</div>
            <div className="font-bold">{formatEgp(data.summary.total_invested)} ج.م</div>
          </div>
          <div className="p-2 rounded-md bg-muted/50">
            <div className="text-xs text-muted-foreground">العائد المرجح</div>
            <div className="font-bold text-green-600">{data.summary.weighted_yield.toFixed(1)}%</div>
          </div>
          <div className="p-2 rounded-md bg-muted/50">
            <div className="text-xs text-muted-foreground">العائد الحقيقي</div>
            <div className={cn('font-bold', data.summary.weighted_real_return < 0 ? 'text-red-600' : 'text-green-600')}>
              {data.summary.weighted_real_return.toFixed(1)}%
            </div>
          </div>
          <div className="p-2 rounded-md bg-muted/50">
            <div className="text-xs text-muted-foreground">خسارة حقيقية/سنة</div>
            <div className={cn('font-bold', data.summary.total_real_loss < 0 ? 'text-red-600' : 'text-muted-foreground')}>
              {data.summary.total_real_loss < 0 ? `${formatEgp(data.summary.total_real_loss)} ج.م` : '—'}
            </div>
          </div>
        </div>

        {/* التحذير العام */}
        {hasWarnings && inflation > 0 && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-red-700 dark:text-red-300">
                  ⚠️ فلوسك بتذوب! التضخم ({inflation.toFixed(1)}%) أعلى من عائد أصولك.
                </p>
                <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                  الخسارة الحقيقية المقدرة: {formatEgp(data.summary.total_real_loss)} ج.م سنوياً. حوّل جزء من محفظتك لأسهم أو ذهب للحفاظ على القيمة الشرائية.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* قائمة الأصول */}
        {data.assets.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">أصول الدخل الثابت ({data.assets.length})</h4>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {data.assets.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    'p-2.5 rounded-md border text-sm',
                    a.severity === 'severe' ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20' :
                    a.severity === 'mild' ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' :
                    'border-border bg-muted/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.name}</span>
                    <div className="flex items-center gap-1.5">
                      {a.real_return < 0 ? (
                        <TrendingDown className="h-4 w-4 text-red-500" />
                      ) : (
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      )}
                      <span className={cn('font-bold', a.real_return < 0 ? 'text-red-600' : 'text-green-600')}>
                        {a.real_return >= 0 ? '+' : ''}{a.real_return.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    <span>العائد: {a.annual_yield.toFixed(1)}%</span>
                    <span>التضخم: {a.inflation_rate.toFixed(1)}%</span>
                    {a.total_invested > 0 && <span>المستثمر: {formatEgp(a.total_invested)} ج.م</span>}
                  </div>
                  {a.warning && (
                    <p className="text-xs mt-1.5 text-red-600 dark:text-red-400 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      {a.warning}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.assets.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            مفيش أصول دخل ثابت في محفظتك. أضف شهادات إيداع أو صناديق دخل ثابت عشان تحسب العائد الحقيقي.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
