'use client';

import React from 'react';

// V40.4 §6 Phase 6 cleanup (Rule 16 VERIFY-BEFORE-DELETE):
// CryptoRecommendationsView + CryptoAnalysisView were archived to
// _archived_v404/ because the unified MarketAnalysisView now handles
// both #crypto-recommendations and #crypto-analysis routes via the
// initialMarket="CRYPTO" prop (UI Mirror Protocol, Directive §5).
//
// Wave 5 — Simulation Globalization (Task 13 Step 4, 2026-10-01):
// CryptoSimulationView was archived to
// archive/simulation-crypto-duplicate-2026-10-01/ because SimulationView
// now serves ALL markets (EGX/TADAWUL/KSE/QSE/US/CRYPTO) via the
// MarketSelector + /api/stocks?market=<market> dynamic fetch.
// Only CryptoLearningView remains in this shim.

// Import the comprehensive CryptoLearningView
import { CryptoLearningView as ComprehensiveCryptoLearningView } from './CryptoLearningView';

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
