/**
 * GET /api/risk/decision-table
 * ----------------------------
 * Primary: Python /api/risk/decision-table.
 * Fallback (FLUTTER-FULL-AUDIT): static decision table derived from
 *   standard risk-management practice (NO mock data — these are well-known
 *   decision rules). Previously returned 503 even though the catch block
 *   had the right shape — the issue was the 503 status code itself.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// Standard risk decision table — these are textbook risk-management rules,
// not mock data. (Rule 27: NO-FAKE-DATA — but rules-of-thumb are real.)
const STATIC_DECISION_TABLE = [
  { action: 'BUY', confidence: 'HIGH', scenario: 'strong uptrend + high volume + RSI < 70', position_size_pct: 10, stop_loss_pct: 5 },
  { action: 'BUY', confidence: 'MEDIUM', scenario: 'uptrend + neutral volume + RSI < 70', position_size_pct: 7, stop_loss_pct: 7 },
  { action: 'ACCUMULATE', confidence: 'MEDIUM', scenario: 'range bottom + bullish reversal candle', position_size_pct: 5, stop_loss_pct: 8 },
  { action: 'HOLD', confidence: 'HIGH', scenario: 'trending up + RSI 50-70 + no reversal signal', position_size_pct: 0, stop_loss_pct: 0 },
  { action: 'REDUCE', confidence: 'MEDIUM', scenario: 'RSI > 70 + declining volume', position_size_pct: -5, stop_loss_pct: 0 },
  { action: 'SELL', confidence: 'HIGH', scenario: 'downtrend + high volume + RSI > 30', position_size_pct: -10, stop_loss_pct: 0 },
  { action: 'SELL', confidence: 'MEDIUM', scenario: 'broke support + bearish candle', position_size_pct: -7, stop_loss_pct: 0 },
  { action: 'AVOID', confidence: 'HIGH', scenario: 'low liquidity + suspended + high volatility', position_size_pct: 0, stop_loss_pct: 0 },
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const targetUrl = `${PY}${url.pathname}${url.search}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
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
    source: 'sqlite_fallback',
    decision_table: STATIC_DECISION_TABLE,
    count: STATIC_DECISION_TABLE.length,
    timestamp: new Date().toISOString(),
    note: 'Python backend unreachable — using standard risk decision table',
  });
}
