/**
 * Live Stock Prices Sync API
 * يجلب الأسعار الحية من EGXPilot ويحدث قاعدة البيانات
 * 
 * المصادر:
 * 1. EGXPilot - أسعار EGX الحية
 * 2. CoinGecko - أسعار Crypto
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// EGXPilot API URL
const EGXPILOT_API = 'https://egxpilot.com/api/stocks/all';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

interface EGXPilotStock {
  StockName: string;
  Symbol: string;
  LastPrice: number;
  DailyChange: string;
  PrevClose?: number;
  OpenPrice?: number;
  High?: number;
  Low?: number;
  Volume?: number;
}

// Fetch EGX stocks from EGXPilot
async function fetchEGXStocks(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    console.log('[sync-prices] Fetching from EGXPilot...');
    
    const response = await fetch(EGXPILOT_API, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) {
      return { success: false, count: 0, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const stocks: EGXPilotStock[] = data.stocks || [];

    if (!stocks.length) {
      return { success: false, count: 0, error: 'No stocks received' };
    }

    console.log(`[sync-prices] Received ${stocks.length} stocks from EGXPilot`);

    // Update database
    let updated = 0;
    let inserted = 0;

    for (const stock of stocks) {
      const symbol = stock.Symbol;
      if (!symbol || symbol.startsWith('.')) continue;

      const price = stock.LastPrice;
      if (!price || price <= 0) continue;

      const changePercent = parseFloat(stock.DailyChange?.replace('%', '').replace('+', '') || '0');
      const prevClose = stock.PrevClose || price;

      try {
        const existing = await db.stocks.findUnique({ where: { symbol } });

        if (existing) {
          await db.stocks.update({
            where: { symbol },
            data: {
              last_price: price,
              change: price - prevClose,
              change_percent: changePercent,
              open: stock.OpenPrice || null,
              high: stock.High || null,
              low: stock.Low || null,
              volume: stock.Volume || null,
              last_updated: new Date()
            }
          });
          updated++;
        } else {
          await db.stocks.create({
            data: {
              id: `egx_${symbol}_${Date.now()}`,
              symbol,
              name: stock.StockName || symbol,
              last_price: price,
              change: price - prevClose,
              change_percent: changePercent,
              open: stock.OpenPrice || null,
              high: stock.High || null,
              low: stock.Low || null,
              volume: stock.Volume || null,
              last_updated: new Date()
            }
          });
          inserted++;
        }
      } catch (err) {
        // Skip errors
      }
    }

    console.log(`[sync-prices] Updated: ${updated}, Inserted: ${inserted}`);

    return { success: true, count: updated + inserted };

  } catch (error: any) {
    console.error('[sync-prices] Error:', error);
    return { success: false, count: 0, error: error.message };
  }
}

// Fetch Crypto prices from CoinGecko
async function fetchCryptoPrices(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    console.log('[sync-prices] Fetching crypto from CoinGecko...');

    const coins = ['bitcoin', 'ethereum', 'solana', 'ripple', 'cardano', 'dogecoin'];
    
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      return { success: false, count: 0, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    
    console.log('[sync-prices] Crypto prices:', {
      BTC: data.bitcoin?.usd,
      ETH: data.ethereum?.usd,
      SOL: data.solana?.usd
    });

    return { success: true, count: Object.keys(data).length };

  } catch (error: any) {
    console.error('[sync-prices] Crypto error:', error);
    return { success: false, count: 0, error: error.message };
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const searchParams = request.nextUrl.searchParams;
    const source = searchParams.get('source') || 'all';

    const results: Record<string, { success: boolean; count: number; error?: string }> = {};

    if (source === 'all' || source === 'egx') {
      results.egx = await fetchEGXStocks();
    }

    if (source === 'all' || source === 'crypto') {
      results.crypto = await fetchCryptoPrices();
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      results,
      total_updated: Object.values(results).reduce((sum, r) => sum + (r.success ? r.count : 0), 0)
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
