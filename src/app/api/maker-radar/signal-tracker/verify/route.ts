/**
 * POST /api/maker-radar/signal-tracker/verify
 * ============================================
 * CANONICAL signal-tracker verify route — pure Python proxy with honest empty.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened FOUR
 * databases directly (`db/stocks.db`, `db/data_engine.db`, multiple schemas)
 * via `new Database(...)` to (a) fetch post-signal prices AND (b) read+write
 * the `radar_signal_tracking` table. That bypassed the canonical Python
 * engine — Python should own the verification logic + DB writes. Now this
 * route:
 *   1. Proxies POST to Python `/api/maker-radar/signal-tracker/verify` with
 *      the JSON body verbatim (primary).
 *   2. Returns honest empty summary (Rule 27 NO-FAKE-DATA) — zero counts,
 *      zero errors — when Python is unreachable. We MUST NOT fabricate
 *      verification outcomes (win/loss/neutral) without price data.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/maker-radar/signal-tracker/verify
 * body: { max_age_days?: 45 }
 *
 * Verifies pending radar signals (GLM5.2-RADAR-S2-VERIFY-ENGINE):
 *   1. SELECT pending signals between 7 and max_age_days (default 45) old.
 *   2. For each, fetch up to 30 trading days of prices AFTER the signal_date.
 *   3. Compute outcome_7d / outcome_14d / outcome_30d (% return vs entry_price)
 *      using the threshold logic below.
 *   4. Track max_price_after / min_price_after (true excursion).
 *   5. Update status (verified_win / verified_loss / verified_neutral /
 *      stale_data / pending).
 *   6. Return summary.
 *
 * Thresholds (GLM5.2-RADAR-S2):
 *   WIN_7D_PCT    = +2.5    // 7-day  early-win threshold
 *   WIN_14D_PCT   = +4.0    // 14-day mid-win   threshold
 *   STOP_LOSS_PCT = -5.0    // stop-loss breach (any day)
 *
 * The actual verification math runs in Python now — this route only proxies.
 */

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch { // silent fallback (safe-by-design)
    body = {};
  }
  const maxAgeDays = Math.max(7, Math.min(180, Number(body?.max_age_days ?? 45)));

  // ─── 1. PRIMARY: Python canonical endpoint ────────────────────────────────
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/maker-radar/signal-tracker/verify`,
    `http://127.0.0.1:8010/api/maker-radar/signal-tracker/verify`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_age_days: maxAgeDays }),
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.success === true) {
          // Pass through Python response verbatim (Rule 4: mirror only).
          return NextResponse.json({
            ...json,
            source: 'python',
          });
        }
      }
    } catch { // silent fallback (safe-by-design)
    }
  }

  // ─── 2. FALLBACK: honest empty summary (Rule 27 NO-FAKE-DATA) ────────────
  // Python (the canonical source for price history + signal tracker table) is
  // unreachable. We MUST NOT fabricate verification outcomes (win/loss/neutral
  // counts, max_price_after, etc.) without price data. Return a structurally
  // identical but honest-empty summary so the caller UI can render "verifier
  // unavailable" instead of fake-zero results.
  return NextResponse.json({
    success: false,
    error: 'signal_tracker_unavailable',
    fallback: true,
    verified_count: 0,
    win_count: 0,
    loss_count: 0,
    neutral_count: 0,
    stale_count: 0,
    pending_partial_count: 0,
    scanned_count: 0,
    errors: [],
    message: 'محرك التحقق من الإشارات غير متاح — حاول مرة أخرى لاحقاً',
    verified_at: new Date().toISOString(),
  }, { status: 200 });
}
