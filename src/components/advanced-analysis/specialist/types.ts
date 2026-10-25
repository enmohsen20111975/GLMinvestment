/**
 * specialist/types.ts — Type re-exports for SpecialistAnalysisView sub-components.
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (2,550 LOC).
 * All canonical types live in @/hooks/useSpecialistAnalysisData (Phase 2 — Strangler
 * Pattern). This file is a single import surface for the specialist/ folder so the
 * sub-components don't each reach into the hook directly (Rule 4 — edit-in-place).
 */
export type {
  StockInfo,
  PriceRow,
  RadarStats,
  MakerRadarStock,
  FootprintLevel,
  FootprintData,
  PredictionRow,
  PredictionsResponse,
  FlowData,
  ExplosiveData,
  ComprehensiveData,
  ShariaResponse,
  SingleStockData,
  UnifiedResponse,
  UseSpecialistAnalysisDataResult,
} from '@/hooks/useSpecialistAnalysisData';

// Re-export the hook itself so the container only needs one import.
export { useSpecialistAnalysisData } from '@/hooks/useSpecialistAnalysisData';
