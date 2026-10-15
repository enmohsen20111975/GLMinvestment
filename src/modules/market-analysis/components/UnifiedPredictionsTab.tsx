'use client';
import React, { useState, lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { VIPLiveSignalsFeed } from '@/components/shared/VIPLiveSignalsFeed';
import { AuditedPerformanceView } from '@/components/shared/AuditedPerformanceView';
import type { MarketType } from '@/lib/store';

const SectorTrackingTab = lazy(() => import('@/modules/market-analysis/components/SectorTrackingTab').then(m => ({ default: m.SectorTrackingTab })));
const ExecutiveReportView = lazy(() => import('@/modules/reports/components/ExecutiveReportView').then(m => ({ default: m.ExecutiveReportView })));

type SubView = 'live' | 'performance' | 'sectors' | 'summary';
const SUB_VIEWS: Array<{ value: SubView; label: string; icon: string }> = [
  { value: 'live', label: 'الصفقات الحية', icon: '⚡' },
  { value: 'performance', label: 'الأداء وسجل الأرباح', icon: '📊' },
  { value: 'sectors', label: 'حركة وسيولة القطاعات', icon: '🏭' },
  { value: 'summary', label: 'الملخص التنفيذي ونبض السوق', icon: '📋' },
];

export function UnifiedPredictionsTab({ market, initialSubView }: { market: MarketType; initialSubView?: SubView }) {
  const [subView, setSubView] = useState<SubView>(initialSubView || 'live');
  return (
    <div className="space-y-4">
      <div className="flex justify-center" dir="rtl">
        <ToggleGroup type="single" value={subView} onValueChange={(v) => v && setSubView(v as SubView)} className="bg-muted rounded-lg p-1 gap-1">
          {SUB_VIEWS.map((v) => (
            <ToggleGroupItem key={v.value} value={v.value} aria-label={v.label} className="px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md transition-all">
              <span className="me-1.5">{v.icon}</span><span className="hidden sm:inline">{v.label}</span><span className="sm:hidden">{v.icon}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <Suspense fallback={<Skeleton className="h-[500px] w-full rounded-xl" />}>
        {subView === 'live' && <VIPLiveSignalsFeed market={market} />}
        {subView === 'performance' && <AuditedPerformanceView market={market} />}
        {subView === 'sectors' && <SectorTrackingTab market={market} />}
        {subView === 'summary' && <ExecutiveReportView market={market} />}
      </Suspense>
    </div>
  );
}
