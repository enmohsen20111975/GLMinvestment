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
//
// BUG-FIX (FRONTEND-DATA-INTEGRITY-A-1, Bug 4, Rule 73):
// The `recommendation` value exposed by this route MUST agree with
// /api/stocks/[ticker]/expert-analysis. Both routes now derive the displayed
// recommendation from the SAME canonical source — getUnifiedStockData().canonical.signal
// — using the SAME default ('HOLD' when no fresh signal exists) that
// expert-analysis applies inside generateExpertAnalysis(). Previously this
// route returned `recommendation: null` whenever the Python service was down
// AND no prediction row existed for the ticker (e.g. COMI), while
// expert-analysis returned 'HOLD' for the same ticker — a direct
// contradiction the client could see when swapping screens.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();
  const url = new URL(request.url);
  const qs = url.searchParams.toString();

  // Resolve the canonical recommendation ONCE so every branch agrees.
  // Mirrors expert-analysis: rec = (canonical.signal || prediction.signal) || 'HOLD'.
  const unified = getUnifiedStockData(tickerUpper);
  const canonicalSignal = unified?.canonical?.signal ?? null;
  const recommendationStr = canonicalSignal || 'HOLD';
  const recommendationAr = unified?.canonical?.signal_ar || 'انتظار';

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
      if (unified && data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        d.signal = unified.canonical.signal;
        d.signal_ar = unified.canonical.signal_ar;
        d.master_score = unified.canonical.master_score;
        // Bug 4: canonical recommendation (uppercase, 'HOLD' default) — matches expert-analysis.
        d.recommendation = recommendationStr;
        d.recommendation_ar = recommendationAr;
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
    if (unified) {
      (rec as any).signal = unified.canonical.signal;
      (rec as any).signal_ar = unified.canonical.signal_ar;
      (rec as any).master_score = unified.canonical.master_score;
      (rec as any).recommendation = recommendationStr;
      (rec as any).recommendation_ar = recommendationAr;
      (rec as any).rsi = unified.technical.rsi ?? (rec as any).rsi;
      (rec as any).unified = true;
      (rec as any).unified_source = unified.canonical.master_score_source;
    }
    // Bug 4: expose the canonical recommendation STRING at the top level so it
    // matches expert-analysis.recommendation exactly. The prediction row is
    // kept under `data` (and its key fields are also surfaced at the top level
    // so adaptDeepAnalysis, which reads raw.target_price / raw.entry_price as
    // a fallback, keeps working without the prediction row being the
    // `recommendation` field itself).
    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      ticker: tickerUpper,
      recommendation: recommendationStr,
      recommendation_ar: recommendationAr,
      signal: canonicalSignal,
      data: rec,
      entry_price: (rec as any).entry_price ?? null,
      target_price: (rec as any).target_price ?? null,
      stop_loss: (rec as any).stop_loss ?? null,
      confidence: (rec as any).confidence ?? null,
    });
  }

  // No prediction row AND Python unreachable — still return the canonical
  // recommendation (with the 'HOLD' default) so this route never contradicts
  // expert-analysis. `data` is null because there is genuinely no prediction.
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    ticker: tickerUpper,
    recommendation: recommendationStr,
    recommendation_ar: recommendationAr,
    signal: canonicalSignal,
    data: null,
    message: 'لا توجد توقعات متاحة حالياً',
  });
}
