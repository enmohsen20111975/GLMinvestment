/**
 * POST /api/backtesting/unified
 * -----------------------------
 * Primary: Python /api/backtesting/unified (unified backtest runner).
 * Fallback (FLUTTER-FULL-AUDIT): 200 with empty result — same pattern
 *   as /api/backtest.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body — that's fine
  }

  try {
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/backtesting/unified`, {
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
  } catch {
    // fall through
  }

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    result: null,
    trades: [],
    stats: {},
    message: 'Python backend unavailable — unified backtest could not be executed',
    timestamp: new Date().toISOString(),
  });
}
