'use client';

/**
 * academy/AcademyView.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Container extracted from AcademyView.tsx
 * (originally 2,357 LOC, now a 19-LOC Strangler re-export shim).
 * ----------------------------------------------------------------------------
 * Main view wrapper — combines all 8 academy tabs:
 *   1) 📚 الموسوعة         — AcademyEncyclopedia (P40-4)
 *   2) 💻 التداول الورقي   — PaperTradingWorkstation (P40-1)
 *   3) 🕯️ محاكي الشموع     — CandlestickSimulator (P40-2)
 *   4) 📊 مختبر الاستراتيجيات — StrategySandbox (P40-3)
 *   5) 🎓 دروس متقدمة      — AdvancedLessonsTab (Rule 63)
 *   6) 📈 أرض التداول      — TradingFloorView (Task 30-B)
 *   7) 🧮 الأدوات العملية   — PracticalToolsView (Task 32)
 *   8) 🔬 المختبر المتقدم  — AdvancedLabView (Task 36-B/C)
 *
 * Container owns ZERO data-fetching logic — everything is delegated to either
 * the useAcademy*Data hooks (Phase 2 Strangler) or the individual sub-component
 * files in this folder.
 * ============================================================================
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AcademyEncyclopedia } from '../AcademyEncyclopedia';
import { PaperTradingWorkstation } from '../PaperTradingWorkstation';
import { CandlestickSimulator } from '../CandlestickSimulator';
import { StrategySandbox } from '../StrategySandbox';
import { AdvancedLessonsTab } from './AdvancedLessonsTab';
import { TradingFloorView } from './TradingFloorView';
import { PracticalToolsView } from './PracticalToolsView';
import { AdvancedLabView } from './AdvancedLabView';

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
              أكاديمية دليل الاستثمار التعليمية ومحاكي التداول الحي
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
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <TabsTrigger value="encyclopedia">📚 الموسوعة</TabsTrigger>
            <TabsTrigger value="paper-trading">💻 التداول الورقي</TabsTrigger>
            <TabsTrigger value="candle-sim">🕯️ محاكي الشموع</TabsTrigger>
            <TabsTrigger value="strategy-lab">📊 مختبر الاستراتيجيات</TabsTrigger>
            <TabsTrigger value="advanced-lessons">🎓 دروس متقدمة</TabsTrigger>
            <TabsTrigger value="trading-floor">
              <span className="text-profit ">📈</span> أرض التداول
            </TabsTrigger>
            <TabsTrigger value="practical-tools">
              <span className="text-warning ">🧮</span> الأدوات العملية
            </TabsTrigger>
            <TabsTrigger value="advanced-lab">
              <span className="text-profit ">🔬</span> المختبر المتقدم
            </TabsTrigger>
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
          <TabsContent value="advanced-lessons" className="mt-4 focus-visible:outline-none">
            <AdvancedLessonsTab />
          </TabsContent>
          <TabsContent value="trading-floor" className="mt-4 focus-visible:outline-none">
            <TradingFloorView />
          </TabsContent>
          <TabsContent value="practical-tools" className="mt-4 focus-visible:outline-none">
            <PracticalToolsView />
          </TabsContent>
          <TabsContent value="advanced-lab" className="mt-4 focus-visible:outline-none">
            <AdvancedLabView />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30" dir="rtl">
        <div className="mx-auto max-w-7xl px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
          أكاديمية دليل الاستثمار — تعلّم، تدرّب، ثم استثمر بثقة
        </div>
      </footer>
    </div>
  );
}

export default AcademyView;
