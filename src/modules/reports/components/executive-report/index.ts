/**
 * executive-report/index.ts
 * ========================
 * Barrel for the ExecutiveReportView family.
 *
 * Re-exports:
 *  - ExecutiveReportView (default + named) — main container.
 *  - ExecutiveReportViewProps — props interface.
 *  - Sub-components: KpiCard, HighlightCard, PersonaCard, MissedOppCard,
 *    ControlBar, FiltersToolbar, ReportBody.
 *  - useExecutiveReportState — the big state hook.
 *  - helpers: computeStats, pickRepresentative, signalBadgeClass.
 *  - constants: TIMEFRAME_OPTIONS, PERSONA_FILTER_OPTIONS, OUTCOME_FILTER_OPTIONS,
 *    SIGNAL_FILTER_OPTIONS, QUALITY_MODE_OPTIONS, CONFIDENCE_OPTIONS,
 *    KPI_ACCENTS, MISSED_OPP_ACCENTS.
 *  - types: ReportTimeframe, QualityMode, LivePredictionItem, PersonaStatsItem,
 *    LiveTrackingResponse, HonestPredictionItem, HonestListResponse,
 *    MissedOpportunityItem, MissedOpportunitiesResponse, HighlightItem, PersonaStats.
 */

export { ExecutiveReportView, default } from './ExecutiveReportView';
export type { ExecutiveReportViewProps } from './types';

export { KpiCard } from './KpiCard';
export type { KpiCardProps } from './KpiCard';

export { HighlightCard } from './HighlightCard';
export type { HighlightCardProps } from './HighlightCard';

export { PersonaCard } from './PersonaCard';
export type { PersonaCardProps } from './PersonaCard';

export { MissedOppCard } from './MissedOppCard';
export type { MissedOppCardProps } from './MissedOppCard';

export { ControlBar } from './ControlBar';
export type { ControlBarProps } from './ControlBar';

export { FiltersToolbar } from './FiltersToolbar';
export type { FiltersToolbarProps } from './FiltersToolbar';

export { ReportBody } from './ReportBody';
export type { ReportBodyProps } from './ReportBody';

export { useExecutiveReportState } from './useExecutiveReportState';
export type { ExecutiveReportState, UseExecutiveReportStateArgs } from './useExecutiveReportState';

export { computeStats, pickRepresentative, signalBadgeClass } from './helpers';

export {
  TIMEFRAME_OPTIONS,
  PERSONA_FILTER_OPTIONS,
  OUTCOME_FILTER_OPTIONS,
  SIGNAL_FILTER_OPTIONS,
  QUALITY_MODE_OPTIONS,
  CONFIDENCE_OPTIONS,
  KPI_ACCENTS,
  MISSED_OPP_ACCENTS,
  DEFAULT_MIN_CONFIDENCE,
} from './constants';

export type {
  ReportTimeframe,
  FilterPersona,
  FilterOutcome,
  FilterSignal,
  QualityMode,
  LivePredictionItem,
  PersonaStatsItem,
  LiveTrackingResponse,
  HonestPredictionItem,
  HonestListResponse,
  MissedOpportunityItem,
  MissedOpportunitiesResponse,
  HighlightItem,
  PersonaStats,
  ComputedStats,
} from './types';
