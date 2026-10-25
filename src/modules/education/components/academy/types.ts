/**
 * academy/types.ts
 * ============================================================================
 * F-Phase3-Split-Academy: Types extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * All interfaces + types for the academy sub-components live here so each
 * sub-component doesn't reach into `@/hooks/useAcademyData` separately.
 * The data-fetching hooks themselves remain owned by Phase 2
 * (F-Strangler-AcademyView) — `useAcademyLessonsData` + `useAcademyStocksData`
 * — and we re-export their public types here as a single import surface.
 * ============================================================================
 */

import type { LucideIcon } from 'lucide-react';
import type { FloorStock } from '@/hooks/useAcademyData';

// Re-export the data-layer types from the Phase 2 hook so sub-components have
// a single import surface (types.ts) instead of reaching into @/hooks/*.
export type {
  AdvancedLesson,
  AdvancedLessonSection,
  FloorStock,
  EducationalLessonsResponse,
  StocksListResponse,
} from '@/hooks/useAcademyData';

// ─── Markdown renderer (AdvancedMarkdownRenderer) ────────────────────────────

/**
 * Discriminated union for parsed markdown blocks. The `AdvancedMarkdownRenderer`
 * component maps over this array and switches on `kind` to emit JSX.
 */
export type MdBlock =
  | { kind: 'h1' | 'h2' | 'h3' | 'h4'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'blockquote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }
  | { kind: 'paragraph'; text: string };

// ─── Live Market Scanner (Trading Floor §1) ─────────────────────────────────

/**
 * Quick-analysis sheet state for LiveMarketScanner.
 * `open` toggles the Sheet; `stock` is the row that was clicked.
 */
export interface AnalysisState {
  open: boolean;
  stock: FloorStock | null;
}

// ─── Scenario Decision Tree (Trading Floor §2) ──────────────────────────────

export type ScenarioTone = 'bullish' | 'bearish' | 'wait' | 'neutral';
export type Verdict = 'go' | 'wait' | 'avoid';

export interface ScenarioBranch {
  condition: string;
  action: string;
  verdict: Verdict;
}

export interface Scenario {
  id: string;
  title: string;
  trigger: string;
  tone: ScenarioTone;
  branches: ScenarioBranch[];
}

// ─── Action Playbooks (Trading Floor §3) ────────────────────────────────────

export interface Playbook {
  id: string;
  icon: LucideIcon;
  iconBg: string;
  title: string;
  condition: string;
  steps: string[];
  mistake: string;
  example: string;
}
