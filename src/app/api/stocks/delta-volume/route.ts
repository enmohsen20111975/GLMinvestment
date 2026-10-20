import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks/delta-volume?ticker=COMI&days=14
 *
 * يجلب بيانات delta_volume (ضغط الشراء/البيع) لسهم معين.
 */
export async function GET(request: NextRequest) {
  // BRAVO-FIX8: عرّف ticker قبل try عشان الـ catch يقدر يشوفه (مش ReferenceError)
  let ticker: string | null = null;
  try {
    const { searchParams } = new URL(request.url);
    ticker = searchParams.get('ticker');
    const days = parseInt(searchParams.get('days') || '14', 10);

    if (!ticker) {
      return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
    }

    const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    const db = new Database(dbPath, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');

    // Latest delta
    const latest = db.prepare(`
      SELECT symbol, price_date, volume, buy_volume, sell_volume,
             delta_volume, delta_pct, pressure, close_price
      FROM egksco_price_history
      WHERE symbol = ? AND volume > 0 AND delta_volume IS NOT NULL
      ORDER BY price_date DESC LIMIT 1
    `).get(ticker.toUpperCase()) as any;

    if (!latest) {
      db.close();
      // BRAVO-FIX8: return 200 with empty data (not 500) — matching owner directive
      return NextResponse.json({
        success: true,
        ticker: ticker.toUpperCase(),
        delta_volume: [],
        latest: null,
        history: [],
        summary: null,
        message: 'No data available',
      }, { status: 200 });
    }

    // History
    const history = db.prepare(`
      SELECT price_date, volume, buy_volume, sell_volume,
             delta_volume, delta_pct, pressure, close_price
      FROM egksco_price_history
      WHERE symbol = ? AND volume > 0 AND delta_volume IS NOT NULL
      ORDER BY price_date DESC LIMIT ?
    `).all(ticker.toUpperCase(), days) as any[];

    // Summary
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total_days,
        AVG(delta_pct) as avg_delta_pct,
        SUM(CASE WHEN pressure IN ('STRONG_BUY','BUY') THEN 1 ELSE 0 END) as buy_days,
        SUM(CASE WHEN pressure = 'NEUTRAL' THEN 1 ELSE 0 END) as neutral_days,
        SUM(CASE WHEN pressure IN ('SELL','STRONG_SELL') THEN 1 ELSE 0 END) as sell_days,
        SUM(buy_volume) as total_buy,
        SUM(sell_volume) as total_sell,
        SUM(delta_volume) as total_delta
      FROM egksco_price_history
      WHERE symbol = ? AND volume > 0 AND delta_volume IS NOT NULL
    `).get(ticker.toUpperCase()) as any;

    // Maker direction
    let makerDirection = 'NEUTRAL';
    if (summary && summary.total_days > 0) {
      const buyRatio = summary.buy_days / summary.total_days;
      const sellRatio = summary.sell_days / summary.total_days;
      if (buyRatio > 0.6) makerDirection = 'ACCUMULATION';
      else if (sellRatio > 0.6) makerDirection = 'DISTRIBUTION';
      else if (buyRatio > sellRatio) makerDirection = 'ACCUMULATION_LIGHT';
      else if (sellRatio > buyRatio) makerDirection = 'DISTRIBUTION_LIGHT';
    }

    db.close();

    return NextResponse.json({
      success: true,
      ticker: ticker.toUpperCase(),
      latest: {
        date: latest.price_date,
        volume: latest.volume,
        buy_volume: latest.buy_volume,
        sell_volume: latest.sell_volume,
        delta_volume: latest.delta_volume,
        delta_pct: latest.delta_pct,
        pressure: latest.pressure,
        close: latest.close_price,
      },
      history: history.map((h: any) => ({
        date: h.price_date, volume: h.volume,
        buy_volume: h.buy_volume, sell_volume: h.sell_volume,
        delta_volume: h.delta_volume, delta_pct: h.delta_pct,
        pressure: h.pressure, close: h.close_price,
      })),
      summary: summary ? {
        total_days: summary.total_days,
        avg_delta_pct: Math.round((summary.avg_delta_pct || 0) * 100) / 100,
        buy_days: summary.buy_days,
        sell_days: summary.sell_days,
        neutral_days: summary.neutral_days,
        total_buy: summary.total_buy,
        total_sell: summary.total_sell,
        buy_ratio: (summary.total_buy + summary.total_sell) > 0
          ? Math.round((summary.total_buy / (summary.total_buy + summary.total_sell)) * 100) : 50,
        sell_ratio: (summary.total_buy + summary.total_sell) > 0
          ? Math.round((summary.total_sell / (summary.total_buy + summary.total_sell)) * 100) : 50,
        maker_direction: makerDirection,
      } : null,
    });
  } catch (error: any) {
    console.error('[/api/stocks/delta-volume] Error:', error);
    // BRAVO-FIX8: return 200 with fallback data (never 500 for missing data)
    // ticker now defined in outer scope → no ReferenceError
    return NextResponse.json({
      success: true,
      ticker: ticker?.toUpperCase() || '',
      delta_volume: [],
      latest: null,
      history: [],
      summary: null,
      message: 'No data available',
      fallback: true,
    }, { status: 200 });
  }
}
