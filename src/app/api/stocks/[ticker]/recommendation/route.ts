import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getStockRecommendationFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

// GET /api/stocks/[ticker]/recommendation
// ---------------------------------------
// Primary: Python backend /api/professional-analysis/<ticker>.
// Fallback (FLUTTER-FULL-AUDIT): predictions.db predictions filtered by ticker.
//   Returns the most recent prediction row (signal, target, stop, scores).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();
  const url = new URL(request.url);
  const qs = url.searchParams.toString();

  const targetUrl = `${PYTHON_BACKEND_URL}/api/professional-analysis/${tickerUpper}${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // fall through to SQLite
  }

  // SQLite fallback — predictions.db
  const rec = getStockRecommendationFallback(tickerUpper);
  if (rec) {
    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      ticker: tickerUpper,
      recommendation: rec,
      data: rec,
    });
  }

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    ticker: tickerUpper,
    recommendation: null,
    data: null,
    message: 'لا توجد توصيات متاحة حالياً',
  });
}
