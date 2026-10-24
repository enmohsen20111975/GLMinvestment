/**
 * PredictionTrackingDashboard.tsx (shim)
 * ======================================
 * Re-export shim. The actual implementation now lives in the
 * `prediction-dashboard/` folder as part of Task
 * F-Phase3-Split-Admin+Predictions (split from 2,098 LOC).
 *
 * Sub-modules:
 *   - prediction-dashboard/PredictionTrackingDashboard.tsx (container, < 200 LOC)
 *   - prediction-dashboard/usePredictionTrackingState.ts (state hook + memos)
 *   - prediction-dashboard/desktopColumns.tsx               (UnifiedTable columns)
 *   - prediction-dashboard/HeaderBar.tsx                    (luxury header + filters)
 *   - prediction-dashboard/KpiCards.tsx                      (5 hero KPI cards)
 *   - prediction-dashboard/PersonaCards.tsx                   (persona breakdown)
 *   - prediction-dashboard/FocusStocksBanner.tsx             (focus tickers)
 *   - prediction-dashboard/CumulativeProfitChart.tsx         (recharts BarChart)
 *   - prediction-dashboard/MobilePredictionCard.tsx          (mobile card row)
 *   - prediction-dashboard/ProofTableCard.tsx                (table card + toolbar)
 *   - prediction-dashboard/ProofModal.tsx                    (proof modal dialog)
 *   - prediction-dashboard/constants.ts                      (PERSONA_CONFIG + OUTCOME_CONFIG + ...)
 *   - prediction-dashboard/helpers.ts                        (format/compute/generate utils)
 *   - prediction-dashboard/types.ts                          (all interfaces)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/predictions/index.ts barrel.
 *   - src/modules/market-analysis/components/UnifiedPredictionsTab.tsx
 *     (dynamic import with `ssr: false`).
 */
export { PredictionTrackingDashboard } from './prediction-dashboard/PredictionTrackingDashboard';
export { default } from './prediction-dashboard/PredictionTrackingDashboard';
