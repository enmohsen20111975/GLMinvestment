/**
 * GET /api/predictions/monthly-league
 * ===================================
 * STOCK-LEAGUE-038: Proxy to Python backend for the Premier Stock League.
 *
 * GET /api/predictions/monthly-league?month=YYYY-MM
 *   Returns: { success, month, month_name, league[], count }
 *   league[] = top 10 closed trades by profit_pct in the specified month.
 *
 * PKG2-ROUND2 (Engineering): migrated to the Unified Response Schema.
 *  - Success path: passes through Python's response shape (Rule 20 —
 *    Python is the canonical source for league data).
 *  - Error path: was `NextResponse.json({success:false, error:'internal_error',
 *    month:'', month_name:'', league:[], count:0}, {status:503})` — the
 *    `league: []` empty array was a fabricated "no league exists" signal
 *    that hid the real outage. Now it returns an explicit
 *    `apiErr('backend_unreachable', msg, 503)` so the client knows the
 *    backend is down.
 *  - Removed `catch (e)` (implicit any) → `catch (err: unknown)` with
 *    `err instanceof Error ? err.message : String(err)`.
 *  - Typed the upstream response as `unknown` (no `any`).
 *
 * Rule 27 (NO-FAKE-DATA): no fabricated empty league when Python is
 *   down — client sees an explicit error and can retry.
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
    const targetUrl = `${PY}/api/predictions/monthly-league${qs ? `?${qs}` : ''}`;

    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    const data: unknown = await res.json();
    // Pass through Python's response shape — Python is canonical (Rule 20).
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[predictions:monthly-league]', msg);
    return apiErr('backend_unreachable', `Python backend unreachable: ${msg}`, 503);
  }
}
