/**
 * GET /api/egxpilot/news — 308 PERMANENT REDIRECT to /api/news
 * ============================================================================
 * P2-ARCH-A3 FIX (2026-10-14): This route was a STUB returning empty news
 * (53 LOC of dead code). Now it 308-redirects to the canonical /api/news
 * with ?shape=egxpilot so callers get real news data instead of empty arrays.
 *
 * Rule 27 (NO-FAKE-DATA): returning empty arrays was misleading.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.redirect(
    new URL('/api/news?shape=egxpilot', process.env.NEXTAUTH_URL || 'http://localhost:3000'),
    308
  );
}
