/**
 * ⚠️ ALIAS ROUTE — This endpoint is an alias for /api/market-pulse.
 *
 * P1-CRIT-C-2 FIX (2026-10-14): This route uses marketPulseProxy helper which
 * forwards all requests to Python /api/market-pulse. The route name does not
 * reflect the actual response data. See AUDIT_REPORT_FULL.md Section 3.2.
 *
 * Future Phase P2: replace this route with a 308 redirect to /api/market-pulse.
 */

/**
 * admin/ai-analyze — thin proxy to /api/market-pulse (canonical).
 * Task P1-CLEANUP (2026-10-08): unified from 29-LOC copy-paste to 1-line delegation.
 * The route name is kept for backward compat with frontend callers.
 *
 * AUTH-FIX (2026-10-09, Team 3): إضافة requireAdminAsync (كانت missing).
 */
import { NextRequest, NextResponse } from 'next/server';
import { marketPulseProxy } from '@/lib/market-pulse-proxy';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  return marketPulseProxy(req);
}

