/**
 * persona/types.ts
 * ============================================================================
 * F-Phase3-Split-PersonaTab — local types + re-export barrel.
 * ----------------------------------------------------------------------------
 * All data types (PersonaData, StoredAnalysisItem, StockDetail, PredictionRow,
 * PreviousPrediction, TestingCandidate, etc.) live in `../types` (extracted in
 * Phase 1). All helper functions live in `../helpers` (extracted in Phase 1).
 *
 * This file only defines:
 *   - Persona alias / sub-tab / stage filter shapes (local to this folder)
 *   - Props interfaces for the sub-components (PersonaCard / PersonaTableView /
 *     StockDetailPanel / PersonaEmptyStates / PersonaTextView /
 *     WhaleRadarSection / TestingCandidatesSection / UnifiedAnalysisModal).
 *   - Re-export of the externally-defined types that sub-components consume so
 *     sub-components can `import type { PersonaData, ... } from './types'`
 *     without reaching into the parent folder.
 * ============================================================================
 */

import type { MarketType } from '@/lib/store';
import type {
  PersonaData,
  StoredAnalysisItem,
  StockDetail,
  PredictionContext,
  PreviousPrediction,
  TestingCandidate,
} from '../types';

// Re-export barrel — so sub-components import everything from './types'.
export type {
  PersonaData,
  StoredAnalysisItem,
  StockDetail,
  PredictionContext,
  PreviousPrediction,
  TestingCandidate,
};

// ============================================================
// Persona aliases (display layer)
// ============================================================

/** 3 display personas used by the UI (canonical since P26). */
export type Persona = 'conservative' | 'balanced' | 'gambler';

/**
 * JSON persona key inside `analysisJson`. The backend still uses the legacy
 * `investor` / `gambler` keys inside `StoredAnalysisItem.analysisJson`, so the
 * display layer maps:
 *   conservative → investor
 *   balanced     → gambler (approximation — balanced falls back to gambler)
 *   gambler      → gambler
 */
export type PersonaJsonKey = 'investor' | 'gambler';

/** Sub-tab selector inside StockDetailPanel. */
export type PersonaSubTab = 'details' | 'chart' | 'verdict';

/** Top-level view mode for the persona tab. */
export type PersonaViewMode = 'image' | 'cards' | 'table' | 'text';

// ============================================================
// Stock movement stage (ALPHA-FIX Task 4 — Golden Retest)
// ============================================================

/** Stage of a stock's price action — derived from `recommendation` + `analysisJson`. */
export type StockMovementStage =
  | 'correction_end' // 🛡️ نهاية تصحيح — default for active predictions
  | 'early_break' // ⚡ بداية انطلاق — buy signals (breaking out)
  | 'bottom_accumulation' // 💎 تجميع قيعان — whale radar picks
  | 'correcting'; // ⏳ جاري التصحيح — hold/wait/reduce

/** Stage filter key — `all` shows every stage. */
export type StageFilterKey = 'all' | StockMovementStage;

/** Visual metadata for a stage (emoji, Arabic label, Tailwind classes). */
export interface StageMeta {
  emoji: string;
  label: string;
  className: string;
}

/** Per-persona theme used by PersonaCard header + chip. */
export interface PersonaTheme {
  emoji: string;
  label: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
}

/** Per-persona header theme used by PersonaTab container header. */
export interface PersonaHeaderTheme {
  emoji: string;
  title: string;
  subtitle: string;
  accent: string;
}

// ============================================================
// Sub-component props
// ============================================================

export interface PersonaCardProps {
  ticker: string;
  persona: Persona;
  data: PersonaData;
  maestroScore?: number;
  updatedAt?: string;
  narrative?: { line1?: string; line2?: string; line3?: string };
  market: MarketType;
  nameAr?: string;
  logoUrl?: string | null;
  fundamentals?: StoredAnalysisItem['fundamentals'];
  onClick?: () => void;
}

export interface PersonaTableViewProps {
  items: StoredAnalysisItem[];
  persona: Persona;
  market: MarketType;
  onSelectItem?: (item: StoredAnalysisItem) => void;
}

export interface StockDetailPanelProps {
  item: StoredAnalysisItem;
  persona: Persona;
  market: MarketType;
  subTab: PersonaSubTab;
  onSubTabChange: (tab: PersonaSubTab) => void;
  onBack: () => void;
  stockDetail: StockDetail | null;
}

export interface PersonaEmptyStatesProps {
  loading: boolean;
  error: string | null;
  itemsLength: number;
  marketRegime: {
    regime?: string;
    reasons?: string[];
  } | null;
  persona: Persona;
  isLongTerm: boolean;
  headerTheme: PersonaHeaderTheme;
  onRetry: () => void;
}

export interface PersonaTextViewProps {
  items: StoredAnalysisItem[];
  persona: Persona;
  market: MarketType;
  onSelectItem: (item: StoredAnalysisItem) => void;
}

export interface WhaleRadarSectionProps {
  picks: PreviousPrediction[];
}

export interface TestingCandidatesSectionProps {
  candidates: TestingCandidate[];
}

export interface UnifiedAnalysisModalProps {
  selectedTicker: string | null;
  selectedContext: PredictionContext | null;
  onClose: () => void;
}

/** Props passed to the StockDetailPanel render-prop children inside ImageCardExport. */
export interface PersonaImageCardPick {
  ticker: string;
  name_ar: string;
  verdict?: string;
  score?: number;
  reason?: string;
  conditions?: string[];
  entry?: number | null;
  target?: number | null;
  stop?: number | null;
  timeframe?: string;
  fair_value?: number | null;
}
