/**
 * super-learning/types.ts
 * =======================
 * View-layer types for the Super Learning System.
 *
 * Note: BacktestParameters / BacktestResult / BacktestIteration / BacktestTrade /
 * PersonaKey live in @/hooks/useSuperLearningData.ts (F-Strangler-SuperLearning).
 * This file declares only the view-local types (SectorBreakdownRow, EngineBreakdownRow,
 * PersonaBenchmarkStatic, PersonaInfoEntry, EngineWeights, PresetEntry).
 */
import type { PersonaKey, BacktestParameters, BacktestResult, BacktestIteration, BacktestTrade } from '@/hooks/useSuperLearningData';

export interface SectorBreakdownRow {
  sector: string;
  trades: number;
  winRate: number;
  returnPct: number;
}

export interface EngineBreakdownRow {
  model: string;
  trades: number;
  winRate: number;
}

export interface PersonaInfoEntry {
  ar: string;
  en: string;
  description: string;
  risk_level: 'low' | 'medium' | 'high';
  color: string;
  icon: string;
}

/** The 4 sub-engine weights (SMC / Quant / Risk / EGX). */
export interface EngineWeights {
  smc: number;
  quant: number;
  risk: number;
  egx: number;
}

/** A saved preset of engine weights + mode. */
export interface PresetEntry {
  name: string;
  weights: EngineWeights;
  mode: 'dynamic' | 'static';
}

// P39-PHASE-5: Persona Benchmarking — side-by-side comparison of the 3 personas
// Static display estimates derived from persona-dynamic.ts factors + historical EGX/Crypto behavior.
export interface PersonaBenchmarkStatic {
  riskScore: number; // 1..100 — display only
  stopFactor: number; // ATR multiplier for stop loss
  targetFactor: number; // ATR multiplier for target profit
  maxRiskPct: number; // max % of portfolio risked per trade
  winRate: number; // estimated win rate %
  profitFactor: number; // estimated profit factor
  maxDrawdown: number; // estimated max drawdown %
  avgTradesPerMonth: number; // estimated trades per month
  totalReturn: number; // estimated total return %
  egxCeiling: number; // max % in EGX
  cryptoCeiling: number; // max % in crypto
  cashFloor: number; // min % cash reserve
}

export type { PersonaKey, BacktestParameters, BacktestResult, BacktestIteration, BacktestTrade };

