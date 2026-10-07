'use client';

/**
 * MERGE-PREDICTION-CARDS — ExpertPredictionsImageCard
 * -------------------------------------------------
 * This file is now a *thin re-export wrapper* around the canonical
 * `PredictionsImageCard`. The original ~527 LOC implementation (its own
 * StockRow / StatBox / theme / header) has been removed in favour of the
 * single shared implementation in `PredictionsImageCard.tsx`.
 *
 * Why keep this file at all?
 *   - Backward compatibility: every importer under `src/modules/market-analysis`
 *     still does `import { ExpertPredictionsImageCard } from '@/components/market/ExpertPredictionsImageCard'`.
 *   - The `ExpertPick` interface is also imported by some of those modules.
 *
 * What this wrapper does:
 *   1. Re-exports the `ExpertPick` type (unchanged shape) so importers keep working.
 *   2. Accepts the original `ExpertPredictionsImageCardProps` (market/stocks/lastUpdate).
 *   3. Maps each `ExpertPick` → the canonical `PredictionPick` shape used by
 *      `PredictionsImageCard`, deriving a BUY/SELL/HOLD signal from `change_percent`.
 *   4. Forwards the ref and passes `expertName="الخبراء"` so the canonical card
 *      renders the "🎯 الخبراء" mode badge in its header.
 *
 * Net effect: ONE rendering implementation, ~500 LOC saved, all importers untouched.
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

export interface ExpertPick {
  ticker: string;
  name?: string;
  name_ar?: string;
  current_price?: number;
  change_percent?: number;
  volume?: string | number;
  sector?: string;
}

export interface ExpertPredictionsImageCardProps {
  /** رمز السوق الحالي */
  market: MarketType;
  /** قائمة الأسهم (مرتبة حسب السعر) */
  stocks: ExpertPick[];
  /** نص آخر تحديث */
  lastUpdate?: string;
}

/* ------------------------------------------------------------------ */
/*  Mapper: ExpertPick → PredictionPick                                */
/* ------------------------------------------------------------------ */

/**
 * Convert the legacy ExpertPick shape (price/change/sector) into the canonical
 * PredictionPick shape (entry/target/stop/signal/score) so it can flow through
 * the single PredictionsImageCard renderer.
 *
 * - entry_price is set to current_price so the footer's PnL math stays meaningful.
 * - signal is derived from change_percent so the card shows BUY/SELL/HOLD.
 * - profit_loss_percent mirrors change_percent so stats + footer pill match.
 */
function mapExpertToPrediction(s: ExpertPick): PredictionPick {
  const change = s.change_percent ?? 0;
  const signal =
    change > 0 ? 'BUY' : change < 0 ? 'SELL' : 'HOLD';
  const signalAr =
    change > 0 ? 'شراء' : change < 0 ? 'بيع' : 'احتفاظ';
  return {
    ticker: s.ticker,
    name: s.name,
    name_ar: s.name_ar,
    current_price: s.current_price,
    entry_price: s.current_price,
    profit_loss_percent: change,
    signal,
    signal_ar: signalAr,
  };
}

/* ------------------------------------------------------------------ */
/*  Wrapper component (forwards ref + maps data + sets expert badge)   */
/* ------------------------------------------------------------------ */

export const ExpertPredictionsImageCard = forwardRef<
  HTMLDivElement,
  ExpertPredictionsImageCardProps
>(function ExpertPredictionsImageCard({ market, stocks, lastUpdate }, ref) {
  const mapped: PredictionPick[] = (stocks ?? []).map(mapExpertToPrediction);
  return (
    <PredictionsImageCard
      ref={ref}
      market={market}
      stocks={mapped}
      lastUpdate={lastUpdate}
      expertName="الخبراء"
    />
  );
});
