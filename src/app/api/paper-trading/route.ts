/**
 * API للصفقات الوهمية - Paper Trading API
 * 
 * Endpoints:
 * - GET  /api/paper-trading?action=stats - إحصائيات
 * - GET  /api/paper-trading?action=trades - الصفقات
 * - GET  /api/paper-trading?action=lessons - الدروس
 * - GET  /api/paper-trading?action=run - تشغيل دورة تداول
 * - POST /api/paper-trading - تشغيل دورة تداول
 */

import { NextRequest, NextResponse } from 'next/server';
import { initialize as initSqlJs } from '@/lib/sqlite-wrapper';
import {
  initializePaperTradingTables,
  getTradingStats,
  getOpenTrades,
  getRecentClosedTrades,
  getLessons,
  calculateTechnicalIndicators,
  makeTradeDecision,
  openPaperTrade,
  checkOpenTrades,
  type MarketRegime
} from '@/lib/v2/paper-trading-engine';

// VPS API for price history - use local Python backend by default
const VPS_API_URL = process.env.PYTHON_API_URL || process.env.EGX_VPS_API_URL || 'http://127.0.0.1:8010';
const VPS_API_KEY = 'mubasher-sync-2024-secret';

interface StockPrice {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface VPSStock {
  id: number;
  symbol: string;  // ticker
  name: string;
  current_price: number;
  previous_close: number;
  high_price: number;
  low_price: number;
  volume: number;
}

/**
 * جلب الأسهم من VPS
 */
async function fetchStocksFromVPS(): Promise<VPSStock[]> {
  try {
    const response = await fetch(`${VPS_API_URL}/api/stocks`, {
      next: { revalidate: 300 } // Cache 5 minutes
    });
    
    if (!response.ok) {
      console.error('[PaperTrading] VPS stocks API returned:', response.status);
      return [];
    }
    
    const data = await response.json();
    // VPS returns { success: true, count: X, stocks: [...] }
    const stocks = data.stocks || data.data || [];
    console.log(`[PaperTrading] Fetched ${stocks.length} stocks from VPS`);
    return stocks;
  } catch (error) {
    console.error('[PaperTrading] Failed to fetch stocks from VPS:', error);
    return [];
  }
}

/**
 * جلب الأسعار التاريخية من VPS
 */
async function fetchPriceHistoryFromVPS(ticker: string, days: number = 200): Promise<StockPrice[]> {
  try {
    // جرب الـ local-history endpoint الجديد أولاً
    const response = await fetch(
      `${VPS_API_URL}/api/stocks/${ticker}/local-history?days=${days}`,
      { 
        next: { revalidate: 3600 } // Cache 1 hour
      }
    );
    
    if (!response.ok) {
      console.error(`[PaperTrading] Local history API for ${ticker} returned: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    // الـ endpoint بيرجع { success: true, history: [...] }
    const history = data.history || data.data || [];
    
    // تحويل الـ format لو لازم
    return history.map((h: { date: string; open: number; high: number; low: number; close: number; volume: number }) => ({
      date: h.date,
      open: h.open,
      high: h.high,
      low: h.low,
      close: h.close,
      volume: h.volume
    }));
  } catch (error) {
    console.error(`[PaperTrading] Failed to fetch history for ${ticker}:`, error);
    return [];
  }
}

/**
 * جلب السعر الحالي من VPS
 */
async function fetchCurrentPriceFromVPS(ticker: string): Promise<{ price: number; high: number; low: number } | null> {
  try {
    // استخدم local-history بـ 1 day للحصول على السعر الحالي
    const response = await fetch(
      `${VPS_API_URL}/api/stocks/${ticker}/local-history?days=5`,
      { 
        next: { revalidate: 60 } // Cache 1 minute
      }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const history = data.history || [];
    
    if (history.length === 0) return null;
    
    // آخر يوم
    const lastDay = history[history.length - 1];
    return {
      price: lastDay.close,
      high: lastDay.high || lastDay.close,
      low: lastDay.low || lastDay.close
    };
  } catch (error) {
    console.error(`[PaperTrading] Failed to fetch current price for ${ticker}:`, error);
    return null;
  }
}

/**
 * تحديد حالة السوق
 */
function determineMarketRegime(marketData: { egx30_change: number; volume_ratio: number }): MarketRegime {
  if (marketData.egx30_change > 2) return 'BULL';
  if (marketData.egx30_change < -2) return 'BEAR';
  if (Math.abs(marketData.egx30_change) > 1 && marketData.volume_ratio > 1.5) return 'VOLATILE';
  return 'SIDEWAYS';
}

/**
 * تشغيل دورة تداول وهمية كاملة
 */
async function runTradingCycle(): Promise<{
  analyzed: number;
  opened: number;
  closed: number;
  lessons: string[];
  errors: string[];
}> {
  const result = {
    analyzed: 0,
    opened: 0,
    closed: 0,
    lessons: [] as string[],
    errors: [] as string[]
  };

  try {
    // 1. تهيئة sql.js والجداول
    await initSqlJs();
    initializePaperTradingTables();

    // 2. جلب الأسهم من VPS
    const stocks = await fetchStocksFromVPS();
    console.log(`[PaperTrading] Found ${stocks.length} stocks from VPS`);

    if (stocks.length === 0) {
      result.errors.push('No stocks found from VPS');
      return result;
    }

    // 3. تحديد حالة السوق (افتراضي)
    const marketRegime: MarketRegime = 'SIDEWAYS';

    // 4. جلب الأسعار الحالية لفحص الصفقات المفتوحة
    const currentPrices = new Map<string, { high: number; low: number; close: number }>();
    
    // 5. فحص الصفقات المفتوحة أولاً
    for (const stock of stocks.slice(0, 50)) { // أول 50 سهم
      const priceData = await fetchCurrentPriceFromVPS(stock.symbol);
      if (priceData) {
        currentPrices.set(stock.symbol, {
          high: priceData.high,
          low: priceData.low,
          close: priceData.price
        });
      }
    }

    // 6. فحص وإغلاق الصفقات
    const checkResult = checkOpenTrades(currentPrices);
    result.closed = checkResult.closed;
    result.lessons = checkResult.lessons;

    // 7. تحليل أسهم جديدة للدخول (نختار أفضل 20 سهم)
    const stocksToAnalyze = stocks.slice(0, 30);

    for (const stock of stocksToAnalyze) {
      try {
        result.analyzed++;

        // جلب البيانات التاريخية
        const priceHistory = await fetchPriceHistoryFromVPS(stock.symbol, 200);
        
        if (priceHistory.length < 50) {
          continue; // بيانات غير كافية
        }

        // حساب المؤشرات الفنية
        const technical = calculateTechnicalIndicators(priceHistory);
        
        if (!technical) {
          continue;
        }

        // السعر الحالي
        const currentPrice = priceHistory[priceHistory.length - 1].close;

        // اتخاذ قرار
        const decision = makeTradeDecision(
          stock.symbol,
          currentPrice,
          technical,
          null, // fundamental data
          marketRegime,
          null // ticker performance
        );

        // إذا كان هناك إشارة قوية (ثقة >= 60%)، افتح صفقة
        if (decision && decision.confidence >= 60) {
          const tradeId = openPaperTrade(decision);
          if (tradeId) {
            result.opened++;
            console.log(`[PaperTrading] Opened trade #${tradeId} for ${stock.symbol}`);
          }
        }

      } catch (error) {
        result.errors.push(`Error analyzing ${stock.symbol}: ${error}`);
      }
    }

