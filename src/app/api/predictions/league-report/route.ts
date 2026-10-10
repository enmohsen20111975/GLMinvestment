import { NextRequest, NextResponse } from 'next/server';
import { getPredictionsFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/predictions/league-report?period=monthly
// ------------------------------------------------
// Primary: Python backend /api/predictions/league-report.
// Fallback (FLUTTER-FULL-AUDIT): predictions.db — compose a league table
//   from closed predictions (top performers by pnl_percent).

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const period = url.searchParams.get('period') || 'monthly';
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/predictions/league-report${qs ? `?${qs}` : ''}`;

  // 1. Try Python
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

  // 2. SQLite fallback — predictions.db closed predictions as league table
  const closed = getPredictionsFallback(200, 'closed');
  const league = closed
    .filter((p) => p.pnl_percent != null)
    .sort((a, b) => Number(b.pnl_percent) - Number(a.pnl_percent))
    .slice(0, 50)
    .map((p, idx) => ({
      rank: idx + 1,
      ticker: p.ticker,
      signal: p.signal,
      signal_ar: p.signal_ar,
      entry_price: p.entry_price,
      exit_price: p.actual_exit_price,
      pnl_percent: Number(p.pnl_percent),
      holding_days: p.closed_at,
      prediction_date: p.prediction_date,
      closed_at: p.closed_at,
      master_score: p.master_score,
      persona: p.persona,
    }));

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    period,
    period_name: period,
    start_date: '',
    end_date: new Date().toISOString().slice(0, 10),
    period_label: period,
    league,
    count: league.length,
    timestamp: new Date().toISOString(),
  });
}
