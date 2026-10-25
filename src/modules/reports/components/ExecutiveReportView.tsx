/**
 * ExecutiveReportView.tsx (shim)
 * ======================================
 * Re-export shim. The actual implementation now lives in the
 * `executive-report/` folder as part of Task
 * F-Phase3-Split-Reports+Edu (split from 2,087 LOC).
 *
 * Sub-modules:
 *   - executive-report/ExecutiveReportView.tsx          (container, < 200 LOC)
 *   - executive-report/useExecutiveReportState.ts        (state hook + memos)
 *   - executive-report/ControlBar.tsx                    (top control bar + timeframe selector)
 *   - executive-report/FiltersToolbar.tsx                 (advanced filters toolbar)
 *   - executive-report/ReportBody.tsx                     (main report card: KPIs + charts + highlights + personas + missed-opps)
 *   - executive-report/KpiCard.tsx                        (single hero KPI card)
 *   - executive-report/HighlightCard.tsx                  (top gains / losses / fastest / trailing card)
 *   - executive-report/PersonaCard.tsx                    (persona strategy card + StatRow)
 *   - executive-report/MissedOppCard.tsx                  (missed opportunities card)
 *   - executive-report/constants.ts                       (TIMEFRAME_OPTIONS + filter option arrays + accent maps)
 *   - executive-report/helpers.ts                         (pickRepresentative + computeStats + signalBadgeClass)
 *   - executive-report/types.ts                           (all interfaces)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/reports/index.ts barrel.
 *   - src/modules/market-analysis/components/MarketAnalysisView.tsx
 *   - src/modules/market-analysis/components/UnifiedPredictionsTab.tsx
 *     (dynamic import with `ssr: false`).
 */
export {
  ExecutiveReportView,
  default,
} from './executive-report/ExecutiveReportView';
export type { ExecutiveReportViewProps } from './executive-report/types';
