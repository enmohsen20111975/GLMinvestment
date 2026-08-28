import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks/sparkline?ticker=COMI&days=30
 * Returns last N days of close prices for sparkline rendering.
 * Reads from data_engine.db (egksco_price_history).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker');
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30', 10)));

    if (!ticker) {
      return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
    }

    const dbPath = join(process.cwd(), 'db', 'data_engine.db');
    const db = new Database(dbPath, { readonly: true });

    const rows = db.prepare(`
      SELECT price_date, close_price
      FROM egksco_price_history
      WHERE symbol = ? AND close_price > 0
      ORDER BY price_date DESC
      LIMIT ?
    `).all(ticker, days) as { price_date: string; close_price: number }[];

    db.close();

    if (rows.length === 0) {
      return NextResponse.json({ success: true, ticker, prices: [], min: 0, max: 0 });
    }

    const prices = rows.reverse().map(r => Number(r.close_price));
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
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
