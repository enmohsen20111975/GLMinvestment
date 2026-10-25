import { NextRequest, NextResponse } from 'next/server';

// ============================================================================
// /api/maker-radar/stock-analysis
// ============================================================================
// Proxy to Python Screener API (port 8012) — Hybrid Stage Analyzer v2
//
// Usage:
//   GET /api/maker-radar/stock-analysis?tickers=COMI,HRHO,ADRI
//   → يحلل كل tickers المطلوبة ويرجع النتائج
//
// الـ Python API على port 8012 بـ يـدي:
//   - recommendation (STRONG_BUY/BUY/HOLD/REDUCE/SELL)
//   - hybrid_score (-100 to +100)
//   - layers (HMM + Wyckoff + Weinstein + Volume)
//   - market_context (EGX30 regime)
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

const PYTHON_SCREENER_URL = 'http://127.0.0.1:8012';

interface StockAnalysis {
  ticker: string;
  current_price: number | null;
  recommendation: string;
  hybrid_score: number;
  rsi: number | null;
  veto_applied: boolean;
  layers: {
    l1_hmm_stock: {
      regime: string;
      confidence: number;
      method: string;
    };
    l2_wyckoff: {
      phase: string;
      phase_ar: string;
      has_accumulation: boolean;
      has_spring: boolean;
      has_sos: boolean;
    };
    l3_weinstein: {
      stage: string;
      stage_ar: string;
      ma_slope: number;
      distance_from_ma: number;
    };
    l4_volume: {
      poc: number | null;
      vah: number | null;
      val: number | null;
      position: string;
      breakout_confirmed: boolean;
    };
  };
  reasons: string[];
  error?: string;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tickersParam = url.searchParams.get('tickers') || '';

  if (!tickersParam) {
    return NextResponse.json(
      { error: 'tickers parameter required (comma-separated)' },
      { status: 400 }
    );
  }

  const tickers = tickersParam
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50); // limit 50 tickers per request

  if (tickers.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // sequential fetch من الـ Python API (parallel بـ يـقتل الـ Python)
  const results: StockAnalysis[] = [];
  for (const ticker of tickers) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout per ticker

      const res = await fetch(
        `${PYTHON_SCREENER_URL}/api/stock-screener/analyze?ticker=${encodeURIComponent(ticker)}`,
        { signal: controller.signal, cache: 'no-store' }
      );
      clearTimeout(timeout);

      if (!res.ok) {
        results.push({
          ticker,
          current_price: null,
          recommendation: 'UNKNOWN',
          hybrid_score: 0,
          rsi: null,
          veto_applied: false,
          layers: {
            l1_hmm_stock: { regime: 'UNKNOWN', confidence: 0, method: 'error' },
            l2_wyckoff: { phase: 'UNKNOWN', phase_ar: 'خطأ', has_accumulation: false, has_spring: false, has_sos: false },
            l3_weinstein: { stage: 'UNKNOWN', stage_ar: 'خطأ', ma_slope: 0, distance_from_ma: 0 },
            l4_volume: { poc: null, vah: null, val: null, position: 'UNKNOWN', breakout_confirmed: false },
          },
          reasons: [],
          error: `HTTP ${res.status}`,
        });
        continue;
      }

      const data = await res.json();
      results.push({
        ticker,
        current_price: data.current_price ?? null,
        recommendation: data.recommendation ?? 'UNKNOWN',
        hybrid_score: data.hybrid_score ?? 0,
        rsi: data.rsi ?? null,
        veto_applied: data.veto_applied ?? false,
        layers: data.layers ?? {
          l1_hmm_stock: { regime: 'UNKNOWN', confidence: 0, method: 'unknown' },
          l2_wyckoff: { phase: 'UNKNOWN', phase_ar: 'غير محدد', has_accumulation: false, has_spring: false, has_sos: false },
          l3_weinstein: { stage: 'UNKNOWN', stage_ar: 'غير محدد', ma_slope: 0, distance_from_ma: 0 },
          l4_volume: { poc: null, vah: null, val: null, position: 'UNKNOWN', breakout_confirmed: false },
        },
        reasons: data.reasons ?? [],
      });
    } catch (err: any) {
      results.push({
        ticker,
        current_price: null,
        recommendation: 'UNKNOWN',
        hybrid_score: 0,
        rsi: null,
        veto_applied: false,
        layers: {
          l1_hmm_stock: { regime: 'UNKNOWN', confidence: 0, method: 'error' },
          l2_wyckoff: { phase: 'UNKNOWN', phase_ar: 'خطأ', has_accumulation: false, has_spring: false, has_sos: false },
          l3_weinstein: { stage: 'UNKNOWN', stage_ar: 'خطأ', ma_slope: 0, distance_from_ma: 0 },
          l4_volume: { poc: null, vah: null, val: null, position: 'UNKNOWN', breakout_confirmed: false },
        },
        reasons: [],
        error: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'fetch failed'),
      });
    }
  }

  // ملخص السوق العام (sequential — بعد ما يخلص tickers)
  let market_context = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2min timeout

    const mcRes = await fetch(`${PYTHON_SCREENER_URL}/api/stock-screener/market-context`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (mcRes.ok) {
      market_context = await mcRes.json();
    }
  } catch (e) {
    // silent fail — market_context optional
  }

  return NextResponse.json({
    success: true,
    market_context,
    results,
    timestamp: new Date().toISOString(),
  });
}
