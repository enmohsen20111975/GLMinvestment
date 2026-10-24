// ============================================================================
// MakerRadarTab.tsx — re-export shim (F-Phase3-Split)
// ============================================================================
// The implementation has been split into 8 files under ./maker-radar/:
// • types.ts — ALL TypeScript interfaces/types
// • helpers.ts — fmtNum/fmtMoney/fmtPct, pathMeta, accentClasses, PATH_DESC,
// resolveSignalCount/resolveMaxSignals, etc.
// • RadarActivityCard.tsx — RadarActivityCard + KpiCard
// • SectorHeatStrip.tsx — SectorHeatStrip (sector liquidity flow bar)
// • RadarSection.tsx — RadarSection (path-grouped table wrapper)
// • StockTable.tsx — StockTable + resolveLevels + StockDetailDrawer
// • TradingPlanSection.tsx — TradingFieldRow + TradingPlanSection + StatCard
// + FundamentalField + ProofSection + ProofMetricCard + ExplosiveBarChart
// + MarketIntelligenceCard
// • MakerRadarTab.tsx — Container only (data fetching + render composition)
//
// This file preserves the public import path so existing consumers
// (`import { MakerRadarTab } from '@/modules/predictions/components/MakerRadarTab'`)
// continue to work without any change.
// ============================================================================

export { MakerRadarTab, default } from './maker-radar/MakerRadarTab';
export type { MakerRadarTabProps, MakerRadarResponse, StockListItem, StocksListResponse, PredictionEntry, RadarStock } from './maker-radar/types';
export { StockDetailDrawer } from './maker-radar/StockTable';
