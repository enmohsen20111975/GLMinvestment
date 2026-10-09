/**
 * GET /api/stocks/[ticker]/expert-analysis
 * =================================================
 * تحليل خبير احترافي شامل للسهم.
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getUnifiedStockData } from '@/lib/unified-stock-data';
import { generateExpertAnalysis, StockDataForAnalysis } from '@/lib/expert-analysis';

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
    const unified = getUnifiedStockData(ticker) as any;
    if (!unified || !unified.success) {
      return NextResponse.json(
        { success: false, error: 'stock_not_found', ticker },
        { status: 404 }
      );
    }

    // Flatten nested structure
    const stock = unified.stock || {};
    const fundamentals = unified.fundamentals || {};
    const technical = unified.technical || {};
    const prediction = unified.prediction || {};
    const canonical = unified.canonical || {};

    const dataForAnalysis: StockDataForAnalysis = {
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
      // Technical
      rsi: technical.rsi,
      ma_50: technical.ma_50,
      ma_200: technical.ma_200,
      support: technical.support,
      resistance: technical.resistance,
      high_52w: technical.high_52w,
      low_52w: technical.low_52w,
      trend: technical.trend,
      beta: fundamentals.beta,
      // Fundamental
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
      // Prediction
      signal: canonical.signal || prediction.signal,
      master_score: canonical.master_score || prediction.master_score,
      entry_price: prediction.entry_price,
      target_price: prediction.target_price,
      target_price_2: prediction.target_price_2,
      stop_loss: prediction.stop_loss,
      risk_reward: prediction.risk_reward,
      confidence: prediction.confidence,
    };

    const analysis = generateExpertAnalysis(dataForAnalysis);

    return NextResponse.json({
      success: true,
      ticker,
      analysis,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[expert-analysis] Error:', error);
    return NextResponse.json(
      { success: false, error: 'internal_error', ticker },
      { status: 500 }
    );
  }
}
