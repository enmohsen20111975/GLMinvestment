'use client';

import React from 'react';

// V40.4 §6 Phase 6 cleanup (Rule 16 VERIFY-BEFORE-DELETE):
// CryptoRecommendationsView + CryptoAnalysisView were archived to
// _archived_v404/ because the unified MarketAnalysisView now handles
// both #crypto-recommendations and #crypto-analysis routes via the
// initialMarket="CRYPTO" prop (UI Mirror Protocol, Directive §5).
// Only CryptoLearningView + CryptoSimulationView remain in this shim.

// Import the comprehensive CryptoLearningView
import { CryptoLearningView as ComprehensiveCryptoLearningView } from './CryptoLearningView';

// Import the comprehensive CryptoSimulationView
import { CryptoSimulationView as ComprehensiveCryptoSimulationView } from './CryptoSimulationView';

/* ------------------------------------------------------------------ */
/*  Crypto Learning View - Comprehensive Learning Management System    */
/* ------------------------------------------------------------------ */

export function CryptoLearningView() {
  // Use the comprehensive crypto learning component with:
  // - 5 courses with multiple lessons each
  // - Interactive quizzes
  // - XP points and achievements
  // - Articles section
  // - Crypto glossary (Arabic-English)
  // - Progress tracking with localStorage
  return <ComprehensiveCryptoLearningView />;
}

/* ------------------------------------------------------------------ */
/*  Crypto Simulation View - Full Featured Trading Simulator           */
/* ------------------------------------------------------------------ */

export function CryptoSimulationView() {
  // Use the comprehensive crypto simulation component
  return <ComprehensiveCryptoSimulationView />;
}
