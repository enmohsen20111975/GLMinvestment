/**
 * EGXPilot Direct API
 * ====================
 * يجلب بيانات الأسهم مباشرة من EGXPilot
 * بدون الاعتماد على Python Backend
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


// Cache
const CACHE_DURATION = 60; // 1 minute
let stocksCache: { timestamp: number; data: any } | null = null;

const EGXPILOT_API = 'https://egxpilot.com/api/stocks/all';

interface StockData {
  ticker: string;
  name: string;
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  change_percent: number;
  change_amount: number;
  last_update: string;
}

async function fetchFromEGXPilot(): Promise<{ data: StockData[]; count: number } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(EGXPILOT_API, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`EGXPilot returned ${response.status}`);
    }

    const json = await response.json();
    const stocks = json.stocks || [];

    const data: StockData[] = stocks
      .filter((s: any) => s.Symbol && s.LastPrice)
      .map((s: any) => {
        const price = parseFloat(s.LastPrice) || 0;
        const prevClose = parseFloat(s.PrevClose) || price;
        const change = price - prevClose;
        const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

        return {
          ticker: s.Symbol,
          name: s.StockName || s.Symbol,
          current_price: price,
          previous_close: prevClose,
          open_price: parseFloat(s.OpenPrice) || price,
          high_price: parseFloat(s.High) || price,
          low_price: parseFloat(s.Low) || price,
          volume: parseInt(s.Volume) || 0,
          change_percent: changePct,
          change_amount: change,
          last_update: new Date().toISOString()
        };
      });

    return { data, count: data.length };
  } catch (error) {
    console.error('[EGXPilot] Error:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const force = searchParams.get('force') === 'true';
    const limit = parseInt(searchParams.get('limit') || '0');
    const search = searchParams.get('search')?.toUpperCase();

    // Check cache
    const now = Date.now();
    if (!force && stocksCache && (now - stocksCache.timestamp) < CACHE_DURATION * 1000) {
      let data = stocksCache.data;
      
      if (search) {
        data = data.filter((s: StockData) => 
          s.ticker.includes(search) || s.name.includes(search)
        );
      }
      
      if (limit > 0) {
        data = data.slice(0, limit);
      }

      return NextResponse.json({
        success: true,
        cached: true,
        timestamp: new Date(stocksCache.timestamp).toISOString(),
        source: 'EGXPilot',
        count: data.length,
        data
      });
    }

    // Fetch from EGXPilot
    const result = await fetchFromEGXPilot();

    if (!result) {
      // Return cached data if available
      if (stocksCache) {
        return NextResponse.json({
          success: true,
          cached: true,
          stale: true,
          timestamp: new Date(stocksCache.timestamp).toISOString(),
          source: 'EGXPilot (cached)',
          count: stocksCache.data.length,
          data: limit > 0 ? stocksCache.data.slice(0, limit) : stocksCache.data
        });
      }

      return NextResponse.json({
        success: false,
        error: 'لا يمكن الاتصال بـ EGXPilot'
      }, { status: 503 });
    }

    // Update cache
    stocksCache = { timestamp: now, data: result.data };

    let data = result.data;

    if (search) {
      data = data.filter((s: StockData) => 
        s.ticker.includes(search) || s.name.includes(search)
      );
    }

    if (limit > 0) {
      data = data.slice(0, limit);
    }

    return NextResponse.json({
      success: true,
      cached: false,
      timestamp: new Date().toISOString(),
      source: 'EGXPilot',
      count: data.length,
      total_stocks: result.count,
      data
    });

  } catch (error: any) {
    console.error('[EGXPilot API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error' || 'خطأ في جلب البيانات'
    }, { status: 500 });
  }
}

// Force refresh
export async function POST(request: NextRequest) {
  stocksCache = null;
  return GET(request);
}
