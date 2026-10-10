/**
 * GET /api/market/investing
 * =========================
 * بين trảي بيانات السوق بأسلوب Investing.com
 * (الأصل كان بيعمل scrape من investing.com - دلوقتي بيجيب من data_engine.db)
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const market = searchParams.get('market') || 'EGX';
    const limit = parseInt(searchParams.get('limit') || '50');

    // استخدم data_engine.db للبيانات الفعلية
    const { getDataEngineDb, getMarketStats, getTopMovers } = await import('@/lib/data-engine-db');
    const db = getDataEngineDb();

    // إحصائيات السوق
    const stats = getMarketStats(market);

    // أعلى الصاعدات والهابطات
    const movers = getTopMovers(market, Math.min(limit, 20));

    // الأسهم الأكثر نشاطاً
    const activeStocks = db.prepare(`
      SELECT symbol as ticker, name, price, change_percent, volume, market_cap
      FROM stocks
      WHERE price > 0 AND market = ?
      ORDER BY CAST(volume AS REAL) DESC
      LIMIT ?
    `).all(market === 'EGX' ? 'مصر' : market, limit) as any[];

    // نسبة الصاعدات/الهابطات
    const gainersCount = activeStocks.filter(s => Number(s.change_percent) > 0).length;
    const losersCount = activeStocks.filter(s => Number(s.change_percent) < 0).length;
    const unchangedCount = activeStocks.filter(s => Number(s.change_percent) === 0).length;

    // أعلى الصاعدات
    const topGainers = activeStocks
      .filter(s => Number(s.change_percent) > 0)
      .sort((a, b) => Number(b.change_percent) - Number(a.change_percent))
      .slice(0, 10)
      .map(s => ({
        ticker: s.ticker,
        name: s.name,
        price: Number(s.price),
        change_percent: Number(s.change_percent),
        volume: parseFloat(String(s.volume || '0')) || 0,
        market_cap: s.market_cap,
      }));

    // أعلى الهابطات
    const topLosers = activeStocks
      .filter(s => Number(s.change_percent) < 0)
      .sort((a, b) => Number(a.change_percent) - Number(b.change_percent))
      .slice(0, 10)
      .map(s => ({
        ticker: s.ticker,
        name: s.name,
        price: Number(s.price),
        change_percent: Number(s.change_percent),
        volume: parseFloat(String(s.volume || '0')) || 0,
        market_cap: s.market_cap,
      }));

    // الأكثر نشاطاً (حسب الحجم)
    const mostActive = activeStocks
      .sort((a, b) => (parseFloat(String(b.volume || '0')) || 0) - (parseFloat(String(a.volume || '0')) || 0))
      .slice(0, 10)
      .map(s => ({
        ticker: s.ticker,
        name: s.name,
        price: Number(s.price),
        change_percent: Number(s.change_percent),
        volume: parseFloat(String(s.volume || '0')) || 0,
        market_cap: s.market_cap,
      }));

    return NextResponse.json({
      success: true,
      market,
      source: 'data_engine',
      fetched_at: new Date().toISOString(),
      summary: {
        total_stocks: activeStocks.length,
        gainers: gainersCount,
        losers: losersCount,
        unchanged: unchangedCount,
        market_breadth: activeStocks.length > 0
          ? Math.round((gainersCount / activeStocks.length) * 100 * 10) / 10
          : 0,
      },
      top_gainers: topGainers,
      top_losers: topLosers,
      most_active: mostActive,
    });

  } catch (error) {
    console.error('[GET /api/market/investing] Error:', error);

    // Fallback بسيط
    try {
      const { getTopMovers } = await import('@/lib/data-engine-db');
      const movers = getTopMovers('EGX', 10);

      return NextResponse.json({
        success: true,
        market: 'EGX',
        source: 'fallback',
        fetched_at: new Date().toISOString(),
        summary: {
          total_stocks: movers.gainers.length + movers.losers.length,
          gainers: movers.gainers.length,
          losers: movers.losers.length,
          unchanged: 0,
          market_breadth: 0,
        },
        top_gainers: movers.gainers.map((s: any) => ({
          ticker: s.symbol,
          name: s.name,
          price: s.price,
          change_percent: s.change_percent,
          volume: parseFloat(String(s.volume || '0')) || 0,
        })),
        top_losers: movers.losers.map((s: any) => ({
          ticker: s.symbol,
          name: s.name,
          price: s.price,
          change_percent: s.change_percent,
          volume: parseFloat(String(s.volume || '0')) || 0,
        })),
        most_active: [],
      });
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch market data',
          detail: String(error),
        },
        { status: 500 }
      );
    }
  }
}
