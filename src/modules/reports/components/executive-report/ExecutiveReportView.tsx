/**
 * executive-report/ExecutiveReportView.tsx (container)
 * ===========================================
 * Thin orchestrator. Owns:
 *  - The `useExecutiveReportState({ market, initialDays })` hook call
 *    (delegates all state + fetches + derived memos).
 *  - The render layout: <ControlBar /> + <FiltersToolbar /> + <ReportBody />.
 *
 * Sub-modules live in this folder:
 *  - types.ts                              (all interfaces + union types)
 *  - constants.ts                          (TIMEFRAME_OPTIONS + filter option arrays + accent maps)
 *  - helpers.ts                            (pickRepresentative + computeStats + signalBadgeClass)
 *  - useExecutiveReportState.ts            (the big state hook + derived memos)
 *  - ControlBar.tsx                        (top control bar + timeframe selector)
 *  - FiltersToolbar.tsx                    (advanced filters toolbar)
 *  - ReportBody.tsx                        (main report card: branding + KPIs + charts + highlights + personas + missed-opps)
 *  - KpiCard.tsx                           (single hero KPI card)
 *  - HighlightCard.tsx                     (highlights card: top gains / losses / fastest / trailing)
 *  - PersonaCard.tsx                       (persona strategy card + StatRow)
 *  - MissedOppCard.tsx                     (missed opportunities card)
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * Backward compatible: existing import sites keep working unchanged via the
 * parent re-export shim (`src/modules/reports/components/ExecutiveReportView.tsx`).
 */

'use client';

// MAESTRO-DISABLED — use unified API instead (Task PHASE-2-MAESTRO-KILL, Rule 73)
// This component fetches from /api/predictions/honest-tracking/* and
// /api/predictions/honest-tracking/missed-opportunities — NOT maestro endpoints.
// The remaining `maestroScore` / `maestro_score` references are property names
// mapping to the `maestro_score` DB column (stored_analyses / predictions tables).
// They are NOT maestro-engine invocations and are intentionally left intact
// per Rule 4 (NO-DELETION) and the conservative clause of PHASE-2-MAESTRO-UI.

import { cn } from '@/lib/utils';
import { useExecutiveReportState } from './useExecutiveReportState';
import { ControlBar } from './ControlBar';
import { FiltersToolbar } from './FiltersToolbar';
import { ReportBody } from './ReportBody';
import type { ExecutiveReportViewProps } from './types';

export function ExecutiveReportView({
  market = 'EGX',
  initialDays = 999, // RL-FIX-7: افتراضي = من أول السنة (YTD)
  onClose,
  className,
}: ExecutiveReportViewProps) {
  const s = useExecutiveReportState({ market, initialDays });

  return (
    <div className={cn('w-full max-w-6xl mx-auto space-y-5', className)} dir="rtl">
      <ControlBar
        market={market}
        timeframeLabel={s.timeframeLabel}
        uniqueStockCount={s.uniqueStockCount}
        totalPredictionCount={s.totalPredictionCount}
        days={s.days}
        setDays={s.setDays}
        refreshing={s.refreshing}
        exporting={s.exporting}
        loading={s.loading}
        onRefresh={s.fetchData}
        onExport={s.handleExportPng}
        onClose={onClose}
        reportShareText={s.reportShareText}
        reportContainerRef={s.reportContainerRef}
      />

      <FiltersToolbar
        showFilters={s.showFilters}
        setShowFilters={s.setShowFilters}
        activeFilterCount={s.activeFilterCount}
        onReset={s.resetFilters}
        qualityMode={s.qualityMode}
        setQualityMode={s.setQualityMode}
        minConfidence={s.minConfidence}
        setMinConfidence={s.setMinConfidence}
        filterOutcome={s.filterOutcome}
        setFilterOutcome={s.setFilterOutcome}
        filterSignal={s.filterSignal}
        setFilterSignal={s.setFilterSignal}
        searchQuery={s.searchQuery}
        setSearchQuery={s.setSearchQuery}
      />

      <ReportBody
        reportContainerRef={s.reportContainerRef}
        market={market}
        timeframeLabel={s.timeframeLabel}
        source={s.data?.source}
        activeFilterCount={s.activeFilterCount}
        qualityMode={s.qualityMode}
        minConfidence={s.minConfidence}
        loading={s.loading}
        totalTrades={s.totalTrades}
        stats={s.stats}
        statsByPersona={s.statsByPersona}
        winRate={s.winRate}
        profitFactor={s.profitFactor}
        uniqueStockCount={s.uniqueStockCount}
        totalPredictionCount={s.totalPredictionCount}
        trailingProfitCount={s.trailingProfitCount}
        outcomeDistribution={s.outcomeDistribution}
        cumulativeProfitData={s.cumulativeProfitData}
        monthlyReturns={s.monthlyReturns}
        personaRadarData={s.personaRadarData}
        topGains={s.topGains}
        topLosses={s.topLosses}
        fastestGains={s.fastestGains}
        topTrailingProfit={s.topTrailingProfit}
        missedOpps={s.missedOpps}
        missedOppsLoading={s.missedOppsLoading}
      />
    </div>
  );
}

export default ExecutiveReportView;
