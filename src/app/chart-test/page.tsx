'use client';

import React, { useState, useEffect } from 'react';
import { PremiumChart } from '@/components/premium-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp } from 'lucide-react';

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
  const [tradePlan, setTradePlan] = useState<any>({
    entry: 12.8,
    stop: 11.9,
    target1: 14.2,
    target2: 15.5,
    target3: 17.0,
    riskReward: 2.1,
  });

  useEffect(() => {
    const data = generateMockOhlcv(90);
    setOhlcv(data);
    setIndicators({
      sma20: generateSMA(data, 20),
      sma50: generateSMA(data, 50),
      sma200: [], // مش هنولّد 200 يوم لأن عندنا 90 بس
    });
  }, [refreshKey]);

  return (
    <div className="min-h-screen bg-background p-4 space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-profit" />
              اختبار الشارت المتميز — PremiumChart
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                COMI · تجريبي
              </Badge>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>تعليمات الاختبار</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>• الزر الأيمن فوق الشارت فيه أدوات الرسم: خط اتجاه، خط أفقي، مستطيل، فيبوناتشي، فرشاة، نص، سهم.</p>
          <p>• ارسم خط اتجاه: اختار أداة "خط اتجاه" ثم اضغط نقطتين على الشارت.</p>
          <p>• للتراجع: Ctrl+Z — للإعادة: Ctrl+Y — للحذف: Delete بعد اختيار رسم.</p>
          <p>• الرسومات بتتحفظ تلقائياً في المتصفح (localStorage) حسب السهم والفترة.</p>
          <p>• خطوط الدخول/الوقف/الأهداف ظاهرة كخطوط أفقية على الشارت.</p>
          <p>• المؤشرات (SMA 20/50) ظاهرة كخطوط ملوّنة على الشارت.</p>
        </CardContent>
      </Card>
    </div>
  );
}
