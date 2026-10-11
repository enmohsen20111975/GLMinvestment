/**
 * POST /api/recommendations/retroactive-evaluate — Rule 20 HARD GATE
 * ====================================================================
 *
 * RULE20-DISABLED (2026-10-12 — HIDDEN-WRITERS-AUDIT):
 *
 * This route was a rogue path that:
 *   - Opened predictions.db + price_history.db directly via better-sqlite3
 *     (Rule 20 violation — Node must NEVER touch DBs)
 *   - Did `UPDATE real_predictions SET hit_target/hit_stop/final_price/...`
 *     which is a DUPLICATE of daily_closer.py canonical (Rule 28 + Rule 35)
 *   - Computed maxProfit/maxLoss in Node (Rule 67 violation)
 *
 * The canonical outcome writer is `vps-service/jobs/daily_closer.py::DailyCloser.run()`
 * which is invoked via cron (entry 3 in crontab.txt) + market_scheduler.
 *
 * Returns 410 Gone with redirect to daily_closer canonical.
 *
 * Rule 20 (Python=Brain) + Rule 28 (NO-DUPLICATION) + Rule 35 (ENGINE-UNIFY)
 * + Rule 67 (CALCULATION-CANONICAL).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return NextResponse.json({
    success: false,
    deprecated: true,
    error: 'endpoint_deprecated',
    error_ar: 'تم إيقاف هذا الـ endpoint نهائياً. تقييم التوقعات انتقل لـ daily_closer.py في Python.',
    deprecated_at: '2026-10-12',
    rule: 'Rule 20 (Python=Brain) + Rule 28 (NO-DUPLICATION) + Rule 35 (ENGINE-UNIFY) + Rule 67 (CALCULATION-CANONICAL)',
    canonical_writer: 'vps-service/jobs/daily_closer.py (DailyCloser.run)',
    canonical_command: 'python3 vps-service/jobs/daily_closer.py',
    canonical_cron: '0 14 * * 0-4 (daily after market close)',
    reason: 'This route did direct UPDATE on real_predictions from Node (duplicate of daily_closer). Rule 20 violation.',
  }, { status: 410 });
}

// ─── ORIGINAL IMPLEMENTATION REMOVED (Rule 16 VERIFY-BEFORE-DELETE) ────────
// The original 179-line implementation that did direct DB writes is preserved
// in git history (commit before this one) for reference.
