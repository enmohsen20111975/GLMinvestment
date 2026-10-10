/**
 * GET /api/live/scan
 * ------------------
 * Primary: Python /api/live/scan (live market scanner).
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — return top-movers as a
 *   "scan" result. Previously returned 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTopMoversFallback } from '@/lib/flutter-sqlite-fallback';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limit = Math.min(
    100,
    Math.max(5, parseInt(request.nextUrl.searchParams.get('limit') || '10', 10))
  );
  // BUG 4 FIX (FIX-A-API): القديم كان بيـ ignore الـ `market` param — كل الأسواق
  // كانت ترجّع نفس 10 أسهم EGX. الحل: نقرأ الـ market ونبعته للـ fallback function.
  const market = (request.nextUrl.searchParams.get('market') || '').trim().toUpperCase() || undefined;

  try {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (market) qs.set('market', market);
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/live/scan?${qs.toString()}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        return NextResponse.json(data);
      }
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // SQLite fallback — top movers from stocks.db (filtered by market)
  const { gainers, losers, most_active } = getTopMoversFallback(limit, market);
  const scan = [...gainers, ...losers].slice(0, limit);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    market: market || 'ALL',
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
