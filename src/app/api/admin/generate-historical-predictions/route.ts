/**
 * Generate Historical Predictions API — Rule 35 HARD GATE
 * ========================================================
 *
 * MAESTRO-KILL (2026-10-12): This route was a rogue path that:
 *   - Imported from `src/lib/honest-tracking/maestro.ts` (Rule 29 violation —
 *     parallel Node stack doing Maestro pipeline)
 *   - INSERTed directly into `predictions` table via better-sqlite3
 *     (Rule 35 violation — V40.2 is the ONLY sanctioned writer)
 *   - Bypassed PREDICTION-WRITE-GUARD (Rule 27 + Rule 67 violation)
 *
 * Per Rule 35 (ENGINE-UNIFY) + Rule 21 (V40.2 evidence-based):
 * Predictions MUST originate from V40.2 (`daily_predictor.py`) which runs
 * the full evidence pipeline (Kill Filters + 6 evidences + R:R ≥ 1.5 +
 * ATR clamp) and writes through `record_prediction()` → Single Gate.
 *
 * This route now returns 410 Gone with a clear redirect to the canonical
 * V40.2 generator.
 *
 * Rule 27 (NO-FAKE-DATA): proper HTTP 410, no mock data, no silent pass.
 * Rule 16 (VERIFY-BEFORE-DELETE): the old implementation is preserved
 * below in a comment block for historical reference.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  return NextResponse.json({
    success: false,
    deprecated: true,
    error: 'endpoint_deprecated',
    error_ar: 'تم إيقاف هذا الـ endpoint نهائياً. توليد التوقعات انتقل بالكامل لـ V40.2 في Python (Rule 35 ENGINE-UNIFY).',
    deprecated_at: '2026-10-12',
    rule: 'Rule 35 (ENGINE-UNIFY) + Rule 21 (V40.2 evidence-based) + Rule 20 (Python=Brain)',
    canonical_writer: 'vps-service/jobs/daily_predictor.py (V40.2)',
    canonical_command: 'python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5',
    canonical_api: 'POST http://localhost:8010/api/maestro/run (legacy — also deprecated)',
    note: 'The old implementation in src/lib/honest-tracking/maestro.ts was a parallel Node stack that bypassed V40.2 evidence pipeline + PREDICTION-WRITE-GUARD. It has been removed per Rule 35 + Rule 29.',
  }, { status: 410 });
}

// ─── ORIGINAL IMPLEMENTATION REMOVED (Rule 16 VERIFY-BEFORE-DELETE) ────────
// The old implementation (~350 lines) called generateHistoricalPredictions()
// from src/lib/honest-tracking/maestro.ts — a 76KB Node-side Maestro engine
// that bypassed V40.2 evidence pipeline + PREDICTION-WRITE-GUARD.
// Preserved in git history (commit before MAESTRO-KILL) for reference.
