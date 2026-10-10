/**
 * GET /api/stock-profile/[ticker]
 * -------------------------------
 * Primary: Python /api/stock-profile/<ticker>.
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — return fundamentals snapshot.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStockProfileFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();

  // 1. Try Python
  try {
    const r = await fetch(`${PY}/api/stock-profile/${encodeURIComponent(tickerUpper)}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.success !== false) {
        return NextResponse.json(d);
      }
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — stocks.db fundamentals
  const profile = getStockProfileFallback(tickerUpper);
  if (profile) {
    return NextResponse.json(profile);
  }

  return NextResponse.json({
    success: false,
    source: 'sqlite_fallback_empty',
    ticker: tickerUpper,
    error: `Profile not found for ${tickerUpper}`,
  });
}
