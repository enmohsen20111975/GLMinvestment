import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getStockByTickerFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

// GET /api/stocks/[ticker]
// ------------------------
// Primary: Python backend (rich data — fair_value, change_1w/1m, etc.)
// Fallback (FLUTTER-FULL-AUDIT): stocks.db via better-sqlite3 (readonly).
//   Without this fallback the Flutter app's stock-detail screen shows
//   "connection error" whenever the Python service is down — but the
//   underlying stock record IS available in stocks.db. We return it with
//   `source: 'sqlite_fallback'` so the Flutter client can degrade cleanly.

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/stocks/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/stocks/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch (_err) {
      // Try next fallback
    }
  }

  // ── FLUTTER-FULL-AUDIT: stocks.db fallback (Python unreachable) ──
  const fallback = getStockByTickerFallback(ticker);
  if (fallback) {
    return NextResponse.json(fallback);
  }

  return NextResponse.json({
    success: false,
    error: `Failed to fetch ticker ${ticker}`,
    ticker: ticker.toUpperCase(),
    source: 'sqlite_fallback_empty',
  }, { status: 200 });
}
