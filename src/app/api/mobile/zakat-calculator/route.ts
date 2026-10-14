/**
 * ⚠️ 308 PERMANENT REDIRECT to /api/market-pulse
 * ============================================================================
 * P2-ARCH-A4 FIX (2026-10-14): This route was an alias for /api/market-pulse
 * (used marketPulseProxy helper). Now it 308-redirects to the canonical
 * endpoint to eliminate duplicate processing + unify the entry point.
 *
 * 308 preserves the HTTP method (GET stays GET, POST stays POST).
 * Query params are forwarded verbatim.
 *
 * See AUDIT_REPORT_FULL.md Section 3.2 (CRIT-C-2) for details.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function redirectToMarketPulse(request: NextRequest): NextResponse {
  const url = new URL(request.url);
  url.pathname = '/api/market-pulse';
  return NextResponse.redirect(url, 308);
}

export async function GET(request: NextRequest) {
  return redirectToMarketPulse(request);
}
