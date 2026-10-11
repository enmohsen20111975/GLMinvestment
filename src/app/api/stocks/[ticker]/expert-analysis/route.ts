/**
 * GET /api/stocks/[ticker]/expert-analysis — pure proxy
 * =====================================================
 * Per Rule 20 (Python=Brain) + Rule 67 (CALCULATION-CANONICAL):
 *   The 882-LOC Node-side `expert-analysis.ts` engine was a parallel engine
 *   duplicating Python logic (RSI/MA/S-R/fundamentals analysis + bilingual
 *   expert summary). It also re-implemented the canonical-signal thresholds.
 *
 *   P1-PARALLEL-ENGINES-FIX (2026-10-12): the engine is now ported to Python
 *   (`vps-service/analyzers/expert_analysis_engine.py`). This route is a
 *   pure proxy: it assembles the StockDataForAnalysis shape from
 *   /api/stocks/[ticker]/unified + MarketProfile, POSTs it to Python,
 *   and returns the JSON as-is. NO computation, NO SQLite access.
 *
 * Per Rule 67 §2 (no synthetic approximation): if Python is unreachable,
 * returns 503 with a clear error. NO mock data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedStockData } from '@/lib/unified-stock-data';
import { refreshMarketProfileFromPython } from '@/lib/market-profile';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  try {
    // ── Assemble StockDataForAnalysis from the unified endpoint ─────────
    // (was done inline in the old route — preserved 1:1).
    const unified = getUnifiedStockData(ticker) as any;
    if (!unified || !unified.success) {
      return NextResponse.json(
        { success: false, error: 'stock_not_found', ticker },
        { status: 404 }
      );
    }

    const stock = unified.stock || {};
    const fundamentals = unified.fundamentals || {};
    const technical = unified.technical || {};
    const prediction = unified.prediction || {};
    const canonical = unified.canonical || {};

    // ARCH-OPTION-2: best-effort refresh MarketProfile from Python before analysis
    const marketCode = String(stock.market || 'EGX');
    await refreshMarketProfileFromPython(marketCode).catch(() => {});

    const dataForAnalysis = {
      ticker,
      name: stock.name,
      name_ar: stock.name_ar,
      sector: stock.sector,
      market: stock.market,
      current_price: stock.current_price,
      previous_close: stock.previous_close,
      change_percent: stock.change_percent,
      volume: stock.volume,
      market_cap: stock.market_cap,
      rsi: technical.rsi,
      ma_50: technical.ma_50,
      ma_200: technical.ma_200,
      support: technical.support,
      resistance: technical.resistance,
      high_52w: technical.high_52w,
      low_52w: technical.low_52w,
      trend: technical.trend,
      beta: fundamentals.beta,
      pe_ratio: fundamentals.pe_ratio,
      pb_ratio: fundamentals.pb_ratio,
      ps_ratio: fundamentals.ps_ratio,
      eps: fundamentals.eps,
      roe: fundamentals.roe,
      roa: fundamentals.roa,
      debt_to_equity: fundamentals.debt_to_equity,
      current_ratio: fundamentals.current_ratio,
      dividend_yield: fundamentals.dividend_yield,
      profit_margin: fundamentals.profit_margin,
      signal: canonical.signal || prediction.signal,
      master_score: canonical.master_score || prediction.master_score,
      entry_price: prediction.entry_price,
      target_price: prediction.target_price,
      target_price_2: prediction.target_price_2,
      stop_loss: prediction.stop_loss,
      risk_reward: prediction.risk_reward,
      confidence: prediction.confidence,
    };

    // ── Forward to Python canonical endpoint via POST (URL-length safe) ─
    const upstream = await fetch(
      `${PY}/api/stocks/${encodeURIComponent(ticker)}/expert-analysis`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(dataForAnalysis),
      },
    );

    // Pass-through JSON + HTTP status (200/400/500).
    const body = await upstream.json().catch(() => ({
      success: false,
      error: 'python-returned-non-json',
    }));
    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[expert-analysis] proxy error:', msg);
    return NextResponse.json(
      {
        success: false,
        error: 'python-expert-analysis-unavailable',
        detail: process.env.NODE_ENV === 'development' ? msg : undefined,
        ticker,
        source: 'node-proxy',
      },
      { status: 503 }
    );
  }
}
