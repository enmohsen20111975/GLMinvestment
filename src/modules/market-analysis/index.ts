// src/modules/market-analysis/index.ts
// Public API for the market-analysis module.

export { MarketAnalysisView } from './components/MarketAnalysisView';
export { default as UnifiedAnalysisView } from './components/UnifiedAnalysisView';
export { TradingChartView } from './components/TradingChartView';
export { SingleStockAnalysisView } from './components/SingleStockAnalysisView';
export { InteractiveChart } from './components/InteractiveChart';
export { default as ChartControls } from './components/ChartControls';
export { InstitutionalDecisionPanel } from './components/InstitutionalDecisionPanel';
export { LiveDashboardWidget, HeartbeatStatusBar, WhaleAlertListener } from './components/LiveDashboard';
export { AlertPanel } from './components/AlertPanel';
export { HistoricalTradesTable } from './components/HistoricalTradesTable';
export { MarketDepthLiquidityWidget } from './components/MarketDepthLiquidityWidget';
export { ExpertRecommendationsPanel } from './components/ExpertRecommendationsPanel';

// Market-analysis sub-module (tabs)
export { MorningBellSection, HorizontalSectorsBar } from './components/MorningBellSection';
export { SectorTrackingTab } from './components/SectorTrackingTab';
export { PersonaTab } from './components/PersonaTab';
export { MarketStatusTab } from './components/MarketStatusTab';
export { PredictionsTab, PreviousPredictionsArchive } from './components/PredictionsTab';
export { MARKET_CODES, _isEgxIntradayNow } from './components/helpers';
export type { MarketAnalysisViewProps } from './components/types';
