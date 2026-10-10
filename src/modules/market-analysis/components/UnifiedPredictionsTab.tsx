'use client';

/**
 * UnifiedPredictionsTab — التبويب الموحّد للتوقعات (3 sub-views في تاب واحد)
 * =====================================================================
 * FOCUS-AUDIT-FIX (2026-10-01):
 *   المشكلة: كانت فيه 3 تابات منفصلة (متابعة + ملخص + التوقعات) بقرأوا من
 *   نفس الجدول (predictions.db.predictions) لكن عبر 3 endpoints مختلفة بفلاتر
 *   مختلفة → بيانات غير متوافقة + إرباك للعميل.
 *
 *   الحل: دمج الـ 3 في تاب واحد بـ 3 sub-views:
 *     1. الحالية (Current) — PersonaTab — توقعات اليوم per persona
 *     2. الأداء (Performance) — PredictionTrackingDashboard — قائمة + إحصائيات
 *     3. الملخص (Summary) — ExecutiveReportView — charts تنفيذية
 *
 *   كل الـ 3 sub-views بتقرأ من نفس المصدر (predictions.db.predictions) عبر
 *   نفس الـ cache (useAnalysisStore) → بيانات متوافقة 100%.
 *
 * Reference:
 *   - Rule 4 (NO-NEW-SCREENS): ده refactor بتاع tabs موجودة، مش شاشة جديدة.
 *   - Rule 30 (CLIENT-FACING-STYLE): labels بالعربي واضحة (مش تقني).
 *   - Rule 62 (GIT-PUSH-DISCIPLINE).
 */

import React, { useState, lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAppStore } from '@/lib/store';
import { PersonaTab } from '@/modules/market-analysis/components/PersonaTab';
import type { MarketType } from '@/lib/store';

// Lazy-load the heavy sub-views so each ships as its own JS chunk.
// Only the active sub-view's code is downloaded.
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

type SubView = 'current' | 'performance' | 'summary';

const SUB_VIEWS: Array<{ value: SubView; label: string; icon: string }> = [
  { value: 'current', label: 'الحالية', icon: '⚡' },
  { value: 'performance', label: 'الأداء', icon: '📊' },
  { value: 'summary', label: 'الملخص', icon: '📋' },
];

interface UnifiedPredictionsTabProps {
  market: MarketType;
}

export function UnifiedPredictionsTab({ market }: UnifiedPredictionsTabProps) {
  const [subView, setSubView] = useState<SubView>('current');

  return (
    <div className="space-y-4">
      {/* Sub-view toggle — 3 views in one tab */}
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
              className="px-4 py-2 text-sm font-medium data-[state=on]:bg-background data-[state=on]:shadow-sm rounded-md transition-all"
            >
              <span className="me-1.5">{v.icon}</span>
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Sub-view content */}
      <Suspense fallback={<Skeleton className="h-[500px] w-full rounded-xl" />}>
        {subView === 'current' && <PersonaTab market={market} persona="balanced" />}

        {subView === 'performance' && <PredictionTrackingDashboard market={market} />}

        {subView === 'summary' && <ExecutiveReportView market={market} />}
      </Suspense>
    </div>
  );
}
