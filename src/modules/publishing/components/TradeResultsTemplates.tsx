// TradeResults types (Phase 3)

/**
 * TradeResultsTemplates.tsx (shim)
 * ================================
 * Re-export shim. The actual implementation now lives in the
 * `trade-templates/` folder as part of Task F-Phase3-FinalPush
 * (split from 1,456 LOC).
 *
 * Sub-modules:
 *   - trade-templates/types.ts                         (interfaces + COLORS + FONT_FAMILY)
 *   - trade-templates/helpers.ts                       (fmt/fmtPct/fmtDate + isTradeExceedingTarget/isTradeProfitable + normalizeReportData)
 *   - trade-templates/SharedSvg.tsx                     (LogoBox + TrophyIcon + CandlestickBackground + ArrowUp)
 *   - trade-templates/SharedUi.tsx                      (KpiCard + Badge* + TradeRow + TradeTable + EmptyState + CTASection + Disclaimer + Header)
 *   - trade-templates/DailyResultsTemplate.tsx          (1080×1350 vertical)
 *   - trade-templates/WeeklyResultsTemplate.tsx         (1200×628 landscape)
 *   - trade-templates/MonthlyResultsTemplate.tsx        (1080×1080 square)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/publishing/components/TradeResultsGenerator.tsx (imports all 3 templates + normalizeReportData).
 *   - src/app/api/trade-results/export-image/route.ts (dynamic import of normalizeReportData + ReportData type).
 */
export { DailyResultsTemplate } from './trade-templates/DailyResultsTemplate';
export type { DailyResultsTemplateProps } from './trade-templates/DailyResultsTemplate';
export { WeeklyResultsTemplate } from './trade-templates/WeeklyResultsTemplate';
export type { WeeklyResultsTemplateProps } from './trade-templates/WeeklyResultsTemplate';
export { MonthlyResultsTemplate, default } from './trade-templates/MonthlyResultsTemplate';
export type { MonthlyResultsTemplateProps } from './trade-templates/MonthlyResultsTemplate';
export { normalizeReportData } from './trade-templates/helpers';
export type {
  TradeResult,
  ReportStats,
  ReportPeriod,
  ReportData,
} from './trade-templates/types';
