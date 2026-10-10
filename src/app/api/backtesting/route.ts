/**
 * GET /api/backtesting
 * --------------------
 * Primary: Python /api/backtesting (backtest results).
 * Fallback (FLUTTER-FULL-AUDIT): empty 200 — backtesting is a Python-only
 *   computation; we can't replicate it in SQLite. Return 200 with empty
 *   arrays so Flutter doesn't show "connection error".
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/backtesting${qs ? `?${qs}` : ''}`;

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
    backtests: [],
    data: [],
    count: 0,
    timestamp: new Date().toISOString(),
    message: 'Python backend unavailable — backtest history not accessible',
  });
}
