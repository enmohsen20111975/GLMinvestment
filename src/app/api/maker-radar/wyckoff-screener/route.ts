import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { trialExpiredResponse } from '@/lib/subscription-gate';
// Rule 20 (Python = brain): unified Python backend URL resolver.
// Handles env-var precedence (PYTHON_BACKEND_URL → EGXPY_SERVICE_URL → …)
// and replaces `localhost` with `127.0.0.1` server-side to dodge IPv6 DNS bugs.
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60; // Python scan ~5s for ~360 EGX tickers; allow headroom.

/**
 * GET /api/maker-radar/wyckoff-screener?market=EGX&phase_filter=C_SPRING&limit=20
 * ============================================================================
 *
 * Thin HTTP proxy to the Python Wyckoff screener endpoint
 * (`GET <PYTHON_BACKEND_URL>/api/wyckoff-screener`).
 *
 * Rule 20 (Python = brain): all computation lives in
 * `vps-service/api/wyckoff_screener_routes.py`, which uses the canonical
 * `detect_wyckoff_accumulation` from `utils/shared_liquidity.py`
 * (Rule 67 — CALCULATION-CANONICAL). Node is a pure pass-through.
 *
 * Rule 27 (NO-FAKE-DATA): if the Python backend is unreachable or returns an
 * error, we surface 503 with a clear message — NO fallback / invented data.
 *
 * Auth model (matches parent /api/maker-radar): anonymous users pass through
 * to see the screener (free-tier preview). Authenticated users with an
 * expired 14-day trial are blocked at 403 TRIAL_EXPIRED. This mirrors the
 * parent route's behavior — no separate auth required for the screener.
 *
 * Response shape (from Python):
 *   {
 *     success: true,
 *     market: 'EGX',
 *     phase_filter: 'C_SPRING',
 *     stocks: [ { ticker, name_ar, phase, phase_label_ar, confidence,
 *                 whale_flow_egp, support, resistance, in_support_zone,
 *                 vsa_confirmed, wash_trade_detected, signal_count, ... } ],
 *     phase_distribution: { A_SC: N, B_CAUSE: N, ... },
 *     computed_at: ISO8601,
 *     scanned_count: N,
 *     skipped_count: N,
 *   }
 */
export async function GET(req: NextRequest) {
  // ─── Trial / subscription gate (same gate as parent /api/maker-radar) ────
  // Maker Radar is a paid-tier preview for free users; if an authenticated
  // user's 14-day trial has fully expired, we 403 TRIAL_EXPIRED. Anonymous
  // users (no userId) pass through — same as the parent radar route.
  const { userId } = await getSessionUserId();
  if (userId) {
    const trialBlock = await trialExpiredResponse(userId);
    if (trialBlock) {
      return NextResponse.json(trialBlock.body, { status: trialBlock.status });
    }
  }

  // ─── Forward query string verbatim to the Python backend ─────────────────
  // We pass the original search params unchanged so the Python blueprint can
  // validate / clamp them itself (single source of truth for param parsing).
  const url = new URL(req.url);
  const upstreamUrl = `${PYTHON_BACKEND_URL}/api/wyckoff-screener?${url.searchParams.toString()}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      // 45s server-side timeout. The Python endpoint scans ~360 EGX tickers
      // in <5s, so 45s gives generous headroom for cold-start DB locks.
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e: any) {
    // Python backend is offline (port :8010 not listening, container down, …).
    // Rule 27: surface 503 — do NOT invent a fallback.
    const reason =
      e?.name === 'TimeoutError'
        ? 'طلب Python Backend انتهى (timeout بعد 45 ثانية)'
        : e?.message || 'Python Backend غير قابل للوصول';
    return NextResponse.json(
      {
        success: false,
        error: 'python_backend_unreachable',
        error_ar:
          'خدمة الـ Python Backend غير متاحة حالياً — مُفرّز وايكوف معطّل مؤقتاً. حاول مرة ثانية خلال دقيقة.',
        detail: reason,
        python_backend_url: PYTHON_BACKEND_URL,
        retry_after_seconds: 30,
      },
      { status: 503 },
    );
  }

  // ─── Pass upstream body through unchanged ───────────────────────────────
  // If Python returned 400 (invalid_phase_filter) or 503 (db_unavailable),
  // surface the same status + body to the caller.
  let body: unknown;
  try {
    body = await upstream.json();
  } catch (parseErr) {
    return NextResponse.json(
      {
        success: false,
        error: 'python_backend_invalid_json',
        error_ar: 'استجابة غير صالحة من Python Backend.',
        detail: parseErr instanceof Error ? parseErr.message : String(parseErr),
        upstream_status: upstream.status,
      },
      { status: 502 },
    );
  }


  if (typeof body === 'object' && body !== null && !('success' in body)) {
    (body as Record<string, unknown>).success = upstream.ok;
  }

  return NextResponse.json(body, {

  // GLM5.2-A (P0-WYCKOFF-FIX): ensure success:true is always present when the
  // upstream returns a valid stocks array. Python may omit it, causing the
  // frontend to reject valid data and show an empty table.
  const response = typeof body === 'object' && body !== null ? { ...body } : body;
  if (typeof response === 'object' && response !== null && Array.isArray((response as Record<string, unknown>).stocks)) {
    (response as Record<string, unknown>).success = true;
  }

  return NextResponse.json(response, {

    status: upstream.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
