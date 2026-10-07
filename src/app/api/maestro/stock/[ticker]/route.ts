/**
 * GET /api/maestro/stock/[ticker]
 * -------------------------------
 * Primary: Python /api/maestro/stock/<ticker> (full maestro analysis).
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — return basic stock data with
 *   a minimal maestro-style analysis shape. Previously returned 502 which
 *   broke Flutter's stock-detail "maestro" subtab.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStockByTickerFallback, getStockRecommendationFallback } from '@/lib/flutter-sqlite-fallback';
// ─── UNIFIED-DATA-CONTRACT (Task DEEP-AUDIT-FIX, Rule 72) ────────────────
// قبل كده: maestro route بـ يرجّع signal من Python + stocks.db.signal
// (غير محسوب بـ canonical thresholds).
// الحل: نـ inject canonical values من getUnifiedStockData() في كل response.
import { getUnifiedStockData } from '@/lib/unified-stock-data';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();

  const { searchParams } = new URL(request.url);
  const personaType = searchParams.get('persona') || 'balanced';
  const market = searchParams.get('market') || 'EGX';
  const forceRegime = searchParams.get('regime');
  const daysHistory = searchParams.get('days') || '200';

  const pyParams = new URLSearchParams({ market, persona: personaType });
  if (forceRegime) pyParams.set('force_regime', forceRegime);

  const targetUrl = `${PY}/api/maestro/stock/${encodeURIComponent(tickerUpper)}?${pyParams}`;

  // 1. Try Python
  try {
    const pyRes = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });

    if (pyRes.ok) {
      const pyData = await pyRes.json();
      if (pyData.success !== false) {
        const result = pyData.result || pyData.data || pyData;
        // UNIFIED-DATA-CONTRACT: inject canonical signal/score/rsi into Python response
        const unified = getUnifiedStockData(tickerUpper);
        if (unified && result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          r.signal = unified.canonical.signal;
          r.signal_ar = unified.canonical.signal_ar;
          r.master_score = unified.canonical.master_score;
          r.recommendation = unified.canonical.signal.toLowerCase();
          r.recommendation_ar = unified.canonical.signal_ar;
          r.rsi = unified.technical.rsi ?? r.rsi;
          r.support = unified.technical.support ?? r.support;
          r.resistance = unified.technical.resistance ?? r.resistance;
          r.ma_50 = unified.technical.ma_50 ?? r.ma_50;
          r.ma_200 = unified.technical.ma_200 ?? r.ma_200;
          r.accumulation = unified.canonical.accumulation;
          r.money_flow_state = unified.canonical.money_flow;
          r.phase = unified.canonical.phase;
          r.unified = true;
          r.unified_source = unified.canonical.master_score_source;
        }
        return NextResponse.json({
          success: true,
          data: result,
          analysis: pyData.analysis || result,
          ticker: tickerUpper,
          market,
          persona: personaType,
          source: 'python',
          message: `تم تحليل السهم ${tickerUpper} بنجاح (Python)`,
        });
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — stocks.db + predictions.db
  const stock = getStockByTickerFallback(tickerUpper);
  const rec = getStockRecommendationFallback(tickerUpper);
  const analysis = stock
    ? {
        ticker: stock.ticker,
        name: stock.name,
        name_ar: stock.name_ar,
        current_price: stock.current_price,
        previous_close: stock.previous_close,
        change_percent: stock.change_percent,
        volume: stock.volume,
        market_cap: stock.market_cap,
        sector: stock.sector,
        signal: stock.signal || rec?.signal || 'HOLD',
        signal_ar: stock.signal ? '' : rec?.signal_ar || 'احتفاظ',
        trend: stock.trend || 'NEUTRAL',
        support: stock.support,
        resistance: stock.resistance,
        ma_50: stock.ma_50,
        ma_200: stock.ma_200,
        rsi: stock.rsi,
        fundamentals: {
          pe_ratio: stock.pe_ratio,
          pb_ratio: stock.pb_ratio,
          eps: stock.eps,
          roe: stock.roe,
          dividend_yield: stock.dividend_yield,
        },
        prediction: rec,
        persona: personaType,
        regime: 'UNKNOWN',
      }
    : null;

  return NextResponse.json({
    success: !!stock,
    source: 'sqlite_fallback',
    data: analysis,
    analysis,
    ticker: tickerUpper,
    market,
    persona: personaType,
    message: stock
      ? `Python backend unreachable — showing stocks.db data for ${tickerUpper}`
      : `Stock ${tickerUpper} not found in stocks.db`,
  });
}
