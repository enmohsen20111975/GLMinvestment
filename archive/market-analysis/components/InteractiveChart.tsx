'use client';

/**
 * InteractiveChart.tsx — re-export from interactive-chart/ module directory.
 *
 * Per ALPHA Mission Directive 2026-10-20 — chart refactoring.
 * The original 2,187-line file has been split into 5 modules:
 *   - interactive-chart/types.ts           (181 lines — interfaces)
 *   - interactive-chart/utils.ts           (141 lines — time/volume utilities)
 *   - interactive-chart/indicators.ts      (99 lines — EMA/MACD/OBV/Fibonacci)
 *   - interactive-chart/sub-components.tsx  (122 lines — PlanLevel/ReasonCard/etc)
 *   - interactive-chart/InteractiveChart.tsx (1691 lines — main chart component)
 *
 * This file is kept as a thin re-export so existing imports still work:
 *   import { InteractiveChart } from '@/modules/market-analysis/components/InteractiveChart';
 */

export { InteractiveChart } from './interactive-chart/InteractiveChart';
export type { ChartData, IndicatorData, FullChartProps } from './interactive-chart/types';
