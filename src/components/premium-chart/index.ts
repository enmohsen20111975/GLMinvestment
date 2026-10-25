/**
 * Premium Chart — Barrel Exports
 * =====================================================================
 *
 * نقطة دخول موحّدة لمكون الشارت المتميز.
 *
 * الاستخدام:
 *   import { PremiumChart } from '@/components/premium-chart';
 *   <PremiumChart ticker="COMI" ohlcv={data} tradePlan={plan} />
 */

export { PremiumChart } from './PremiumChart';
export { DrawingToolbar } from './drawing/DrawingToolbar';
export { DrawingCanvas } from './drawing/DrawingCanvas';
export { useDrawingStore } from './drawing/drawing-store';

export type {
  PremiumChartProps,
  ChartData,
  IndicatorData,
  CandleWithIndicators,
  TradePlan,
  SMCData,
  Drawing,
  ToolType,
  DrawingTool,
  DrawingColor,
  LineWidth,
  LineStyleName,
  ChartTheme,
} from './types';

export {
  toTime,
  timeToNumber,
  sanitizeCandles,
  fmtDateLabel,
  formatPrice,
  formatVolumeData,
  formatPct,
} from './utils';

export {
  calcSMA,
  calcEMA,
  calcMACD,
  calcOBV,
  calcRSI,
  calcATR,
  calcBollinger,
  calcFibLevels,
} from './indicators';

export { DARK_THEME, LIGHT_THEME } from './types';
