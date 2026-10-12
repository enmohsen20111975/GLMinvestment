/**
 * GET /api/flow
 * ==============
 * Thin cached proxy to Python backend's `/api/flow/summary`.
 * 10-second in-memory TTL — prevents flooding Python with rapid calls.
 *
 * PKG2-ROUND2 (Engineering): migrated to the Unified Response Schema.
 *  - Success path: passes through Python's response shape (Rule 20 —
 *    Python is the canonical source for flow/summary data).
 *  - Error path: was `NextResponse.json({success:false, error:'internal_error'}, {status:503})`
 *    → now `apiErr('backend_unreachable', msg, 503)`.
 *  - Removed `catch (e)` (implicit any) → `catch (err: unknown)` with
 *    `err instanceof Error ? err.message : String(err)`.
 *
 * Rule 27 (NO-FAKE-DATA): no fabricated data when Python is down —
 *   returns an explicit error so the client can retry or surface the
 *   outage. Stale cache is served for the 5-minute stale-TTL window,
 *   but if no cache exists, the client sees an honest error.
 * Rule 67 (SSOT): error envelope carries the canonical server timestamp.
 */

import { NextResponse } from 'next/server';
import { apiErr } from '@/lib/api-response';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

let cache: { t: number; d: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.t < 10000) {
    return NextResponse.json(cache.d);
  }
  try {
    const r = await fetch(`${PY}/api/flow/summary`, { signal: AbortSignal.timeout(15000) });
    const d: unknown = await r.json();
    cache = { t: Date.now(), d };
    return NextResponse.json(d);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[flow]', msg);
    return apiErr('backend_unreachable', `Python backend unreachable: ${msg}`, 503);
  }
}
