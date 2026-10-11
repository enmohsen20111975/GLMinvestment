/**
 * POST /api/backtesting/unified — Rule 27 HARD GATE
 * ==================================================
 *
 * RULE27-DISABLED (2026-10-12 — FAKE-DATA-HUNT):
 *
 * This route was a CATASTROPHIC fake data path:
 *   - Used `mulberry32` deterministic RNG to fabricate equity curves
 *   - Hardcoded `STRATEGY_PROFILES` with fake winRate: 0.62/0.54/0.49/0.78
 *   - Returned `source: 'deterministic_stub'` + `success: true`
 *   - The route itself admitted: "ينتج هذا الـ endpoint بيانات backtest وهمية"
 *
 * Rule 27 (NO-FAKE-DATA): ممنوع أي بيانات وهمية في production.
 * Rule 67 (CALCULATION-CANONICAL): backtest لازم من Python canonical.
 * Rule 20 (Python=Brain): Node مش بيعمل backtest computation.
 *
 * The canonical backtest engine is `vps-service/engines/backtest_engine.py`
 * accessible via Python /api/backtesting (port 8010).
 *
 * Returns 410 Gone with redirect to Python canonical.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  return NextResponse.json({
    success: false,
    deprecated: true,
    error: 'endpoint_deprecated',
    error_ar: 'تم إيقاف هذا الـ endpoint نهائياً. كان بـ يرجع بيانات backtest وهمية (deterministic_stub).',
    deprecated_at: '2026-10-12',
    rule: 'Rule 27 (NO-FAKE-DATA) + Rule 67 (CALCULATION-CANONICAL) + Rule 20 (Python=Brain)',
    canonical_engine: 'vps-service/engines/backtest_engine.py',
    canonical_api: 'GET /api/backtesting (Python port 8010)',
    reason: 'This route used mulberry32 RNG to fabricate equity curves + hardcoded winRate values. All fake data.',
  }, { status: 410 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}

// ─── ORIGINAL IMPLEMENTATION REMOVED (Rule 16 VERIFY-BEFORE-DELETE) ────────
// The original 282-line implementation with mulberry32 RNG + STRATEGY_PROFILES
// is preserved in git history (commit before this one) for reference.
