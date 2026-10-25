// SingleStockAnalysis types (Phase 3)

/**
 * SingleStockAnalysisView.tsx (shim)
 * ==================================
 * Re-export shim. The actual implementation now lives in the
 * `single-stock/` folder as part of Task F-Phase3-FinalPush
 * (split from 1,548 LOC).
 *
 * Sub-modules:
 *   - single-stock/SingleStockAnalysisView.tsx    (container, ~400 LOC)
 *   - single-stock/types.ts                        (interfaces + VisibleIndicatorsMap + DEFAULT_VISIBLE_INDICATORS + ChartEngine/TimeframeKey/UserState)
 *   - single-stock/helpers.ts                      (buildTvSymbol + timeframeToTvInterval + buildAnalysisUrl + captureCardScreenshot + quickAddAlert + LIMIT_MAP)
 *   - single-stock/ChartHeader.tsx                 (toolbar: search + timeframe + mode switcher + indicators toggle + action buttons)
 *   - single-stock/ChartContent.tsx                (chart area + sidebar + error/empty states)
 *   - single-stock/ExecutiveSummary.tsx             (Row 1: confluence score + trade plan)
 *   - single-stock/InsightCards.tsx                 (Row 1.5: candle-probability card + stock-DNA card)
 *   - single-stock/AdvancedBreakdown.tsx            (Row 2: SMC + candlestick + sweeps + indicators + fusion + fundamentals)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/market-analysis/index.ts barrel (re-exports SingleStockAnalysisView).
 */
export { SingleStockAnalysisView, default } from './single-stock/SingleStockAnalysisView';
export type { SingleStockAnalysisViewProps } from './single-stock/types';
