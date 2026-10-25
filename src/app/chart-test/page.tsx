'use client';

import React, { useState, useEffect } from 'react';
import { PremiumChart } from '@/components/premium-chart';
import { TradingViewChart } from '@/modules/stock-analysis/components/TradingViewChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, PenTool, LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';

// بيانات تجريبية للشارت — شموع عشوائية بتتحرك
function generateMockOhlcv(days: number = 90) {
  const data = [];
  let price = 12.5;
  const now = Math.floor(Date.now() / 1000);
  for (let i = days; i > 0; i--) {
    const time = now - i * 86400;
    const open = price;
    const change = (Math.random() - 0.45) * 0.8;
    const close = Math.max(0.5, open + change);
    const high = Math.max(open, close) + Math.random() * 0.3;
    const low = Math.min(open, close) - Math.random() * 0.3;
    const volume = Math.floor(Math.random() * 1000000) + 50000;
    data.push({ time, open, high, low, close, volume });
    price = close;
  }
  return data;
}

function generateSMA(ohlcv: any[], period: number) {
  return ohlcv.map((_, i) => {
    if (i < period - 1) return { time: ohlcv[i].time, value: null };
    const sum = ohlcv.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0);
    return { time: ohlcv[i].time, value: sum / period };
  }).filter((d: any) => d.value !== null);
}

export default function ChartTestPage() {
  const [ohlcv, setOhlcv] = useState<any[]>([]);
  const [indicators, setIndicators] = useState<any>({});
  const [refreshKey, setRefreshKey] = useState(0);
  // ALPHA: تبديل بين PremiumChart و TradingViewChart (محفوظ في localStorage)
  const [usePremium, setUsePremium] = useState(() => {
    try {
      const saved = localStorage.getItem('trading-chart-preference');
      return saved === null ? true : saved === 'premium';
    } catch { return true; }
  });
  useEffect(() => {
    try {
      localStorage.setItem('trading-chart-preference', usePremium ? 'premium' : 'simple');
    } catch { /* ignore */ }
  }, [usePremium]);

  const tradePlan = {
    entry: 12.8,
    stop: 11.9,
    target1: 14.2,
    target2: 15.5,
    target3: 17.0,
    riskReward: 2.1,
  };

  useEffect(() => {
    const data = generateMockOhlcv(90);
    setOhlcv(data);
    setIndicators({
      sma20: generateSMA(data, 20),
      sma50: generateSMA(data, 50),
      sma200: [],
    });
  }, [refreshKey]);

  return (
    <div className="min-h-screen bg-background p-4 space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-profit" />
              اختبار الشارت — PremiumChart vs TradingViewChart
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">COMI · تجريبي</Badge>
              {/* تبديل الشارت */}
              <div className="flex bg-muted border border-border rounded-xl p-0.5 text-xs font-semibold gap-0.5">
                <button
                  type="button"
                  onClick={() => setUsePremium(true)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1',
                    usePremium
                      ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="شارت متميز — مع أدوات رسم تفاعلية ومؤشرات"
                >
                  <PenTool className="w-3 h-3" />
                  متميز
                </button>
                <button
                  type="button"
                  onClick={() => setUsePremium(false)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1',
                    !usePremium
                      ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="شارت بسيط — شارت TradingView العادي"
                >
                  <LineChart className="w-3 h-3" />
                  بسيط
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefreshKey(k => k + 1)}
              >
                <RefreshCw className="w-4 h-4 ml-1" />
                بيانات جديدة
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {usePremium ? (
            <PremiumChart
              ticker="COMI"
              stockName="البنك التجاري الدولي"
              ohlcv={ohlcv}
              indicators={indicators}
              tradePlan={tradePlan}
              livePrice={ohlcv[ohlcv.length - 1]?.close ?? null}
              currencyLabel="ج.م"
              height={500}
              showDrawingToolbar
              showIndicatorPanel
              showTradePlanLines
              showSMCZones
              storageKey="COMI__test"
            />
          ) : (
            <TradingViewChart ticker="COMI" stockName="البنك التجاري الدولي" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>تعليمات الاختبار</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>• <strong>الشارت المتميز:</strong> فيه أدوات رسم (خط اتجاه، مستطيل، فيبوناتشي، فرشاة، نص، سهم).</p>
          <p>• <strong>الشارت البسيط:</strong> شارت TradingView العادي بدون أدوات رسم.</p>
          <p>• التبديل بينهم بيتم حفظه تلقائياً في المتصفح (localStorage).</p>
          <p>• في الشارت المتميز: ارسم خط أفقي — اختار الأداة ثم اضغط على الشارت.</p>
          <p>• للتراجع: Ctrl+Z — للإعادة: Ctrl+Y — للحذف: Delete بعد اختيار رسم.</p>
        </CardContent>
      </Card>
    </div>
  );
}

