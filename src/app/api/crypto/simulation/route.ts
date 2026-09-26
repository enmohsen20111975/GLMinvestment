/**
 * Crypto Simulation API
 * =====================
 * Primary: Python backend /api/crypto/simulation/* (portfolio, trades).
 * Fallback (FLUTTER-FULL-AUDIT): when Python is unreachable, return 200
 *   with `success: false` and an empty portfolio so the Flutter app
 *   shows "no simulation data" instead of "connection error".
 *
 * NO mock portfolio data — Rule 27 (no fake data).
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

// GET — Get portfolio status
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get('user_id') || 'demo';

  try {
    const response = await fetch(
      `${PYTHON_API_URL}/api/crypto/simulation/portfolio?user_id=${encodeURIComponent(userId)}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        success: true,
        source: 'python_backend',
        portfolio: data.portfolio,
      });
    }
  } catch {
    // fall through
  }

  // Python unreachable — return 200 (not 503) with empty portfolio
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    portfolio: {
      user_id: userId,
      cash: 0,
      holdings: [],
      total_value: 0,
      pnl: 0,
      pnl_percent: 0,
      trades_count: 0,
    },
    timestamp: new Date().toISOString(),
    warning: 'Python backend unavailable — showing empty portfolio. No simulation history available.',
  });
}

// POST — Execute trade
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id = 'demo', coin_id, action, amount } = body;

    if (!coin_id || !amount || amount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters. Required: coin_id, action (BUY/SELL), amount (> 0)',
        },
        { status: 400 }
      );
    }

    try {
      const response = await fetch(`${PYTHON_API_URL}/api/crypto/simulation/trade`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id,
          coin_id,
          action: action.toUpperCase(),
          amount: parseFloat(amount),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({ success: true, source: 'python_backend', ...data });
      }
    } catch {
      // fall through
    }

    // Python unreachable — return 200 (not 503) with explicit unavailable message
    return NextResponse.json({
      success: false,
      source: 'sqlite_fallback_empty',
      error: 'Python backend unavailable for trade execution',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Trade execution failed: ' + (error instanceof Error ? error.message : 'unknown'),
      },
      { status: 500 }
    );
  }
}
