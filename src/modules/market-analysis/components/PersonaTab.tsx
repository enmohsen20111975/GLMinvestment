'use client';

/**
 * PersonaTab.tsx — Strangler re-export shim.
 * ============================================================================
 * F-Phase3-Split-PersonaTab: original 2,228 LOC file replaced by a 1-line
 * re-export. The actual implementation now lives in `./persona/PersonaTab.tsx`
 * (container, < 500 LOC) which orchestrates 3 sub-components
 * (`PersonaCard`, `PersonaTableView`, `StockDetailPanel`) + 7 view-section
 * components (`PersonaEmptyStates`, `PersonaTextView`, `WhaleRadarSection`,
 * `TestingCandidatesSection`, `UnifiedAnalysisModal`, `PersonaImageCardExport`,
 * `PersonaBanners`). All data-fetching logic lives in `usePersonaTabData`
 * hook (F-Strangler-PersonaTab, Phase 2) — preserved unchanged.
 *
 * Backwards-compatible: every external importer
 * (`src/modules/market-analysis/components/MarketAnalysisView.tsx` +
 * `src/app/page.tsx` dynamic import with `ssr: false`) keeps working unchanged.
 * ============================================================================
 */

export { PersonaTab } from './persona/PersonaTab';
