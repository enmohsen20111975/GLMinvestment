import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks/delta-volume?ticker=COMI&days=14
 *
 * يجلب بيانات delta_volume (ضغط الشراء/البيع) لسهم معين.
 *
 * (ALPHA-DAL-WAVE2 — owner directive 2026-10-27):
 * «التوجيه عبر DbManager مع التبديل التلقائي لمصدر البيانات الحية.»
 * المسار ده دلوقتي thin wrapper — كل الـ DB access بيحصل جوه DbManager.openDb.
 * المحظور: «ممنوع كتابة SELECT أو new Database() داخل أي مسار UI.»
 */

import { openDb } from '@/lib/db-manager';

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get('ticker');
  const days = parseInt(request.nextUrl.searchParams.get('days') || '14', 10);

  if (!ticker) {
    return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
  }

  const upper = ticker.toUpperCase();

  // (ALPHA-DAL-WAVE2): استخدم openDb من الـ DAL — ممنوع new Database().
  const db = openDb('data_engine.db');
  if (!db) {
    return NextResponse.json({
      success: false,
      error: 'delta_volume_data_unavailable',
      ticker: upper,
      fallback: true,
      latest: null,
      history: [],
      summary: null,
      message: 'No delta volume data available for this ticker',
    }, { status: 200 });
  }

  try {
    // Latest delta
    const latest = db.prepare(`
      SELECT symbol, price_date, volume, buy_volume, sell_volume,
             delta_volume, delta_pct, pressure, close_price
      FROM egksco_price_history
      WHERE symbol = ? AND volume > 0 AND delta_volume IS NOT NULL
      ORDER BY price_date DESC LIMIT 1
    `).get(upper) as any;

    if (!latest) {
      db.close();
      return NextResponse.json({ success: false, error: 'No delta data', ticker: upper });
    }

    // History
    const history = db.prepare(`
      SELECT price_date, volume, buy_volume, sell_volume,
             delta_volume, delta_pct, pressure, close_price
      FROM egksco_price_history
      WHERE symbol = ? AND volume > 0 AND delta_volume IS NOT NULL
      ORDER BY price_date DESC LIMIT ?
    `).all(upper, days) as any[];

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
    `).get(upper) as any;

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
      ticker: upper,
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
    return NextResponse.json({
      success: false,
      error: 'delta_volume_data_unavailable',
      ticker: upper,
      fallback: true,
      latest: null,
      history: [],
      summary: null,
      message: 'No delta volume data available for this ticker',
    }, { status: 200 });
  } finally {
    try { db.close(); } catch { /* noop */ }
  }
}
