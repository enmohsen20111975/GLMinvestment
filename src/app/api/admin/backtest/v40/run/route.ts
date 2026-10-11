/**
 * POST /api/admin/backtest/v40/run — Rule 35 HARD GATE
 * =====================================================
 *
 * RULE35-DISABLED (2026-10-12 — HIDDEN-WRITERS-AUDIT):
 *
 * This route was a CATASTROPHIC rogue path:
 *   - L45: `db.prepare('DELETE FROM predictions').run()` — wipes ALL predictions!
 *   - Even though admin-gated, this violates Rule 1 (DB Safety) + Rule 20 (Node
 *     must NEVER write to DBs) + Rule 35 (V40.2 is the only writer).
 *   - The `clearExisting` flag defaulted to TRUE — every backtest wiped
 *     production data.
 *
 * Per owner directive: "بدون ماتموت المشروع" — this route MUST stay disabled.
 *
 * Returns 410 Gone with redirect to V40.2 canonical generator (run via cron).
 *
 * Rule 1 (DB Safety) + Rule 20 (Python=Brain) + Rule 35 (ENGINE-UNIFY).
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
    error_ar: 'تم إيقاف هذا الـ endpoint نهائياً. كان بـ يمسح كل التوقعات قبل كل backtest (خرق Rule 1 + Rule 35).',
    deprecated_at: '2026-10-12',
    rule: 'Rule 1 (DB Safety) + Rule 20 (Python=Brain) + Rule 35 (ENGINE-UNIFY)',
    reason: 'This route did `DELETE FROM predictions` on every backtest run — wiped production data.',
    canonical_writer: 'vps-service/jobs/daily_predictor.py (V40.2)',
    canonical_command: 'python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5',
    note: 'Backtests should run on a COPY of the DB (sandbox), not production. Use the Python backtest_engine.py directly on a sandbox DB copy.',
  }, { status: 410 });
}

// ─── ORIGINAL IMPLEMENTATION REMOVED (Rule 16 VERIFY-BEFORE-DELETE) ────────
// The original 146-line implementation that did `DELETE FROM predictions` is
// preserved in git history (commit before this one) for reference.
