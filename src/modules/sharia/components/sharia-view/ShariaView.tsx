/**
 * sharia-view/ShariaView.tsx (container)
 * =====================================
 * Main ShariaView container — Islamic-finance Sharia compliance screen
 * for the EGX (253 stocks, 8 sources). Hosts 3 tabs:
 *   1. stocks       → ShariaStocksListTab (grid + filters + pagination)
 *   2. single       → SingleTradePurificationCalculator (one trade)
 *   3. portfolio    → PortfolioPurificationCalculator (full portfolio)
 *
 * Originally 1,478 LOC (single file). Split into sharia-view/ folder in
 * Task F-Phase3-FinalPush. Container now orchestrates tab state + detail
 * modal visibility. All UI primitives live in dedicated sub-modules.
 *
 * Reference:
 * - Constitution Rule 4 (NO-NEW-SCREENS): explicit owner exception.
 * - Constitution Rule 30 (CLIENT-FACING-STYLE): formal Arabic.
 * - Constitution Rule 29 (NO-HYPE): neutral informational tone.
 * - Constitution Rule 62 (GIT-PUSH-DISCIPLINE).
 */

'use client';

import React, { useCallback, useState } from 'react';
import {
  Building2,
  Calculator,
  Info,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';
import { GoldBorder, IslamicPattern, OrnamentDivider } from './helpers';
import { ShariaStocksListTab } from './ShariaStocksListTab';
import { SingleTradePurificationCalculator } from './SingleTradePurificationCalculator';
import { PortfolioPurificationCalculator } from './PortfolioPurificationCalculator';
import { ShariaStockDetailModal } from './ShariaStockDetailModal';

export function ShariaView() {
  const [activeTab, setActiveTab] = useState<'stocks' | 'single' | 'portfolio'>('stocks');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [defaultCalcSymbol, setDefaultCalcSymbol] = useState<string>('');

  const openDetail = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
  }, []);

  const openCalculatorForSymbol = useCallback((symbol: string) => {
    setDefaultCalcSymbol(symbol);
    setActiveTab('single');
    setSelectedSymbol(null);
    toast.info(`تم ضبط حاسبة التطهير على السهم ${symbol}`);
  }, []);

  return (
    <div className="min-h-screen via-background to-background /10">
      <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-4" dir="rtl">
        {/* Hero header */}
        <Card className="relative overflow-hidden border-profit from-profit via-profit to-profit text-profit">
          <IslamicPattern />
          <CardContent className="relative p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-6 h-6 text-warning" />
                  <h1 className="text-xl sm:text-2xl font-bold">شاشة التوافق الشرعي</h1>
                </div>
                <p className="text-xs sm:text-sm text-profit/90 max-w-2xl leading-relaxed">
                  بيانات التوافق الشرعي لأسهم البورصة المصرية من ثمانية مصادر متخصصة، مع
                  حاسبة تطهير الأرباح وفق معيار S&P الشرعي وحاسبة تطهير المحفظة بالكامل.
                </p>
              </div>
              <div className="text-left">
                <div className="text-xs uppercase tracking-wider text-profit/80">
                  المنهجية الأساسية
                </div>
                <div className="text-lg font-bold text-warning">معيار S&P</div>
                <div className="text-xs text-profit/70 mt-0.5">
                  8 مصادر · تحديث أسبوعي
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <GoldBorder />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="stocks" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Building2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">قائمة الأسهم</span>
              <span className="sm:hidden">الأسهم</span>
            </TabsTrigger>
            <TabsTrigger value="single" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Calculator className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">حاسبة تطهير صفقة</span>
              <span className="sm:hidden">صفقة</span>
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">تطهير المحفظة</span>
              <span className="sm:hidden">المحفظة</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stocks" className="mt-3">
            <ShariaStocksListTab onOpenDetail={openDetail} />
          </TabsContent>

          <TabsContent value="single" className="mt-3">
            <SingleTradePurificationCalculator defaultSymbol={defaultCalcSymbol} />
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Info className="w-3 h-3" />
              الحساب يتم عبر محرك Python المعتمد (vps-service/portfolio/purification_calculator.py) لضمان الدقة.
            </p>
          </TabsContent>

          <TabsContent value="portfolio" className="mt-3">
            <PortfolioPurificationCalculator />
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Info className="w-3 h-3" />
              يتم حساب التطهير لكل صفقة نشطة في محفظتك ثم جمعها. قد يستغرق الحساب بضع ثوانٍ.
            </p>
          </TabsContent>
        </Tabs>

        {/* Footer note */}
        <OrnamentDivider />
        <p className="text-xs text-muted-foreground text-center px-4 pb-2 leading-relaxed">
          البيانات مصدرها ثمانية مواقع متخصصة في التوافق الشرعي (بورصة حلال، مصفّى، كاشف،
          حلال إنفست، بنك فيصل الإسلامي، أسطول، ثندر/Islamicly، جروب الأسهم الشرعية فقط) ويتم
          تحديثها أسبوعياً. الإجماع يعني توافق 6 مصادر أو أكثر. هذه المعلومات للاسترشاد فقط ولا تُغني
          عن الفتوى المتخصصة.
        </p>
      </div>

      {/* Detail modal */}
      <ShariaStockDetailModal
        symbol={selectedSymbol}
        onClose={() => setSelectedSymbol(null)}
      />

      {/* Hidden helper to allow "calculate for this symbol" shortcut from modal — kept in scope */}
      <button
        type="button"
        aria-hidden
        style={{ display: 'none' }}
        onClick={() => selectedSymbol && openCalculatorForSymbol(selectedSymbol)}
      />
    </div>
  );
}

export default ShariaView;
