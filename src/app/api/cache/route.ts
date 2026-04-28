/**
 * Precomputed Cache API
 * واجهة برمجة التطبيقات للبيانات المحسوبة مسبقاً
 *
 * يوفر بيانات جاهزة للرسوم البيانية بدون إعادة حساب
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getPrecomputedStock,
  getPrecomputedMarket,
  getPrecomputedGold,
  getPrecomputedCurrency,
  getCacheStatus,
  getAllCachedStocks,
  getTopGainers,
  getTopLosers,
  getMostActive,
  updateAllCache,
  clearAllCache,
  initializePrecomputedCache,
} from '@/lib/cache/precomputed-cache';
import { initialize, isInitialized } from '@/lib/sqlite-wrapper';

// تهيئة عند أول استدعاء
let _initialized = false;
let _initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<boolean> {
  if (_initialized) return true;
  
  // Wait for sql.js to be initialized first
  if (!isInitialized()) {
    if (_initPromise) {
      await _initPromise;
    } else {
      _initPromise = initialize();
      try {
        await _initPromise;
      } catch (e) {
        console.warn('[Cache API] sql.js initialization failed:', e);
        return false;
      }
    }
  }
  
  if (!_initialized) {
    try {
      initializePrecomputedCache();
      _initialized = true;
    } catch (e) {
      console.warn('[Cache API] Could not initialize cache:', e);
      return false;
    }
  }
  return true;
}

export async function GET(request: NextRequest) {
  const initialized = await ensureInitialized();
  if (!initialized) {
    return NextResponse.json({
      success: false,
      error: 'Database not initialized. Please try again in a moment.',
      data: null,
    }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'status';

  try {
    switch (action) {
      case 'status':
        return NextResponse.json({
          success: true,
          data: getCacheStatus(),
        });

      case 'stock':
        const ticker = searchParams.get('ticker');
        if (!ticker) {
          return NextResponse.json({
            success: false,
            error: 'ticker parameter required',
          }, { status: 400 });
        }
        const stockData = getPrecomputedStock(ticker.toUpperCase());
        if (!stockData) {
          return NextResponse.json({
            success: false,
            error: `Stock ${ticker} not found in cache`,
          }, { status: 404 });
        }
        return NextResponse.json({
          success: true,
          data: stockData,
        });

      case 'stocks':
        const limit = parseInt(searchParams.get('limit') || '500');
        const allStocks = getAllCachedStocks().slice(0, limit);
        return NextResponse.json({
          success: true,
          data: allStocks,
          count: allStocks.length,
        });

      case 'market':
        const marketData = getPrecomputedMarket();
        return NextResponse.json({
          success: true,
          data: marketData,
        });

      case 'gold':
        const karat = searchParams.get('karat');
        if (karat) {
          const goldData = getPrecomputedGold(karat);
          return NextResponse.json({
            success: true,
            data: goldData,
          });
        }
        // Return all gold prices
        const gold24 = getPrecomputedGold('24');
        const gold22 = getPrecomputedGold('22');
        const gold21 = getPrecomputedGold('21');
        const gold18 = getPrecomputedGold('18');
        return NextResponse.json({
          success: true,
          data: [gold24, gold22, gold21, gold18].filter(Boolean),
        });

      case 'currency':
        const code = searchParams.get('code');
        if (code) {
          const currencyData = getPrecomputedCurrency(code.toUpperCase());
          return NextResponse.json({
            success: true,
            data: currencyData,
          });
        }
        // Would need to implement getAllCurrencies
        return NextResponse.json({
          success: true,
          message: 'Use ?code=USD to get specific currency',
        });

      case 'movers':
        const moversLimit = parseInt(searchParams.get('limit') || '10');
        return NextResponse.json({
          success: true,
          data: {
            gainers: getTopGainers(moversLimit),
            losers: getTopLosers(moversLimit),
            most_active: getMostActive(moversLimit),
          },
        });

      case 'chart-data':
        // Get chart-ready data for a stock
        const chartTicker = searchParams.get('ticker');
        if (!chartTicker) {
          return NextResponse.json({
            success: false,
            error: 'ticker parameter required',
          }, { status: 400 });
        }
        const chartStock = getPrecomputedStock(chartTicker.toUpperCase());
        if (!chartStock) {
          return NextResponse.json({
            success: false,
            error: `Stock ${chartTicker} not found in cache`,
          }, { status: 404 });
        }
        return NextResponse.json({
          success: true,
          data: {
            ticker: chartStock.ticker,
            name: chartStock.name,
            name_ar: chartStock.name_ar,
            current_price: chartStock.current_price,
            price_change_percent: chartStock.price_change_percent,
            trend: {
              direction: chartStock.trend_direction,
              strength: chartStock.trend_strength,
            },
            indicators: {
              sma_20: chartStock.sma_20,
              sma_50: chartStock.sma_50,
              sma_200: chartStock.sma_200,
              rsi_14: chartStock.rsi_14,
              macd: chartStock.macd,
              macd_signal: chartStock.macd_signal,
              bollinger_upper: chartStock.bollinger_upper,
              bollinger_middle: chartStock.bollinger_middle,
              bollinger_lower: chartStock.bollinger_lower,
            },
            support_resistance: {
              support_1: chartStock.support_1,
              support_2: chartStock.support_2,
              resistance_1: chartStock.resistance_1,
              resistance_2: chartStock.resistance_2,
              pivot: chartStock.pivot_point,
            },
            price_history: chartStock.price_summary_365d,
            volume_history: chartStock.volume_summary_365d,
          },
        });

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}`,
          available_actions: ['status', 'stock', 'stocks', 'market', 'gold', 'currency', 'movers', 'chart-data'],
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[Cache API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const initialized = await ensureInitialized();
  if (!initialized) {
    return NextResponse.json({
      success: false,
      error: 'Database not initialized. Please try again in a moment.',
    }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'update':
        const result = await updateAllCache();
        return NextResponse.json({
          success: result.success,
          message: result.success
            ? `Cache updated successfully. ${result.stocks_cached} stocks cached in ${result.duration_ms}ms`
            : `Cache update failed: ${result.error}`,
          data: result,
        });

      case 'clear':
        const cleared = clearAllCache();
        return NextResponse.json({
          success: true,
          message: `Cleared ${cleared} cache entries`,
        });

      case 'init':
        initializePrecomputedCache();
        return NextResponse.json({
          success: true,
          message: 'Cache tables initialized',
        });

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}`,
          available_actions: ['update', 'clear', 'init'],
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[Cache API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
