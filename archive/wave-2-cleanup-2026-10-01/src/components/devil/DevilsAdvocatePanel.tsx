'use client';

/**
 * DevilsAdvocatePanel (P1-GEMS-WIRING)
 * ====================================
 * لوحة موحّدة لكل مكوّنات "وجهة نظر المضاد" (Devil's Advocate):
 *   - DevilsCard       : بطاقة الرأي المخالف لسهم محدد
 *   - MarketMood       : حرارة السوق ومؤشراته
 *   - DevilsCalendar   : تقويم الأحداث الجايّة
 *   - ScenarioMatrix   : مصفوفة السيناريوهات لسهم
 *
 * المكوّنات الأربعة كانت موجودة كـ lib + UI components لكنها لم تُربط في
 * أي شاشة. هذا التبويب بيجلّهم مع بعض في تبويب واحد بـ layout أكورديون.
 *
 * يتم تركيبه كتبويب "وجهة نظر المضاد" في MarketAnalysisView.
 *
 * Constitution: Next.js display-only — كل المنطق عبر API routes (الـ lib
 * modules المستخدمة في backend موجودة في src/lib/devil/* — الـ UI
 * components بتقراها من /api/devil/*).
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Search,
  Flame,
  Calendar,
  Layers3,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MarketType } from '@/lib/store';
import { useAppStore } from '@/lib/store';

// Lazy-load the 4 devil components to keep the bundle split — each is
// fetched on demand when its tab is activated.
import dynamic from 'next/dynamic';

const DevilsCard = dynamic(
  () => import('@/components/devil/DevilsCard').then(m => ({ default: m.DevilsCard })),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted-foreground">جارٍ التحميل...</div> },
);
const MarketMood = dynamic(
  () => import('@/components/devil/MarketMood').then(m => ({ default: m.MarketMood })),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted-foreground">جارٍ التحميل...</div> },
);
const DevilsCalendar = dynamic(
  () => import('@/components/devil/DevilsCalendar').then(m => ({ default: m.DevilsCalendar })),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted-foreground">جارٍ التحميل...</div> },
);
const ScenarioMatrix = dynamic(
  () => import('@/components/devil/ScenarioMatrix').then(m => ({ default: m.ScenarioMatrix })),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted-foreground">جارٍ التحميل...</div> },
);

interface DevilsAdvocatePanelProps {
  market?: MarketType;
}

/**
 * Pick a sensible default ticker for the DevilsCard / ScenarioMatrix
 * based on the currently selected market.
 */
function useDefaultTicker(): string {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const selectedTicker = useAppStore((s) => s.selectedTicker);
  if (selectedTicker) return selectedTicker;
  // Market-aware fallbacks — these are liquid, well-known symbols.
  switch (currentMarket) {
    case 'CRYPTO': return 'BTC';
    case 'TADAWUL': return '2222'; // ARAMCO
    case 'KSE': return 'COMI';
    case 'QSE': return 'QIB';
    case 'EGX':
    default: return 'COMI'; // Commercial International Bank — always-liquid EGX bellwether
  }
}

export function DevilsAdvocatePanel({ market: _market }: DevilsAdvocatePanelProps) {
  const defaultTicker = useDefaultTicker();
  const [ticker, setTicker] = useState(defaultTicker);
  const [tickerInput, setTickerInput] = useState(defaultTicker);

  // Keep the local input box in sync with the default ticker when the market
  // changes (e.g. user switches from EGX to CRYPTO).
  React.useEffect(() => {
    setTicker(defaultTicker);
    setTickerInput(defaultTicker);
  }, [defaultTicker]);

  const applyTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) setTicker(t);
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header — explain what this tab does */}
      <Card className="border-amber-500/30 bg-gradient-to-l from-amber-500/5 via-red-500/5 to-orange-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-lg">😈</span>
                وجهة نظر المضاد (Devil's Advocate)
              </CardTitle>
              <CardDescription className="text-xs mt-1 max-w-2xl">
                الرأي المخالف للخبر — بيجيب الفجوات بين تحليل السهم والواقع.
                بيحلل: حرارة السوق، الأحداث الجاية، مصفوفة السيناريوهات،
                وكارت الشيطان للسهم المختار.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Ticker picker — used by DevilsCard + ScenarioMatrix */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">
                اختر رمز السهم (للكارت + مصفوفة السيناريوهات)
              </label>
              <Input
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') applyTicker(); }}
                placeholder="مثال: COMI, ETEL, BTC..."
                className="font-mono text-sm"
              />
            </div>
            <Button variant="default" size="sm" onClick={applyTicker}>
              <Search className="h-3.5 w-3.5 ml-1" />
              تحليل
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabbed layout — each tab is one of the 4 devil components */}
      <Tabs defaultValue="mood" className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto gap-1">
          <TabsTrigger value="mood" className="flex items-center gap-1 py-2">
            <Flame className="h-3.5 w-3.5" />
            <span className="text-xs">حرارة السوق</span>
          </TabsTrigger>
          <TabsTrigger value="card" className="flex items-center gap-1 py-2">
            <span className="text-base">😈</span>
            <span className="text-xs">كارت الشيطان</span>
          </TabsTrigger>
          <TabsTrigger value="scenario" className="flex items-center gap-1 py-2">
            <Layers3 className="h-3.5 w-3.5" />
            <span className="text-xs">مصفوفة السيناريوهات</span>
          </TabsTrigger>
          <TabsTrigger value="calendar" className="flex items-center gap-1 py-2">
            <Calendar className="h-3.5 w-3.5" />
            <span className="text-xs">تقويم الأحداث</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mood" className="mt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-500" />
                مقياس السوق
              </CardTitle>
              <CardDescription className="text-xs">
                حرارة السوق + الصاعدين/الهابطين + السيولة + القرار — يتحدث كل دقيقة
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MarketMood />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="card" className="mt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="text-base">😈</span>
                كارت الشيطان — <span className="font-mono text-xs">{ticker}</span>
              </CardTitle>
              <CardDescription className="text-xs">
                الرأي المخضعِن للخبير المتمرس — يكشف المخاطر قبل الفرصة
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DevilsCard key={ticker} ticker={ticker} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scenario" className="mt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-purple-500" />
                مصفوفة السيناريوهات — <span className="font-mono text-xs">{ticker}</span>
              </CardTitle>
              <CardDescription className="text-xs">
                سيناريوهات صعودي/هبوطي/محايد مع احتمالاتهم وأهداف الأسعار
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScenarioMatrix key={ticker} ticker={ticker} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="mt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4 text-rose-500" />
                تقويم الشيطان
              </CardTitle>
              <CardDescription className="text-xs">
                الأحداث الجاية اللي هتحرك السوق — مع اللعب المقترح لكل حدث
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DevilsCalendar />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default DevilsAdvocatePanel;
