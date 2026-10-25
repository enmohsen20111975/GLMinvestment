/**
 * SpecialistAnalysisView.tsx — thin re-export barrel.
 * =====================================================================
 * F-Phase3-Split-Specialist: split into 18 sub-component files under
 * specialist/ folder. This file preserves the original public import surface
 * for existing callers (e.g. src/app/page.tsx imports { SpecialistAnalysisView }
 * via dynamic import).
 *
 * Original 2,550 LOC → container now 383 LOC + 17 sibling files (helpers, types,
 * primitives, 14 section components, HeaderCard, ShareButtons).
 *
 * Rule 4 — edit-in-place: callers don't need to change their imports.
 * Rule 75 — commit + push after success.
 *
 * History:
 * - Phase 2 (F-Strangler-Specialist): data-fetching logic extracted to
 *   @/hooks/useSpecialistAnalysisData. Component became render-only.
 * - Phase 3 (F-Phase3-Split-Specialist, this commit): view itself split into
 *   specialist/ sub-components for maintainability (each section < 350 LOC).
 */
export { SpecialistAnalysisView } from './specialist/SpecialistAnalysisView';
export { SpecialistAnalysisView as default } from './specialist/SpecialistAnalysisView';
