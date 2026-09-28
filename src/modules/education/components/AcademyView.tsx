'use client';

// P40-ACADEMY: Main view wrapper — combines all 5 pillars in tabs.
// Pillar 1: PaperTradingWorkstation (built by P40-1 in parallel).
// Pillar 2: CandlestickSimulator (built by P40-2 in parallel).
// Pillar 3: StrategySandbox (built by P40-3 in parallel).
// Pillar 4: AcademyEncyclopedia (built locally — P40-4).
// Pillar 5: LessonPDFExporter (built locally — P40-4, used by Pillar 4).

import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AcademyEncyclopedia } from './AcademyEncyclopedia';
import { PaperTradingWorkstation } from './PaperTradingWorkstation';
import { CandlestickSimulator } from './CandlestickSimulator';
import { StrategySandbox } from './StrategySandbox';

export function AcademyView() {
  return (
    <div className="flex min-h-screen flex-col" dir="rtl">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-2xl" role="img" aria-label="أكاديمية">
              🎓
            </span>
            <h1 className="text-lg font-bold leading-tight sm:text-xl">
              أكاديمية M2y التعليمية ومحاكي التداول الحي
            </h1>
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            تعلّم الأساسيات، تدرّب على التداول الورقي بالأسعار الحقيقية، وابنِ استراتيجيتك
            بثقة — كل ذلك في مكان واحد.
          </p>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6">
        <Tabs defaultValue="encyclopedia" className="w-full">
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
            <TabsTrigger value="encyclopedia">📚 الموسوعة</TabsTrigger>
            <TabsTrigger value="paper-trading">💻 التداول الورقي</TabsTrigger>
            <TabsTrigger value="candle-sim">🕯️ محاكي الشموع</TabsTrigger>
            <TabsTrigger value="strategy-lab">📊 مختبر الاستراتيجيات</TabsTrigger>
          </TabsList>

          <TabsContent value="encyclopedia" className="mt-4 focus-visible:outline-none">
            <AcademyEncyclopedia />
          </TabsContent>
          <TabsContent value="paper-trading" className="mt-4 focus-visible:outline-none">
            <PaperTradingWorkstation />
          </TabsContent>
          <TabsContent value="candle-sim" className="mt-4 focus-visible:outline-none">
            <CandlestickSimulator />
          </TabsContent>
          <TabsContent value="strategy-lab" className="mt-4 focus-visible:outline-none">
            <StrategySandbox />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30" dir="rtl">
        <div className="mx-auto max-w-7xl px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
          M2y Academy — تعلّم، تدرّب، ثم استثمر بثقة
        </div>
      </footer>
    </div>
  );
}

export default AcademyView;
