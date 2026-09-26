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
