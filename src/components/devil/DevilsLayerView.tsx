'use client';

/**
 * 😈 طبقة الشيطان — الشاشة الرئيسية
 *
 * بتجمع:
 * - مقياس السوق (Market Mood)
 * - تقويم الشيطان (Devil's Calendar)
 * - كارت الشيطان لسهم محدد
 * - مصفوفة السيناريوهات
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Flame } from 'lucide-react';
import { MarketMood } from './MarketMood';
import { DevilsCalendar } from './DevilsCalendar';
import { DevilsCard } from './DevilsCard';
import { ScenarioMatrix } from './ScenarioMatrix';

const POPULAR_TICKERS = ['COMI', 'ETEL', 'SWDY', 'HRHO', 'TMGH', 'ABUK', 'CIEB', 'MFPC'];

export function DevilsLayerView() {
  const [ticker, setTicker] = useState('COMI');
  const [inputTicker, setInputTicker] = useState('COMI');

  const handleSearch = () => {
    const cleaned = inputTicker.trim().toUpperCase();
    if (cleaned) {
      setTicker(cleaned);
    }
  };

  return (
    <div className="space-y-4">
      {/* الهيدر */}
      <Card className="border-2 border-amber-500/30 bg-gradient-to-r from-amber-500/5 via-red-500/5 to-orange-500/5">
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <Flame className="h-7 w-7 text-amber-500" />
            😈 طبقة الشيطان — الخبير المخضرم
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            النظام بيقول «الخبر كويس → اشترِ». الشيطان بيقول «الخبر كويس بس السوق نزل → حد كبير بيبيع → ابعد».
          </p>
        </CardHeader>
      </Card>

      {/* مقياس السوق */}
      <MarketMood />

      <Tabs defaultValue="card" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="card">😈 كارت الشيطان</TabsTrigger>
          <TabsTrigger value="calendar">📅 التقويم</TabsTrigger>
        </TabsList>

        {/* كارت الشيطان + السيناريوهات */}
        <TabsContent value="card" className="space-y-4">
          {/* اختيار السهم */}
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-2 mb-3">
                <Input
                  value={inputTicker}
                  onChange={e => setInputTicker(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="اكتب رمز السهم (مثلاً: COMI)"
                  className="flex-1"
                />
                <Button onClick={handleSearch}>
                  <Search className="h-4 w-4 ml-1" /> حلل
                </Button>
              </div>

              {/* الأسهم الشائعة */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground self-center">شائع:</span>
                {POPULAR_TICKERS.map(t => (
                  <Button
                    key={t}
                    size="sm"
                    variant={t === ticker ? 'default' : 'outline'}
                    onClick={() => {
                      setTicker(t);
                      setInputTicker(t);
                    }}
                    className="h-7 text-xs"
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* كارت الشيطان */}
          <DevilsCard ticker={ticker} />

          {/* مصفوفة السيناريوهات */}
          <ScenarioMatrix ticker={ticker} />
        </TabsContent>

        {/* التقويم */}
        <TabsContent value="calendar">
          <DevilsCalendar />
        </TabsContent>
      </Tabs>
    </div>
  );
}
