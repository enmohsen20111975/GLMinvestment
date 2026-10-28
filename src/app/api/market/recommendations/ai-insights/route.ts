import { NextRequest, NextResponse } from 'next/server';
import { getPredictionsFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/market/recommendations/ai-insights
// -------------------------------------------
// Primary: Python backend /api/market-pulse.
// Fallback (FLUTTER-FULL-AUDIT): predictions.db — top recommendations by
//   master_score. Previously returned 503.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;
  // FIX (FIX-API-MARKET #14): read `market` and pass it through to the SQLite
  // fallback so non-EGX markets return their own predictions instead of all
  // cross-market rows.
  const market = url.searchParams.get('market') || undefined;

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
  } catch {
    // fall through
  }

  // 2. SQLite fallback — predictions.db top recommendations
  const preds = getPredictionsFallback(50, 'active', market);
  const insights = preds
    .filter((p) => p.master_score != null)
    .sort((a, b) => Number(b.master_score) - Number(a.master_score))
    .slice(0, 20)
    .map((p) => ({
      ticker: p.ticker,
      signal: p.signal,
      signal_ar: p.signal_ar,
      entry_price: p.entry_price,
      target_price: p.target_price,
      stop_loss: p.stop_loss,
      risk_reward: p.risk_reward,
      master_score: p.master_score,
      confidence: p.confidence,
      persona: p.persona,
      status: p.status,
      prediction_date: p.prediction_date,
    }));

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    ai_insights: insights,
    insights: insights,
    recommendations: insights,
    count: insights.length,
    timestamp: new Date().toISOString(),
  });
}
