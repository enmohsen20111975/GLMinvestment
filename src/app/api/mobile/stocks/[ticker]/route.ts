import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { PYTHON_BACKEND_URL, pythonFetch } from '@/lib/python-backend';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

/**
 * GET /api/mobile/stocks/[ticker]
 * بيانات سهم معين للجوال - يستخدم Python Backend أولاً ثم Local DB
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const tickerUpper = ticker.toUpperCase();

    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<{ success: boolean; data: any }>(`/api/stocks/${tickerUpper}`);

    if (pythonResult.success && pythonResult.data?.data) {
      const stock = pythonResult.data.data;
      return NextResponse.json({
        success: true,
        source: 'python_backend',
        data: {
          ticker: stock.ticker || stock.symbol || tickerUpper,
          name_ar: stock.name_ar || stock.name || tickerUpper,
          name: stock.name || stock.name_ar || tickerUpper,
          sector: stock.sector || null,
          current_price: stock.current_price || 0,
          previous_close: stock.previous_close || 0,
          open: stock.open_price || 0,
          high: stock.high_price || 0,
          low: stock.low_price || 0,
          volume: stock.volume || 0,
          market_cap: stock.market_cap || 0,
          pe_ratio: stock.pe_ratio || null,
          pb_ratio: stock.pb_ratio || null,
          dividend_yield: stock.dividend_yield || null,
          eps: stock.eps || null,
          roe: stock.roe || null,
          is_active: true,
          last_update: stock.last_update || stock.last_updated || new Date().toISOString(),
        },
      });
    }

    // 2. Fallback to Local DB
    await ensureInitialized();
    const dbLite = getLightDb();

    const stock = dbLite.prepare(`
      SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1
    `).get(tickerUpper) as Record<string, unknown> | undefined;

    if (!stock) {
      return NextResponse.json(
        { success: false, error: 'Stock not found', ticker: tickerUpper },
        { status: 404 }
      );
    }

    // Format response for mobile
    return NextResponse.json({
      success: true,
      source: 'local_db',
      data: {
        ticker: stock.ticker,
        name_ar: stock.name_ar || stock.name,
        name: stock.name || stock.name_ar,
        sector: stock.sector,
        current_price: stock.current_price || 0,
        previous_close: stock.previous_close || 0,
        open: stock.open_price || 0,
        high: stock.high_price || 0,
        low: stock.low_price || 0,
        volume: stock.volume || 0,
        market_cap: stock.market_cap || 0,
        pe_ratio: stock.pe_ratio || null,
        pb_ratio: stock.pb_ratio || null,
        dividend_yield: stock.dividend_yield || null,
        eps: stock.eps || null,
        roe: stock.roe || null,
        is_active: stock.is_active,
        last_update: stock.last_update,
      },
    });
  } catch (error) {
    console.error('[Mobile Stocks] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load stock data' },
      { status: 500 }
    );
  }
}
