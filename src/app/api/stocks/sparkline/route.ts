import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks/sparkline?ticker=COMI&days=30
 * Returns last N days of close prices for sparkline rendering.
 *
 * PHASE-2-DB-UNIFY (2026-08-29):
 * - price_history.db.price_history: canonical source (1.24M rows, 25 سنة)
 *   schema: ticker, date, open_price, high_price, low_price, close_price, volume, source
 * - data_engine.db.egksco_price_history: fallback only (0 rows on production)
 *   schema: symbol, price_date, open_price, high_price, low_price, close_price, volume
 * - stocks.db.stock_daily_prices: last fallback (آخر 30 يوم)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker');
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30', 10)));

    if (!ticker) {
      return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
    }

    // 1. price_history.db (canonical source — 1.24M rows)
    try {
      const phPath = join(process.cwd(), 'db', 'price_history.db');
      const phDb = new Database(phPath, { readonly: true });
      const phRows = phDb.prepare(`
        SELECT date, close_price
        FROM price_history
        WHERE ticker = ? AND close_price > 0
        ORDER BY date DESC
        LIMIT ?
      `).all(ticker, days) as { date: string; close_price: number }[];
      phDb.close();

      if (phRows.length > 0) {
        const prices = phRows.reverse().map(r => Number(r.close_price));
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const first = prices[0];
        const last = prices[prices.length - 1];
        const change_pct = first > 0 ? ((last - first) / first) * 100 : 0;

        return NextResponse.json({
          success: true,
          ticker,
          prices,
          min,
          max,
          first,
          last,
          change_pct,
          days: prices.length,
          source: 'price_history.db',
        });
      }
    } catch (e) {
      // fall through to data_engine.db
      console.warn('[sparkline] price_history.db failed:', e instanceof Error ? e.message : e);
    }

    // 2. Fallback: data_engine.db.egksco_price_history
    try {
      const dePath = join(process.cwd(), 'db', 'data_engine.db');
      const deDb = new Database(dePath, { readonly: true });
      const deRows = deDb.prepare(`
        SELECT price_date, close_price
        FROM egksco_price_history
        WHERE symbol = ? AND close_price > 0
        ORDER BY price_date DESC
        LIMIT ?
      `).all(ticker, days) as { price_date: string; close_price: number }[];
      deDb.close();

      if (deRows.length > 0) {
        const prices = deRows.reverse().map(r => Number(r.close_price));
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const first = prices[0];
        const last = prices[prices.length - 1];
        const change_pct = first > 0 ? ((last - first) / first) * 100 : 0;

        return NextResponse.json({
          success: true,
          ticker,
          prices,
          min,
          max,
          first,
          last,
          change_pct,
          days: prices.length,
          source: 'data_engine.db',
        });
      }
    } catch (e) {
      console.warn('[sparkline] data_engine.db failed:', e instanceof Error ? e.message : e);
    }

    // 3. Fallback أخير: stocks.db.stock_daily_prices (آخر 30 يوم)
    try {
      const stocksPath = join(process.cwd(), 'db', 'stocks.db');
      const stocksDb = new Database(stocksPath, { readonly: true });
      const sRows = stocksDb.prepare(`
        SELECT price_date, close_price
        FROM stock_daily_prices
        WHERE ticker = ? AND close_price > 0
        ORDER BY price_date DESC
        LIMIT ?
      `).all(ticker, days) as { price_date: string; close_price: number }[];
      stocksDb.close();

      if (sRows.length > 0) {
        const prices = sRows.reverse().map(r => Number(r.close_price));
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const first = prices[0];
        const last = prices[prices.length - 1];
        const change_pct = first > 0 ? ((last - first) / first) * 100 : 0;

        return NextResponse.json({
          success: true,
          ticker,
          prices,
          min,
          max,
          first,
          last,
          change_pct,
          days: prices.length,
          source: 'stocks.db',
        });
      }
    } catch (e) {
      console.warn('[sparkline] stocks.db failed:', e instanceof Error ? e.message : e);
    }

    // All sources empty
    return NextResponse.json({
      success: true,
      ticker,
      prices: [],
      min: 0,
      max: 0,
      first: 0,
      last: 0,
      change_pct: 0,
      days: 0,
      source: 'none',
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
