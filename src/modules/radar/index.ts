// ============================================================================
// modules/radar — Public API
//
// Canonical home for the liquidity radar: entry/exit radar, multi-market radar,
// personalized radar, accuracy dashboard, signal tracker UI, weekly report.
// All radar components + radar lib (cache, db, signal-tracker) live here.
//
// Internal files (lib/) are not re-exported — API routes import them directly
// via `@/modules/radar/lib/*` to keep this index focused on UI surface area.
// ============================================================================

export {
 RadarSignalStatsCard,
 SectorTreemapCard,
 EntryTimingCard,
 LiquidityFootprintCard,
} from './components/RadarStatsCards';

export { SignalStrengthMeter } from './components/SignalStrengthMeter';
export { ExitRadarTab } from './components/ExitRadarTab';
export { SignalTrackingTimeline } from './components/SignalTrackingTimeline';
export { WeeklyReportTab } from './components/WeeklyReportTab';
export { MultiMarketRadarTab } from './components/MultiMarketRadarTab';
export { AccuracyDashboard } from './components/AccuracyDashboard';
export { PersonalizedRadarTab } from './components/PersonalizedRadarTab';
