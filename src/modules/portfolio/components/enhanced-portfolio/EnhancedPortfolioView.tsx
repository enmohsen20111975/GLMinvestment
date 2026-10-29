'use client';

/**
 * enhanced-portfolio/EnhancedPortfolioView.tsx (container)
 * ============================================================================
 * F-Phase3-Split-Portfolio: Container component for the EnhancedPortfolioView.
 *
 * This is the main entry point — it renders the segmented control (المحفظة /
 * الأموال / إنقاذ سهم) and the 4-tab portfolio experience (assets / income /
 * obligations / reports) by importing the 4 tab sub-components + their shared
 * helpers/types from this same folder.
 *
 * Re-exports: original `src/modules/portfolio/components/EnhancedPortfolioView.tsx`
 * is now a 2-LOC re-export shim:
 *   export { EnhancedPortfolioView } from './enhanced-portfolio/EnhancedPortfolioView';
 *
 * Original file was 3,281 LOC; container alone is now ~170 LOC (< 500 LOC target).
 * ============================================================================
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Wallet, HandCoins, LifeBuoy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MultiPortfolioSelector } from '@/modules/portfolio/components/MultiPortfolioSelector';
import { MasterPortfolioSummary } from '@/modules/portfolio/components/MasterPortfolioSummary';
import { BagHolderRescuePanel } from '@/modules/portfolio/components/BagHolderRescuePanel';
import { AlertsCenterView } from '@/components/alerts/AlertsCenterView';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n-context';
import { AssetsTab } from './AssetsTab';
import { IncomeExpenseTab } from './IncomeExpenseTab';
import { ObligationsTab } from './ObligationsTab';
import { ReportsTab } from './ReportsTab';

// TASK 40-B (2026-10-04 — Nav Reorganization + Portfolio Merge):
// WealthCharts was previously a separate top-level tab (`#wealth`). Owner
// directive: merge it into the portfolio view as a sub-tab. Lazy-loaded
// (it pulls recharts + ~6 chart sub-components) to keep the initial
// portfolio bundle small.
const WealthCharts = dynamic(
        () => import('@/modules/admin/components/WealthCharts').then(m => ({ default: m.WealthCharts })),
        { ssr: false, loading: () => (
                <Card className="mt-4">
                        <CardContent className="p-6 text-sm text-muted-foreground">جاري تحميل رسوم الأموال…</CardContent>
                </Card>
        ) }
);

export function EnhancedPortfolioView() {
        const t = useTranslation();
        // MULTI-PORTFOLIO-032: selected portfolio state
        const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | 'master'>('master');
        const user = useAppStore((s) => s.user);
        // F1.3 — cleanup 'default' legacy: null if not authenticated (was 'default' fallback)
        const userId = user?.id || null;

        // TASK 40-B (2026-10-04 — Nav Reorganization + Portfolio Merge):
        // Owner directive: merge `wealth` + `bagholder-rescue` INTO the portfolio
        // view as sub-tabs so the user has ONE entry point (المحفظة) for everything
        // money-related. The 3-way segmented control below switches between:
        // • portfolio — the existing 4-tab portfolio experience (assets / income / obligations / reports)
        // • wealth — the WealthCharts dashboard (was previously its own top-level tab #wealth)
        // • rescue — BagHolderRescuePanel (was previously in the "More" menu as 🆘 إنقاذ سهم)
        // Hash links #wealth, #bagholder-rescue, #advanced-portfolio still route
        // through page.tsx's switch (backwards-compat preserved per Rule 67).
        const [portfolioMode, setPortfolioMode] = useState<'portfolio' | 'wealth' | 'rescue'>('portfolio');

        return (
                <div dir="rtl" className="min-h-screen bg-background pb-20 lg:pb-4">
                        <div className="p-4 md:p-6 space-y-6">
                                {/* Header */}
                                <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-profit/10 flex items-center justify-center">
                                                        {portfolioMode === 'portfolio' && <Wallet className="w-5 h-5 text-profit " />}
                                                        {portfolioMode === 'wealth' && <HandCoins className="w-5 h-5 text-warning " />}
                                                        {portfolioMode === 'rescue' && <LifeBuoy className="w-5 h-5 text-loss " />}
                                                </div>
                                                <div>
                                                        <h1 className="text-xl font-bold">
                                                                {portfolioMode === 'portfolio' && t('portfolio.title')}
                                                                {portfolioMode === 'wealth' && 'إدارة الأموال'}
                                                                {portfolioMode === 'rescue' && '🆘 إنقاذ سهم خسران'}
                                                        </h1>
                                                        <p className="text-sm text-muted-foreground">
                                                                {portfolioMode === 'portfolio' && t('portfolio.subtitle')}
                                                                {portfolioMode === 'wealth' && 'الرسوم البيانية لتطور الثروة وتوزيع الأصول'}
                                                                {portfolioMode === 'rescue' && 'محرك إنقاذ الأسهم المزنوقة — تحليل عميق وخطط خروج'}
                                                        </p>
                                                </div>
                                        </div>
                                </div>

                                {/* TASK 40-B: 3-way segmented control — المحفظة | الأموال | إنقاذ سهم */}
                                {/* Rule 30: emerald/amber/red accent only (no indigo/blue). */}
                                <div className="flex w-full rounded-lg border border-border bg-muted/40 p-1" role="tablist" aria-label="أقسام المحفظة">
                                        <button
                                                type="button"
                                                role="tab"
                                                aria-selected={portfolioMode === 'portfolio'}
                                                onClick={() => setPortfolioMode('portfolio')}
                                                className={cn(
                                                        'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
                                                        portfolioMode === 'portfolio'
                                                                ? 'bg-background text-profit shadow-sm'
                                                                : 'text-muted-foreground hover:text-foreground'
                                                )}
                                        >
                                                <Wallet className="w-4 h-4" />
                                                المحفظة
                                        </button>
                                        <button
                                                type="button"
                                                role="tab"
                                                aria-selected={portfolioMode === 'wealth'}
                                                onClick={() => setPortfolioMode('wealth')}
                                                className={cn(
                                                        'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
                                                        portfolioMode === 'wealth'
                                                                ? 'bg-background text-warning shadow-sm'
                                                                : 'text-muted-foreground hover:text-foreground'
                                                )}
                                        >
                                                <HandCoins className="w-4 h-4" />
                                                الأموال
                                        </button>
                                        <button
                                                type="button"
                                                role="tab"
                                                aria-selected={portfolioMode === 'rescue'}
                                                onClick={() => setPortfolioMode('rescue')}
                                                className={cn(
                                                        'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
                                                        portfolioMode === 'rescue'
                                                                ? 'bg-background text-loss shadow-sm'
                                                                : 'text-muted-foreground hover:text-foreground'
                                                )}
                                        >
                                                <LifeBuoy className="w-4 h-4" />
                                                إنقاذ سهم
                                        </button>
                                </div>

                                {/* === Wealth sub-tab === */}
                                {portfolioMode === 'wealth' && (
                                        <WealthCharts />
                                )}

                                {/* === Rescue sub-tab === */}
                                {portfolioMode === 'rescue' && (
                                        <BagHolderRescuePanel />
                                )}

                                {/* === Portfolio sub-tab (existing 4-tab portfolio experience) === */}
                                {portfolioMode === 'portfolio' && (<>
                                        {/* MULTI-PORTFOLIO-032: Multi-Portfolio Selector + Master Summary */}
                                        <MultiPortfolioSelector
                                                userId={userId as any}
                                                selectedPortfolioId={selectedPortfolioId}
                                                onSelect={setSelectedPortfolioId}
                                        />

                                        {/* Master Portfolio Summary (الإجمالي العام من المحفظة الشاملة) */}
                                        <MasterPortfolioSummary userId={userId as any} />

                                        {selectedPortfolioId !== 'master' && (
                                                <Card className="bg-profit/20 border-profit/20">
                                                        <CardContent className="p-3 flex items-center justify-between text-xs text-profit">
                                                                <span>{t('portfolio.subPortfolio.banner')}</span>
                                                                <Badge variant="outline" className="text-profit border-profit">
                                                                        {t('portfolio.subPortfolio.badge', { id: selectedPortfolioId })}
                                                                </Badge>
                                                        </CardContent>
                                                </Card>
                                        )}

                                        {/* Tabs */}
                                        {/* UI-STABILITY fix (2026-09-28): stable keys on each TabsContent so
                                         switching tabs doesn't unmount/remount the others unexpectedly. */}
                                        <Tabs defaultValue="assets">
                                                <TabsList className="flex w-full">
                                                        <TabsTrigger value="assets" className="flex-1">{t('portfolio.tabs.assets')}</TabsTrigger>
                                                        <TabsTrigger value="income-expense" className="flex-1">{t('portfolio.tabs.incomeExpense')}</TabsTrigger>
                                                        <TabsTrigger value="obligations" className="flex-1">{t('portfolio.tabs.obligations')}</TabsTrigger>
                                                        <TabsTrigger value="reports" className="flex-1">{t('portfolio.tabs.reports')}</TabsTrigger>
                                                        {/* RESTRUCT-A-P2: alerts merged from #alerts-center top-level */}
                                                        <TabsTrigger value="alerts" className="flex-1">التنبيهات</TabsTrigger>

                                                </TabsList>

                                                <TabsContent value="assets" key="portfolio-tab-assets">
                                                        <AssetsTab selectedPortfolioId={selectedPortfolioId} />
                                                </TabsContent>

                                                <TabsContent value="income-expense" key="portfolio-tab-income-expense">
                                                        <IncomeExpenseTab />
                                                </TabsContent>

                                                <TabsContent value="obligations" key="portfolio-tab-obligations">
                                                        <ObligationsTab />
                                                </TabsContent>

                                                <TabsContent value="reports" key="portfolio-tab-reports">
                                                        <ReportsTab />
                                                </TabsContent>

                                                {/* RESTRUCT-A-P2: alerts merged from #alerts-center top-level */}
                                                <TabsContent value="alerts" key="portfolio-tab-alerts">
                                                        <AlertsCenterView />
                                                </TabsContent>


                                        </Tabs>
                                </>)}
                        </div>
                </div>
        );
}

export default EnhancedPortfolioView;
