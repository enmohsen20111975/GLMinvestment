/**
 * GET /api/expert-recommendations/batch
 * ======================================
 * Admin-only batch proxy to Python backend's `/api/flow/top`.
 *
 * P0-11-AUTH fix (2026-09-27): added admin auth guard — batch endpoint
 * was previously open to anyone. Now `requireAdminAsync` blocks non-admin
 * callers before the proxy fires.
 *
 * PKG2-ROUND2 (Engineering): migrated to the Unified Response Schema.
 *  - Success path: passes through Python's response shape (Rule 20 —
 *    Python is the canonical source for expert recommendations).
 *  - Error path: was `NextResponse.json({success:false, error:'internal_error'}, {status:503})`
 *    → now `apiErr('backend_unreachable', msg, 503)`.
 *  - Removed `catch (e)` (implicit any) → `catch (err: unknown)` with
 *    `err instanceof Error ? err.message : String(err)`.
 *  - Typed the upstream response as `unknown` (no `any`).
 *
 * Rule 20 (Python = brain): Node route is a thin proxy + auth guard.
 * Rule 27 (NO-FAKE-DATA): no fabricated recommendations when Python is
 *   down — admin sees an explicit error.
 * Rule 67 (SSOT): error envelope carries the canonical server timestamp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiErr } from '@/lib/api-response';
import { requireAdminAsync } from '@/lib/admin-guard';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/flow/top${qs ? `?${qs}` : ''}`;

    const options: RequestInit = { signal: AbortSignal.timeout(30000) };
    if (req.method !== 'GET') {
      options.method = req.method;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = await req.text();
    }

    const res = await fetch(targetUrl, options);
    const data: unknown = await res.json();
    // Pass through Python's response shape — Python is canonical (Rule 20).
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[expert-recommendations:batch]', msg);
    return apiErr('backend_unreachable', `Python backend unreachable: ${msg}`, 503);
  }
}