    console.log(`[PaperTrading] Cycle complete: analyzed=${result.analyzed}, opened=${result.opened}, closed=${result.closed}`);

    return result;

  } catch (error) {
    result.errors.push(`Cycle error: ${error}`);
    return result;
  }
}

// ==================== API HANDLERS ====================

export async function GET(request: NextRequest) {
  try {
    // تهيئة sql.js أولاً
    await initSqlJs();
    
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'stats';

    // تهيئة الجداول
    initializePaperTradingTables();

    switch (action) {
      case 'stats': {
        const stats = getTradingStats();
        return NextResponse.json({
          success: true,
          stats
        });
      }

      case 'trades': {
        const open = getOpenTrades();
        const recent = getRecentClosedTrades(50);
        return NextResponse.json({
          success: true,
          open_trades: open,
          recent_closed: recent
        });
      }

      case 'lessons': {
        const lessons = getLessons();
        return NextResponse.json({
          success: true,
          lessons
        });
      }

      case 'run': {
        // تشغيل دورة تداول
        const result = await runTradingCycle();
        return NextResponse.json({
          success: true,
          message: `تم تحليل ${result.analyzed} سهم، فتح ${result.opened} صفقة، إغلاق ${result.closed} صفقة`,
          result
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: 'Unknown action'
        }, { status: 400 });
    }

  } catch (error) {
    console.error('[PaperTrading API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // تهيئة sql.js أولاً
    await initSqlJs();
    
    const body = await request.json();
    const { action } = body;

    // تهيئة الجداول
    initializePaperTradingTables();

    switch (action) {
      case 'run-cycle': {
        const result = await runTradingCycle();
        return NextResponse.json({
          success: true,
          message: `دورة التداول اكتملت`,
          result
        });
      }

      case 'init': {
        initializePaperTradingTables();
        return NextResponse.json({
          success: true,
          message: 'تم تهيئة جداول الصفقات الوهمية'
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: 'Unknown action'
        }, { status: 400 });
    }

  } catch (error) {
    console.error('[PaperTrading API] POST Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
