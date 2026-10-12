/**
 * GET /api/explosive
 * ==================
 * Thin proxy to Python backend's `/api/explosive/top`.
 * Applies the PAYWALL-043 freemium filter on the response (top 3 visible,
 * rest masked) before returning to the client.
 *
 * PKG2-ROUND2 (Engineering): migrated to the Unified Response Schema.
 *  - Success path: passes through Python's response shape (Rule 20 —
 *    Python is the canonical source for explosive picks).
 *  - Error path: was `NextResponse.json({success:false, error:'internal_error'}, {status:503})`
 *    → now `apiErr('backend_unreachable', msg, 503)`.
 *  - Removed `catch (e)` (implicit any) → `catch (err: unknown)` with
 *    `err instanceof Error ? err.message : String(err)`.
 *  - Typed `d` as `Record<string, unknown>` so `d.results = ...` and
 *    `d._paywall = ...` assignments stay type-safe (no `any`).
 *
 * Rule 27 (NO-FAKE-DATA): no fabricated explosive picks when Python is
 *   down — client sees an explicit error and can retry.
 * Rule 67 (SSOT): error envelope carries the canonical server timestamp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiErr } from '@/lib/api-response';
import { getPaywallUser, applyPaywallToResults } from '@/lib/paywall';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit') || '10';
  try {
    const r = await fetch(`${PY}/api/explosive/top?limit=${limit}`, { signal: AbortSignal.timeout(15000) });
    const d = (await r.json()) as Record<string, unknown>;

    // PAYWALL-043: Freemium — Top 3 visible, rest masked
    const user = await getPaywallUser(req);
    if (Array.isArray(d.results)) {
      d.results = applyPaywallToResults(d.results as Parameters<typeof applyPaywallToResults>[0], user.is_premium);
    }
    if (Array.isArray(d.top_explosive)) {
      d.top_explosive = applyPaywallToResults(d.top_explosive as Parameters<typeof applyPaywallToResults>[0], user.is_premium);
    }
    d._paywall = { is_premium: user.is_premium };

    return NextResponse.json(d);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[explosive]', msg);
    return apiErr('backend_unreachable', `Python backend unreachable: ${msg}`, 503);
  }
}
