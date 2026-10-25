/**
 * persona/helpers.ts
 * ============================================================================
 * F-Phase3-Split-PersonaTab — local helpers (pure functions + constants).
 * ----------------------------------------------------------------------------
 * All shared helpers (pickValidPrice, getVerdictColor, getScoreColor,
 * formatSinglePersonaPickText, formatAllPersonaPicksText,
 * formatComprehensiveStockText, MARKET_CODES, PERSONA_PAGE_SIZE, etc.) live in
 * `../helpers` (extracted in Phase 1). This file only contains helpers local
 * to the PersonaTab folder:
 *   - Persona theme derivation (card + header)
 *   - Persona → analysisJson key mapping
 *   - Persona → default timeframe string
 *   - Stock movement stage derivation (ALPHA-FIX Task 4)
 *   - Volume/perf inline formatters (moved verbatim from PersonaCard)
 * ============================================================================
 */

import type {
  Persona,
  PersonaJsonKey,
  PersonaTheme,
  PersonaHeaderTheme,
  StockMovementStage,
  StageMeta,
} from './types';
import type { StoredAnalysisItem } from '../types';

// ============================================================
// Persona → JSON key + theme
// ============================================================

/**
 * Map display persona to legacy analysisJson key.
 * - conservative → investor (long horizon alias)
 * - balanced     → gambler (approximation — backend uses gambler bucket)
 * - gambler      → gambler
 */
export function getPersonaJsonKey(persona: Persona): PersonaJsonKey {
  return persona === 'conservative' ? 'investor' : 'gambler';
}

/** True when the persona is the long-horizon (conservative/investor) persona. */
export function isLongTermPersona(persona: Persona): boolean {
  return persona === 'conservative' || (persona as string) === 'investor';
}

/**
 * Persona card theme — emerald for investor, amber for balanced, fuchsia for
 * gambler (avoids blue/indigo per palette guidance).
 */
export function getPersonaTheme(persona: Persona): PersonaTheme {
  const isInvestor = isLongTermPersona(persona);
  if (isInvestor) {
    return {
      emoji: '🛡️',
      label: 'المستثمر',
      accent: 'text-profit ',
      accentBg: 'bg-profit/10',
      accentBorder: 'border-profit ',
    };
  }
  if (persona === 'balanced') {
    return {
      emoji: '⚖️',
      label: 'المتوازن',
      accent: 'text-warning ',
      accentBg: 'bg-warning/10',
      accentBorder: 'border-warning ',
    };
  }
  return {
    emoji: '🎯',
    label: 'المضارب',
    accent: 'text-fuchsia-700 dark:text-fuchsia-400',
    accentBg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',
    accentBorder: 'border-fuchsia-200 dark:border-fuchsia-900',
  };
}

/**
 * Persona tab header theme — title + Arabic subtitle + accent color.
 * P26: 3 personas — 🛡️ investor / ⚖️ balanced / 🎯 gambler.
 */
export function getPersonaHeaderTheme(persona: Persona): PersonaHeaderTheme {
  const isLongTerm = isLongTermPersona(persona);
  if (isLongTerm) {
    return {
      emoji: '🛡️',
      title: 'المستثمر',
      subtitle:
        'فرص طويلة المدى — محرك التصطاد يختار الأسهم اللي تناسبك (6-12 شهر)',
      accent: 'text-profit ',
    };
  }
  if (persona === 'balanced') {
    return {
      emoji: '⚖️',
      title: 'المتوازن',
      subtitle:
        'فرص متوسطة المدى — توازن بين الزخم والقيمة (2-6 أسابيع)',
      accent: 'text-warning ',
    };
  }
  return {
    emoji: '🎯',
    title: 'المضارب',
    subtitle:
      'فرص قصيرة المدى — محرك التصطاد يصطاد الزخم والسيولة والارتداد (يومي-أسبوعي)',
    accent: 'text-fuchsia-700 dark:text-fuchsia-400',
  };
}

/**
 * Default timeframe string used by the fallback PersonaData shape (when the
 * backend doesn't return a personaData entry, we synthesize one from the
 * top-level StoredAnalysisItem fields).
 */
export function getPersonaTimeframe(persona: Persona): string {
  if (persona === 'balanced') return '2-6 أسابيع';
  if (persona === 'conservative') return '6-12 شهر';
  return '1-5 أيام';
}

// ============================================================
// ALPHA-FIX Task 4 — Golden Retest stage derivation
// ============================================================

/**
 * Derive the stock's movement stage from `recommendation` + `analysisJson`.
 * - 💎 تجميع قيعان — whale radar picks (whale_radar / accumulate / "تجميع هادئ")
 * - ⚡ بداية انطلاق — buy signals (breaking out from correction)
 * - ⏳ جاري التصحيح — hold/wait/reduce (still in correction)
 * - 🛡️ نهاية تصحيح — default for active predictions
 *
 * @param item stored analysis item to derive the stage for
 * @param personaKey investor|gambler key into analysisJson
 */
