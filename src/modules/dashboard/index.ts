// src/modules/dashboard/index.ts
// Public API for the dashboard module.

export { DashboardView } from './components/DashboardView';
export { RealtimeTicker } from './components/RealtimeTicker';
export { LiveMonitor } from './components/LiveMonitor';
export { LiveStockTicker } from './components/LiveStockTicker';
export { MarketSummary } from './components/MarketSummary';
export { IndexCards } from './components/IndexCards';
export { TopMovers } from './components/TopMovers';
export { MarketSentiment } from './components/MarketSentiment';
export { CryptoSignalsWidget } from './components/CryptoSignalsWidget';
export { SeasonalitySignalsWidget } from './components/SeasonalitySignalsWidget';
// ─── PHASE-0 (Task UNIFICATION-PHASE-0) ──────────────────────────────────
// MaestroWidget تم تعطيله كلياً (Rule 73: SINGLE-DISPLAY-SOURCE).
// Maestro محرك قرار مختلف الـ thresholds (55/42/30/20) — مش canonical.
// export { MaestroWidget } from './components/MaestroWidget';
export { MarketPulseWidget } from './components/MarketPulseWidget';
export { InvestorsFlowPanel } from './components/InvestorsFlowPanel';
export { LiquidityFlowPanel } from './components/LiquidityFlowPanel';
export { IntradayPressurePanel } from './components/IntradayPressurePanel';
export { MultiMarketWidget } from './components/MultiMarketWidget';
export { AssetPreferenceOnboarding } from './components/AssetPreferenceOnboarding';
export { PinnableWidget } from './components/PinnableWidget';
export { SafeWidget } from './components/SafeWidget';
export { DevelopmentNotice } from './components/DevelopmentNotice';
export { PredictionsBacktestTable } from './components/PredictionsBacktestTable';
