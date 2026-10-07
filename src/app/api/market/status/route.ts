/**
 * Market Status API
 * =================
 * Primary: Python backend /api/market-pulse.
 * Fallback (FLUTTER-FULL-AUDIT): static EGX market-hours calculation
 *   (Sun-Thu, 10:00-14:00 Cairo time). The Flutter app shows a market
 *   open/closed badge in the dashboard banner — without this fallback it
 *   showed "—" instead of a clear open/closed state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketStatusFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;

  // 1. Try Python
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        return NextResponse.json(data);
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — static market-hours calculation
  return NextResponse.json(getMarketStatusFallback());
}
