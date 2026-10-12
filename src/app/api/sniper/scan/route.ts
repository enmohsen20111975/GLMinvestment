/**
 * GET /api/sniper/scan
 * =====================
 * Thin proxy to Python backend's `/api/sniper/scan`.
 *
 * PKG2-ROUND2 (Engineering): migrated to the Unified Response Schema.
 *  - Success path: passes through Python's response shape (Rule 20 —
 *    Python is the canonical source for scan results).
 *  - Error path: was `NextResponse.json({success:false, error:...}, {status:503})`
 *    → now `apiErr('backend_unreachable', msg, 503)` — a proper unified
 *    error envelope with `timestamp`.
 *  - Removed `catch (e)` (implicit any) → `catch (err: unknown)` with
 *    `err instanceof Error ? err.message : String(err)`.
 *
 * Rule 27 (NO-FAKE-DATA): no fabricated `results: []` — if Python is
 * unreachable, the client sees an explicit error, not an empty list.
 * Rule 67 (SSOT): error envelope carries the canonical server timestamp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiErr } from '@/lib/api-response';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/sniper/scan${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(30000) });
    const data: unknown = await res.json();
    // Pass through Python's response shape — Python is canonical (Rule 20).
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sniper:scan]', msg);
    return apiErr('backend_unreachable', `Python backend unreachable: ${msg}`, 503);
  }
}
