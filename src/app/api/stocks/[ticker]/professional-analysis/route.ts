/**
 * Professional Analysis API
 * =========================
 * Primary: Python Backend /api/professional-analysis/<ticker>
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db fundamentals snapshot when
 *   Python is unreachable. Previously returned 500 on fetch failure, which
 *   caused the Flutter app's analysis tab to show "connection error". Now
 *   returns 200 with `data_available: false` so the UI degrades cleanly.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getStockByTickerFallback } from '@/lib/flutter-sqlite-fallback';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();

  try {
    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/professional-analysis/${tickerUpper}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      }
    );

    if (response.ok) {
      const pythonData = await response.json();
      const analysisData = pythonData.data || pythonData;
      return NextResponse.json({
        success: true,
        source: 'python_backend',
        ticker: tickerUpper,
        data: analysisData,
      });
    }

    // Python returned non-2xx — degrade gracefully
    return NextResponse.json(
      {
        success: true,
        source: 'python_backend_empty',
        data_available: false,
        ticker: tickerUpper,
        data: null,
        message: 'لا توجد بيانات تحليل متوفرة لهذا السهم حالياً',
      },
      { status: 200 }
    );
  } catch (error: any) {
    // Python unreachable — fallback to stocks.db fundamentals
    const fallback = getStockByTickerFallback(tickerUpper);
    if (fallback) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        data_available: true,
        ticker: tickerUpper,
        data: {
          ticker: fallback.ticker,
          name: fallback.name,
          name_ar: fallback.name_ar,
          sector: fallback.sector,
          industry: fallback.industry,
          current_price: fallback.current_price,
          previous_close: fallback.previous_close,
          open_price: fallback.open_price,
          high_price: fallback.high_price,
          low_price: fallback.low_price,
          change_percent: fallback.change_percent,
          volume: fallback.volume,
          market_cap: fallback.market_cap,
          fundamentals: {
            pe_ratio: fallback.pe_ratio,
            pb_ratio: fallback.pb_ratio,
            eps: fallback.eps,
            roe: fallback.roe,
            roa: fallback.roa,
            dividend_yield: fallback.dividend_yield,
            debt_to_equity: fallback.debt_to_equity,
            book_value_per_share: fallback.book_value_per_share,
          },
          technicals: {
            ma_50: fallback.ma_50,
            ma_200: fallback.ma_200,
            rsi: fallback.rsi,
            support: fallback.support,
            resistance: fallback.resistance,
            signal: fallback.signal,
            trend: fallback.trend,
          },
        },
      });
    }

    // No data anywhere — return 200 with empty payload so Flutter doesn't retry
    return NextResponse.json(
      {
        success: true,
        data_available: false,
        ticker: tickerUpper,
        data: null,
        source: 'sqlite_fallback_empty',
        message: 'لا توجد بيانات تحليل متوفرة لهذا السهم حالياً',
      },
      { status: 200 }
    );
  }
}
