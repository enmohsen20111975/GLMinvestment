// src/modules/screener/components/screener-advanced/StockScreenerAdvanced.tsx
// F-Phase3-Split-Screener — Container component (the public export).
// يعرض تبويبين: «الفلاتر المتقدمة» (AdvancedFiltersTab) + «أعلى المؤدين»
// (TopPerformersTab). الـ data hooks (useScreenerData / useTopPerformersData)
// مُستدعاه جوا الـ tab components مباشرةً (Phase 2 / F-Strangler-Screener).
//
// LOC: < 500 (target met — see F-Phase3 constraints).

'use client';

import { useState, useEffect } from 'react';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import { Activity, Filter, Trophy } from 'lucide-react';
import { LegalDisclaimerFooter } from '@/components/legal/DisclaimerBanner';
import { useTranslation } from '@/lib/i18n-context';
import { AdvancedFiltersTab } from './AdvancedFiltersTab';
import { TopPerformersTab } from './TopPerformersTab';
import type { StockScreenerAdvancedProps } from './types';

// Re-export sub-components that were part of the original module's public API
// (kept here so external importers like `@/modules/screener/components/StockScreenerAdvanced`
// still see `WhatsAppIcon`, `ExportDropdown`, `ExportDropdownProps`).
export { WhatsAppIcon, ExportDropdown } from './ExportDropdown';
export type { ExportDropdownProps } from './types';

export function StockScreenerAdvanced({
  initialTab = 'advanced',
  initialMarket,
}: StockScreenerAdvancedProps) {
  const t = useTranslation();
  const [tab, setTab] = useState<'advanced' | 'top-performers'>(initialTab);

  // Read ?tab= query param on mount (for redirects from #top-performers).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t === 'top-performers') setTab('top-performers');
    else if (t === 'advanced') setTab('advanced');
  }, []);

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-profit" />
            {t('screener.advanced.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('screener.advanced.subtitle')}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'advanced' | 'top-performers')} className="w-full">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="advanced" className="gap-1.5">
            <Filter className="w-3.5 h-3.5" />
            {t('screener.advanced.tabs.advancedFilters')}
          </TabsTrigger>
          <TabsTrigger value="top-performers" className="gap-1.5">
            <Trophy className="w-3.5 h-3.5" />
            {t('screener.advanced.tabs.topPerformers')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="advanced">
          <AdvancedFiltersTab initialMarket={initialMarket} />
        </TabsContent>
        <TabsContent value="top-performers">
          <TopPerformersTab />
        </TabsContent>
      </Tabs>

      {/* إخلاء مسؤولية قانوني */}
      <LegalDisclaimerFooter />
    </div>
  );
}
