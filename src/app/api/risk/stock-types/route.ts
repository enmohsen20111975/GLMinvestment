/**
 * GET /api/risk/stock-types
 * ==========================
 * Thin proxy to Python backend's `/api/risk/stock-types` endpoint.
 * Returns the risk classification of stock types (conservative, balanced,
 * aggressive, speculative).
 *
 * PKG2-ROUND2 (Engineering): migrated to the Unified Response Schema.
 *  - Success path: passes through Python's response shape (Rule 20 —
 *    Python is the canonical source for risk classification).
 *  - Error path: previously returned a hardcoded `success:true, source:'fallback'`
 *    response with a static list of stock types — that was a fabricated
 *    fallback (Rule 27 violation). Now it returns an explicit
 *    `apiErr('backend_unreachable', msg, 503)` so the client knows the
 *    backend is down and can surface an honest error.
 *  - Removed `catch (e)` (implicit any) → `catch (err: unknown)` with
 *    `err instanceof Error ? err.message : String(err)`.
 *  - Typed the upstream response as `unknown` (no `any`).
 *
 * Rule 27 (NO-FAKE-DATA): no fabricated stock-type table when Python is
 *   down — client sees an explicit error and can decide whether to
 *   fall back to a UI-level default (the UI is allowed to ship its own
 *   static defaults; the API is not).
 * Rule 67 (SSOT): error envelope carries the canonical server timestamp.
 */

import { NextResponse } from 'next/server';
import { apiErr } from '@/lib/api-response';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch(`${PY}/api/risk/stock-types`, {
      signal: AbortSignal.timeout(15000),
    });
    const data: unknown = await res.json().catch(() => ({}));
    // Pass through Python's response shape + status code — Python is canonical.
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[risk:stock-types]', msg);
    return apiErr('backend_unreachable', `Python backend unreachable: ${msg}`, 503);
  }
}
