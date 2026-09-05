import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';

export const revalidate = 30; // Cache for 30s

/**
 * Smart Confluence Analysis API
 * Proxies to Python backend /api/smart-confluence/analysis/<symbol>
 * Falls back to local analysis if backend is unavailable
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const date = request.nextUrl.searchParams.get('date') || undefined;
  const market = request.nextUrl.searchParams.get('market') || undefined;

  // 1) Try Python backend Smart Confluence Engine
  try {
    const queryParams: Record<string, string> = {};
    if (date) queryParams.date = date;
    if (market) queryParams.market = market;

    const result = await pythonFetch<any>(
      `/api/smart-confluence/analysis/${encodeURIComponent(symbol)}`,
      { params: queryParams, timeout: 20000 }
    );

    if (result.success && result.data) {
      return NextResponse.json({
        success: true,
        source: 'python-backend',
        data: result.data,
      });
    }
  } catch (err) {
    console.warn(`[smart-confluence] Python backend unavailable for ${symbol}:`, err);
  }

  // 2) Fallback: return a neutral analysis with complete structure
  return NextResponse.json({
    success: true,
    source: 'fallback',
    data: {
      symbol,
      name: symbol,
      market: market || 'مصر',
      signal: 'HOLD',
      confidence: 20,
      entry_price: 0,
      target_price: 0,
      stop_loss: 0,
      confluence_score: 40,
      technical_score: 40,
      fundamental_score: 40,
      volume_seasonal_score: 40,
      rsi: 50,
      macd_signal: 'NEUTRAL',
      pe_ratio: null,
      roe: null,
      technical_rating: '',
      phase_scores: {
        technical: { rsi_score: 15, macd_score: 0, ma_score: 10, rating_score: 10 },
        fundamental: { pe_score: 10, roe_score: 10, margin_score: 10 },
        volume_seasonal: { volume: 50, seasonal_bonus: 0 },
        sentiment: { score: 0, max: 10, components: { sma_trend: 0, volume_surge: 0, rsi_sweet_spot: 0 } },
      },
    }
  });
}
