'use client';

/**
 * UnifiedPredictionsTab — غرفة الصفقات الحية (Live Actionable Signals)
 * =====================================================================
 * T-ALPHA-A12: نسف التكرار الأعمى — دمج Net Picks + Predictions في شاشة موحدة.
 *
 * 4 sub-views تجارية:
 *   1. ⚡ الصفقات الحية — Live Actionable Signals (BUY/STRONG_BUY فقط)
 *   2. 📊 الأداء الموثق — Audited Performance History (مغلق فقط)
 *   3. 🏭 دوران القطاعات — Sectors Tracking (تحليل السيولة)
 *   4. 📋 الملخص التنفيذي — Executive Summary
 *
 * كل sub-view يقرأ من نفس المصدر الكنسي (predictions.db.predictions) عبر نفس الـ cache.
 *
 * Reference:
 *   - Rule 4 (NO-NEW-SCREENS): refactor بتاع tabs موجودة.
 *   - Rule 30 (CLIENT-FACING-STYLE): labels بالعربي تجارية واضحة.
 *   - Rule 62 (GIT-PUSH-DISCIPLINE).
 */

import React, { useState, lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { VIPLiveSignalsFeed } from '@/components/shared/VIPLiveSignalsFeed';
import { AuditedPerformanceView } from '@/components/shared/AuditedPerformanceView';
import type { MarketType } from '@/lib/store';

// Lazy-load the heavy sub-views so each ships as its own JS chunk.
const PredictionTrackingDashboard = lazy(() =>
  import('@/modules/predictions/components/PredictionTrackingDashboard').then(m => ({
    default: m.PredictionTrackingDashboard,
  }))
);

const ExecutiveReportView = lazy(() =>
  import('@/modules/reports/components/ExecutiveReportView').then(m => ({
    default: m.ExecutiveReportView,
  }))
);

// T-ALPHA-A12: Sector tracking as separate sub-view (was buried in PersonaTab)
const SectorTrackingTab = lazy(() =>
  import('@/modules/market-analysis/components/SectorTrackingTab').then(m => ({
    default: m.SectorTrackingTab,
  }))
);

type SubView = 'live' | 'performance' | 'sectors' | 'summary';

// T-ALPHA-A12: Commercial labels — no persona jargon
const SUB_VIEWS: Array<{ value: SubView; label: string; icon: string }> = [
  { value: 'live', label: 'الصفقات الحية', icon: '⚡' },
  { value: 'performance', label: 'الأداء الموثق', icon: '📊' },
  { value: 'sectors', label: 'دوران القطاعات', icon: '🏭' },
  { value: 'summary', label: 'الملخص', icon: '📋' },
];

interface UnifiedPredictionsTabProps {
  market: MarketType;
}

export function UnifiedPredictionsTab({ market }: UnifiedPredictionsTabProps) {
  const [subView, setSubView] = useState<SubView>('live');

  return (
    <div className="space-y-4">
      {/* T-ALPHA-A12: Commercial sub-view toggle — 4 views in one tab */}
      <div className="flex justify-center" dir="rtl">
        <ToggleGroup
          type="single"
          value={subView}
          onValueChange={(v) => v && setSubView(v as SubView)}
          className="bg-muted rounded-lg p-1 gap-1"
        >
          {SUB_VIEWS.map((v) => (
            <ToggleGroupItem
              key={v.value}
              value={v.value}
              aria-label={v.label}
              className="px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md transition-all"
            >
              <span className="me-1.5">{v.icon}</span>
              <span className="hidden sm:inline">{v.label}</span>
              <span className="sm:hidden">{v.icon}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Sub-view content */}
      <Suspense fallback={<Skeleton className="h-[500px] w-full rounded-xl" />}>
        {/* T-ALPHA-A15: الصفقات الحية — VIP Live Signals Feed (replaces PersonaTab) */}
        {subView === 'live' && <VIPLiveSignalsFeed market={market} />}

        {/* T-ALPHA-A17: الأداء الموثق — Audited Performance View (closed trades + stats banner) */}
        {subView === 'performance' && <AuditedPerformanceView market={market} />}

        {/* T-ALPHA-A12: دوران القطاعات — Sectors Tracking (separated from predictions) */}
        {subView === 'sectors' && <SectorTrackingTab market={market} />}

        {/* T-ALPHA-A12: الملخص التنفيذي */}
        {subView === 'summary' && <ExecutiveReportView market={market} />}
      </Suspense>
    </div>
  );
}
