/**
 * GET /api/watchlist-enhanced -> enhanced real user watchlist.
 *
 * Previously proxied to the Python `market-pulse` endpoint (generic breadth
 * data). Now returns the user's actual watchlist enriched with live prices.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserIdsWithLegacy, buildUserIdClause } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { userIds } = await getUserIdsWithLegacy();

    if (userIds.length === 0) {
      return NextResponse.json({ success: true, items: [], total: 0, enhanced: true });
    }

    const Database = require('better-sqlite3');
    const path = require('path');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const stocksDb = new Database(stocksDbPath, { readonly: true });

    const { clause, params } = buildUserIdClause(userIds, 'w.user_id');

    const rows = stocksDb.prepare(`
      SELECT w.id, w.user_id, w.stock_id, w.alert_price_above, w.alert_price_below,
             w.alert_change_percent, w.notes, w.added_at, w.purchase_price, w.quantity
      FROM user_stock_watchlists w
      WHERE ${clause}
      ORDER BY w.added_at DESC
    `).all(...params) as Record<string, unknown>[];

    stocksDb.close();

    let enrichedItems: Record<string, unknown>[] = [];
    try {
      const { getDataEngineDb } = await import('@/lib/data-engine-db');
      const deDb = getDataEngineDb();
      enrichedItems = rows.map((row: Record<string, unknown>) => {
        let stockInfo: Record<string, unknown> = { ticker: '', name: '', price: 0, change_percent: 0 };
        try {
          const sdb = new Database(stocksDbPath, { readonly: true });
          const stockRow = sdb.prepare('SELECT ticker, name, name_ar FROM stocks WHERE id = ? LIMIT 1').get(row.stock_id) as Record<string, unknown>;
          if (stockRow) {
            stockInfo.ticker = stockRow.ticker || '';
            stockInfo.name = stockRow.name_ar || stockRow.name || stockRow.ticker || '';
          }
          sdb.close();
        } catch { /* safe-by-design */ }
        if (stockInfo.ticker) {
          try {
            const deRow = deDb.prepare('SELECT name, price, change_percent FROM stocks WHERE symbol = ? COLLATE NOCASE LIMIT 1').get(stockInfo.ticker) as Record<string, unknown>;
            if (deRow) {
              stockInfo.name = deRow.name || stockInfo.name;
              stockInfo.price = Number(deRow.price || 0);
              stockInfo.change_percent = Number(deRow.change_percent || 0);
            }
          } catch { /* safe-by-design */ }
        }
        const price = Number(stockInfo.price || 0);
        const above = Number(row.alert_price_above || 0);
        const below = Number(row.alert_price_below || 0);
        let signal = 'HOLD';
        if (above && price >= above) signal = 'SELL_ALERT';
        else if (below && price <= below) signal = 'BUY_ALERT';
        return {
          id: row.id,
          ticker: stockInfo.ticker,
          name: stockInfo.name,
          name_ar: stockInfo.name,
          price,
          change_percent: stockInfo.change_percent,
          alert_price_above: row.alert_price_above,
          alert_price_below: row.alert_price_below,
          alert_change_percent: row.alert_change_percent,
          notes: row.notes,
          added_at: row.added_at,
          purchase_price: row.purchase_price,
          quantity: row.quantity,
          signal,
        };
      });
    } catch { // silent fallback (safe-by-design)
      enrichedItems = rows.map((row: Record<string, unknown>) => ({ id: row.id, ticker: '', name: '', price: 0 }));
    }

    return NextResponse.json({
      success: true,
      items: enrichedItems,
      total: enrichedItems.length,
      enhanced: true,
    });
  } catch (error: Record<string, unknown>) {
    console.error('[/api/watchlist-enhanced] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في جلب قائمة المراقبة المحسّنة', items: [], total: 0 },
      { status: 200 }
    );
  }
}