export function deriveStage(
  item: StoredAnalysisItem,
  personaKey: PersonaJsonKey
): StockMovementStage {
  const rec = (item.recommendation || '').toLowerCase();
  const pd = item.analysisJson?.[personaKey] || {};
  const reason = String(
    pd.reason || item.analysisJson?.narrative?.line1 || ''
  ).toLowerCase();
  // 💎 تجميع قيعان — whale radar picks
  if (
    rec.includes('whale_radar') ||
    rec.includes('accumulate') ||
    reason.includes('تجميع هادئ')
  ) {
    return 'bottom_accumulation';
  }
  // ⚡ بداية انطلاق — buy signals (breaking out from correction)
  if (
    rec.includes('strong_buy') ||
    rec.includes('buy') ||
    rec.includes('t1_buy')
  ) {
    return 'early_break';
  }
  // ⏳ جاري التصحيح — hold/wait (still in correction)
  if (
    rec.includes('hold') ||
    rec.includes('wait') ||
    rec.includes('reduce')
  ) {
    return 'correcting';
  }
  // 🛡️ نهاية تصحيح — default for active predictions
  return 'correction_end';
}

/** Visual metadata for each stock movement stage. */
export const STAGE_META: Record<StockMovementStage, StageMeta> = {
  correction_end: {
    emoji: '🛡️',
    label: 'نهاية تصحيح',
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  early_break: {
    emoji: '⚡',
    label: 'بداية انطلاق',
    className: 'bg-profit/10 text-profit border-profit/20',
  },
  bottom_accumulation: {
    emoji: '💎',
    label: 'تجميع قيعان',
    className: 'bg-whale/10 text-whale border-whale/20',
  },
  correcting: {
    emoji: '⏳',
    label: 'جاري التصحيح',
    className: 'bg-muted text-muted-foreground border-border',
  },
};

/** Stage filter buttons — emoji + Arabic label per filter key. */
export const STAGE_FILTERS: ReadonlyArray<{
  key: 'all' | StockMovementStage;
  emoji: string;
  label: string;
}> = [
  { key: 'all', emoji: '📋', label: 'الكل' },
  { key: 'correction_end', emoji: '🛡️', label: 'نهاية تصحيح' },
  { key: 'early_break', emoji: '⚡', label: 'بداية انطلاق' },
  { key: 'bottom_accumulation', emoji: '💎', label: 'تجميع قيعان' },
  { key: 'correcting', emoji: '⏳', label: 'جاري التصحيح' },
];

// ============================================================
// Inline formatters (verbatim from PersonaCard.tsx)
// ============================================================

/**
 * Format a volume number into compact short form (B/M/K).
 * Inline copy from original PersonaCard (lines 201-207). Kept verbatim — the
 * refactor is structural, not behavioral.
 */
export function formatVol(v: number | undefined): string {
  if (!v) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

/**
 * Performance color — green for positive, red for negative, muted for null.
 * Inline copy from original PersonaCard (lines 210-213).
 */
export function perfColor(v: number | undefined | null): string {
  if (v === undefined || v === null) return 'text-muted-foreground';
  return v > 0 ? 'text-profit ' : v < 0 ? 'text-loss ' : 'text-muted-foreground';
}

// ============================================================
// PersonaData fallback synthesis
// ============================================================

/**
 * Synthesize a PersonaData shape from the top-level StoredAnalysisItem fields
 * when the backend doesn't return a nested personaData entry.
 *
 * Verbatim copy of the inline fallback used in 3 places in the original
 * PersonaTab.tsx (PersonaTableView line 863, StockDetailPanel line 1045,
 * PersonaTab container lines 1722 + 1810 + 1862).
 */
export function getPersonaDataFallback(
  item: StoredAnalysisItem,
  persona: Persona
): import('./types').PersonaData {
  return {
    verdict: item.recommendationAr || '',
    score: item.maestroScore || 0,
    reason: '',
    signal: item.recommendation || 'HOLD',
    entry: item.entry?.price ?? null,
    target: item.entry?.target ?? null,
    stop: item.entry?.stopLoss ?? null,
    timeframe: getPersonaTimeframe(persona),
  };
}

/** Clean a ticker by stripping market suffixes (.CA / .SR / .KW / .AE / .BH / .QA). */
export function cleanTicker(ticker: string): string {
  return ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
}

/** Uppercase clean ticker (used as map key for stocks lookup). */
export function cleanTickerUpper(ticker: string): string {
  return cleanTicker(ticker).toUpperCase();
}
