'use client';

/**
 * MERGE-PREDICTION-CARDS — PersonaImageCard
 * -----------------------------------------
 * This file is now a *thin re-export wrapper* around the canonical
 * `PredictionsImageCard`. The original ~605 LOC implementation (its own
 * PickRow / StatBox / dual-theme header / score bar / verdict pill) has been
 * removed in favour of the single shared implementation in
 * `PredictionsImageCard.tsx`.
 *
 * Why keep this file at all?
 *   - Backward compatibility: every importer under `src/modules/market-analysis`
 *     still does `import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard'`.
 *   - The `PersonaPick` interface is imported by several tabs.
 *
 * What this wrapper does:
 *   1. Re-exports the `PersonaPick` type (unchanged shape) so importers keep working.
 *   2. Accepts the original `PersonaImageCardProps` (market/persona/picks/lastUpdate).
 *   3. Maps each `PersonaPick` → the canonical `PredictionPick` shape used by
 *      `PredictionsImageCard`, deriving BUY/SELL/HOLD signal from `verdict`.
 *   4. Forwards the ref and passes `persona` + `personaLabel` so the canonical
 *      card renders the "🏦 المستثمر" or "🎯 المضارب" mode badge in its header.
 *
 * Net effect: ONE rendering implementation, ~575 LOC saved, all importers untouched.
 */

import React, { forwardRef } from 'react';
import {
  PredictionsImageCard,
  type PredictionPick,
} from '@/components/market/PredictionsImageCard';
import { MarketType } from '@/lib/store';

/* ------------------------------------------------------------------ */
/*  Types (kept identical for backward compat)                        */
/* ------------------------------------------------------------------ */

export interface PersonaPick {
  ticker: string;
  name?: string;
  name_ar?: string;
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

export interface PersonaImageCardProps {
  /** رمز السوق الحالي (EGX, TADAWUL, KSE, QSE) */
  market: MarketType;
  /** نوع البرسونا */
  persona: 'investor' | 'gambler';
  /** قائمة الأسهم المختارة (مرتبة حسب score) */
  picks: PersonaPick[];
  /** نص آخر تحديث */
  lastUpdate?: string;
}

/* ------------------------------------------------------------------ */
/*  Mapper: PersonaPick → PredictionPick                              */
/* ------------------------------------------------------------------ */

/**
 * Convert the legacy PersonaPick shape (verdict/score/entry/target/stop)
 * into the canonical PredictionPick shape so it can flow through the single
 * PredictionsImageCard renderer.
 *
 * - entry/target/stop map to entry_price/target_price/stop_loss.
 * - score maps to master_score (drives the score display).
 * - verdict maps to signal_ar (Arabic signal label) and a derived signal kind.
 * - reason + conditions are folded into ai_reason so the TechExplanationBlock
 *   (collapsible analysis section) can render them.
 */
function mapPersonaToPrediction(p: PersonaPick): PredictionPick {
  const v = (p.verdict || '').toLowerCase();
  let signal: string;
  if (
    v.includes('فرصة') ||
    v.includes('ادخل') ||
    v.includes('قوي') ||
    v.includes('شراء')
  ) {
    signal = 'BUY';
  } else if (
    v.includes('ابعد') ||
    v.includes('بيع') ||
    v.includes('تجنب') ||
    v.includes('اخرج')
  ) {
    signal = 'SELL';
  } else {
    signal = 'HOLD';
  }

  // Compose a single Arabic reason block (reason + conditions list).
  const conditionsText =
    Array.isArray(p.conditions) && p.conditions.length > 0
      ? p.conditions.map((c) => `• ${c}`).join('\n')
      : '';
  const composedReason = [p.reason, conditionsText]
    .filter(Boolean)
    .join('\n\n') || null;

  return {
    ticker: p.ticker,
    name: p.name,
    name_ar: p.name_ar,
    entry_price: p.entry ?? undefined,
    target_price: p.target ?? undefined,
    stop_loss: p.stop ?? undefined,
    master_score: p.score,
    signal,
    signal_ar: p.verdict, // preserve the original verdict wording as the Arabic label
    ai_reason: composedReason,
  };
}

/* ------------------------------------------------------------------ */
/*  Wrapper component (forwards ref + maps data + sets persona badge)   */
/* ------------------------------------------------------------------ */

export const PersonaImageCard = forwardRef<
  HTMLDivElement,
  PersonaImageCardProps
>(function PersonaImageCard({ market, persona, picks, lastUpdate }, ref) {
  const mapped: PredictionPick[] = (picks ?? []).map(mapPersonaToPrediction);
  const personaLabel = persona === 'investor' ? 'المستثمر' : 'المضارب';
  return (
    <PredictionsImageCard
      ref={ref}
      market={market}
      stocks={mapped}
      lastUpdate={lastUpdate}
      persona={persona}
      personaLabel={personaLabel}
    />
  );
});
