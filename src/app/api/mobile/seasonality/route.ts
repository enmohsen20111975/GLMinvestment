/**
 * GET /api/mobile/seasonality
 * ==========================
 * Seasonal patterns — falls back to stocks.db stock_daily_prices when Python down.
 * Returns monthly average returns across the historical price data.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';
  const ticker = url.searchParams.get('ticker') || '';

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — stocks.db stock_daily_prices
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 500 }
      );
    }
    const sdb = new Database(stocksDbPath, { readonly: true });

    // Map market param to db market filter (we only have EGX daily prices in stocks.db
    // for the main 452 tickers — seasonality for non-EGX markets is not available)
    const marketMap: Record<string, string> = {
      EGX: 'EGX',
      TADAWUL: 'TADAWUL',
      KSA: 'TADAWUL',
      KSE: 'KSE',
      QSE: 'QSE',
    };
    const dbMarket = marketMap[market.toUpperCase()] || 'EGX';

    // Restrict to EGX stocks — others don't have daily_prices history
    if (dbMarket !== 'EGX') {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        market,
        ticker: ticker || null,
        seasonality: [],
        message_ar: 'لا تتوفر بيانات موسمية لهذا السوق',
        generated_at: new Date().toISOString(),
      });
    }

    // If ticker given: seasonality for that ticker; else aggregate across all EGX stocks
    const tickerClause = ticker
      ? 'AND dp.ticker = ? COLLATE NOCASE'
      : '';
    const params: any[] = ticker ? [ticker] : [];

    const monthly: any[] = sdb
      .prepare(
        `SELECT
           CAST(strftime('%m', dp.price_date) AS INTEGER) AS month,
           COUNT(*)                            AS observations,
           AVG(dp.change_percent)              AS avg_return,
           AVG(dp.close)                       AS avg_close,
           SUM(CASE WHEN dp.change_percent > 0 THEN 1 ELSE 0 END) AS up_days,
           SUM(CASE WHEN dp.change_percent < 0 THEN 1 ELSE 0 END) AS down_days
         FROM stock_daily_prices dp
         JOIN stocks s ON s.ticker = dp.ticker COLLATE NOCASE
         WHERE s.market = ? COLLATE NOCASE
           AND dp.change_percent IS NOT NULL
           ${tickerClause}
         GROUP BY month
         ORDER BY month`
      )
      .all(dbMarket, ...params);

    const monthNamesAr = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
    ];
    const seasonality = monthly.map((m: any) => ({
      month: m.month,
      month_name_ar: monthNamesAr[(m.month - 1) % 12],
      observations: m.observations,
      avg_return: m.avg_return != null ? Number(m.avg_return) : null,
      avg_close: m.avg_close != null ? Number(m.avg_close) : null,
      up_days: m.up_days,
      down_days: m.down_days,
      win_rate:
        m.observations > 0
          ? Number(((m.up_days / m.observations) * 100).toFixed(2))
          : 0,
    }));

    sdb.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      ticker: ticker || null,
      scope: ticker ? 'single_ticker' : 'market_aggregate',
      seasonality,
      count: seasonality.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
