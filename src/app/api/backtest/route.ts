/**
 * POST /api/backtest
 * ------------------
 * Primary: Python /api/backtest (run a backtest on historical data).
 * Fallback (FLUTTER-FULL-AUDIT): return 200 with empty result — backtest
 *   is a Python computation, can't be replicated in SQLite.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { // silent fallback (safe-by-design)
    // empty body — that's fine
  }

  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    result: null,
    trades: [],
    equity_curve: [],
    stats: {
      total_trades: 0,
      win_rate: 0,
      avg_pnl: 0,
      max_drawdown: 0,
      sharpe: 0,
    },
    message: 'Python backend unavailable — backtest could not be executed',
    timestamp: new Date().toISOString(),
  });
}
