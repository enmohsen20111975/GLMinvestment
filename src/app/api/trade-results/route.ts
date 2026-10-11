/**
 * GET /api/trade-results — pure proxy to Python canonical endpoint
 * ===============================================================
 * Per Rule 20 (Python=Brain) + Rule 67 (CALCULATION-CANONICAL):
 *   The 685-LOC Node-side `trade-results-engine.ts` was a parallel engine
 *   duplicating Python logic (success_rate, SUM(realized_return_percent),
 *   11-point validation, Cairo TZ-aware period bounds). It read predictions.db
 *   directly via better-sqlite3 — Rule 20 violation.
 *
 *   P1-PARALLEL-ENGINES-FIX (2026-10-12): the engine is now ported to Python
 *   (`vps-service/api/misc_routes.py::/api/trade-results`). This route is a
 *   pure proxy: it forwards the query string to Python and returns the JSON
 *   as-is. NO computation, NO SQLite access, NO fallback to fabricated data.
 *
 * ─── ENDPOINT CONTRACT (unchanged — preserved 1:1 by the Python port) ───
 *   GET /api/trade-results?period=daily|weekly|monthly&market=EGX
 *   Headers: Authorization: Bearer <token> (or NextAuth session cookie)
 *
 *   See archive/p1-parallel-engines-20261012/ for the original spec.
 *
 *   Response shapes (success, has_qualified_trades, stats, trades, validation)
 *   are identical to the previous Node-side implementation — callers don't
 *   need to change.
 *
 * Per Rule 67 §2 (no synthetic approximation): if Python is unreachable,
 * returns 503 with a clear error. NO mock data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

/**
 * GET handler — pure proxy to Python /api/trade-results.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Auth (kept on the proxy side — same as before) ─────────────────────
  // Per spec section "Auth: required (getSessionUserId)". The Python side
  // doesn't need to know about NextAuth — auth stays in the Node layer.
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    );
  }

  // ── Forward query string + fetch from Python ───────────────────────────
  const qs = request.url.split('?')[1] || '';
  const url = `${PY}/api/trade-results${qs ? `?${qs}` : ''}`;

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(20_000),
      headers: { 'Cache-Control': 'no-store' },
    });

    const body = await upstream.json().catch(() => ({
      success: false,
      error: 'python-returned-non-json',
    }));

    // Pass-through the HTTP status code from Python (200/400/500).
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: 'python-trade-results-unavailable',
        detail: process.env.NODE_ENV === 'development' ? msg : undefined,
        source: 'node-proxy',
      },
      { status: 503 },
    );
  }
}
