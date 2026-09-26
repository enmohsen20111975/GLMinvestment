/**
 * GET /api/live/scan
 * ------------------
 * Primary: Python /api/live/scan (live market scanner).
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — return top-movers as a
 *   "scan" result. Previously returned 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTopMoversFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limit = Math.min(
    100,
    Math.max(5, parseInt(request.nextUrl.searchParams.get('limit') || '10', 10))
  );

  try {
    const res = await fetch(`http://localhost:8010/api/live/scan?limit=${limit}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
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

  // SQLite fallback — top movers from stocks.db
  const { gainers, losers, most_active } = getTopMoversFallback(limit);
  const scan = [...gainers, ...losers].slice(0, limit);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    scan,
    results: scan,
    data: scan,
    gainers,
    losers,
    most_active,
    count: scan.length,
    timestamp: new Date().toISOString(),
    message: 'Python backend unreachable — using stocks.db top-movers as scan results',
  });
}
