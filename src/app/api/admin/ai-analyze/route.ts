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

