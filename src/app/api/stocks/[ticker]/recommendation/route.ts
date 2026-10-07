import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getStockRecommendationFallback } from '@/lib/flutter-sqlite-fallback';
// ─── UNIFIED-DATA-CONTRACT (Task DEEP-AUDIT-FIX, Rule 72) ────────────────
import { getUnifiedStockData } from '@/lib/unified-stock-data';

export const dynamic = 'force-dynamic';

// GET /api/stocks/[ticker]/recommendation
// ---------------------------------------
// Primary: Python backend /api/professional-analysis/<ticker>.
// Fallback (FLUTTER-FULL-AUDIT): predictions.db predictions filtered by ticker.
//   Returns the most recent prediction row (signal, target, stop, scores).
// UNIFIED-DATA-CONTRACT: regardless of source, canonical values are injected.

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
      // UNIFIED-DATA-CONTRACT: inject canonical signal/score/rsi into Python response
      const unified = getUnifiedStockData(tickerUpper);
      if (unified && data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        d.signal = unified.canonical.signal;
        d.signal_ar = unified.canonical.signal_ar;
        d.master_score = unified.canonical.master_score;
        d.recommendation = unified.canonical.signal.toLowerCase();
        d.recommendation_ar = unified.canonical.signal_ar;
        d.rsi = unified.technical.rsi ?? d.rsi;
        d.support = unified.technical.support ?? d.support;
        d.resistance = unified.technical.resistance ?? d.resistance;
        d.accumulation = unified.canonical.accumulation;
        d.money_flow_state = unified.canonical.money_flow;
        d.phase = unified.canonical.phase;
        d.unified = true;
        d.unified_source = unified.canonical.master_score_source;
        if (unified.prediction) {
          d.entry_price = unified.prediction.entry_price ?? d.entry_price;
          d.target_price = unified.prediction.target_price ?? d.target_price;
          d.stop_loss = unified.prediction.stop_loss ?? d.stop_loss;
        }
      }
      return NextResponse.json(data);
    }
  } catch {
    // fall through to SQLite
  }

  // SQLite fallback — predictions.db
  const rec = getStockRecommendationFallback(tickerUpper);
  if (rec) {
    // UNIFIED-DATA-CONTRACT: inject canonical values into fallback too
    const unified = getUnifiedStockData(tickerUpper);
    if (unified) {
      (rec as any).signal = unified.canonical.signal;
      (rec as any).signal_ar = unified.canonical.signal_ar;
      (rec as any).master_score = unified.canonical.master_score;
      (rec as any).recommendation = unified.canonical.signal.toLowerCase();
      (rec as any).recommendation_ar = unified.canonical.signal_ar;
      (rec as any).rsi = unified.technical.rsi ?? (rec as any).rsi;
      (rec as any).unified = true;
      (rec as any).unified_source = unified.canonical.master_score_source;
    }
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
    message: 'لا توجد توقعات متاحة حالياً',
  });
}
