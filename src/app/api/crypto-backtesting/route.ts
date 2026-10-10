/**
 * GET /api/crypto-backtesting
 * ---------------------------
 * Primary: Python /api/crypto-backtesting.
 * Fallback (FLUTTER-FULL-AUDIT): 200 with empty result — crypto
 *   backtesting is Python-only.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/crypto-backtesting${qs ? `?${qs}` : ''}`;

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
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    results: [],
    data: [],
    count: 0,
    message: 'Python backend unavailable — crypto backtest history not accessible',
    timestamp: new Date().toISOString(),
  });
}
