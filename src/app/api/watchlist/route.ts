/**
 * GET /api/watchlist  -> real user watchlist (from stocks.db user_stock_watchlists)
 * POST /api/watchlist -> add a ticker to the watchlist
 *
 * NOTE: Previously this route proxied to the Python `market-pulse` endpoint,
 * which returns generic market-breadth data instead of the user's watchlist.
 * That is the bug that made the watchlist screen show breadth numbers. The
 * route now reads/writes the actual watchlist from stocks.db.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserIdsWithLegacy, buildUserIdClause } from '@/lib/auth-helper';
import { enforceWatchlistLimit, EnforcementError } from '@/lib/subscription-enforcement';
import { openDb, openDbWritable } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';

/** Generic SQL row returned by better-sqlite3. */
type SqlRow = Record<string, unknown>;

interface WatchlistRow {
  id: number;
  user_id: string;
  stock_id: number | null;
  alert_price_above?: number | null;
  alert_price_below?: number | null;
  alert_change_percent?: number | null;
  notes?: string | null;
  added_at?: string | null;
  purchase_price?: number | null;
  quantity?: number | null;
  last_viewed?: string | null;
  view_count?: number | null;
}

interface StockInfo {
  ticker: string;
  name: string;
  price: number;
  change_percent: number;
}

interface EnrichedItem {
  id: number;
  ticker: string;
  name: string;
  name_ar: string;
  price: number;
  change_percent: number;
  alert_price_above?: number | null;
  alert_price_below?: number | null;
  alert_change_percent?: number | null;
  notes?: string | null;
  added_at?: string | null;
  purchase_price?: number | null;
  quantity?: number | null;
  last_viewed?: string | null;
  view_count?: number | null;
}

export async function GET(request: NextRequest) {
  try {
    const { userIds, primaryUserId } = await getUserIdsWithLegacy();

    if (userIds.length === 0) {
      return NextResponse.json({
        success: true,
        items: [],
        total: 0,
        message: 'سجل دخول لعرض قائمة المراقبة',
      });
    }

    const stocksDb = openDb('stocks.db');
    if (!stocksDb) {
      return NextResponse.json({
        success: true,
        items: [],
        total: 0,
        message: 'stocks.db unavailable',
      });
    }

    const { clause, params } = buildUserIdClause(userIds, 'w.user_id');

    const rows = stocksDb.prepare(`
      SELECT
        w.id, w.user_id, w.stock_id,
        w.alert_price_above, w.alert_price_below, w.alert_change_percent,
        w.notes, w.added_at, w.purchase_price, w.quantity,
        w.last_viewed, w.view_count
      FROM user_stock_watchlists w
      WHERE ${clause}
      ORDER BY w.added_at DESC
    `).all(...params) as WatchlistRow[];

    stocksDb.close();

    let enrichedItems: EnrichedItem[] = [];
    try {
      const { getDataEngineDb } = await import('@/lib/data-engine-db');
      const deDb = getDataEngineDb();

      enrichedItems = rows.map((row) => {
        const stockInfo: StockInfo = { ticker: '', name: '', price: 0, change_percent: 0 };
        try {
          const sdb = openDb('stocks.db');
          if (sdb) {
            const stockRow = sdb.prepare('SELECT ticker, name, name_ar FROM stocks WHERE id = ? LIMIT 1').get(row.stock_id) as { ticker?: string; name?: string; name_ar?: string } | undefined;
            if (stockRow) {
              stockInfo.ticker = stockRow.ticker || '';
              stockInfo.name = stockRow.name_ar || stockRow.name || stockRow.ticker || '';
            }
            sdb.close();
          }
        } catch {}

        if (stockInfo.ticker) {
          try {
            const deRow = deDb.prepare('SELECT name, price, change_percent FROM stocks WHERE symbol = ? COLLATE NOCASE LIMIT 1').get(stockInfo.ticker) as { name?: string; price?: number | string; change_percent?: number | string } | undefined;
            if (deRow) {
              stockInfo.name = deRow.name || stockInfo.name;
              stockInfo.price = Number(deRow.price || 0);
              stockInfo.change_percent = Number(deRow.change_percent || 0);
            }
          } catch {}
        }

        return {
          id: row.id,
          ticker: stockInfo.ticker,
          name: stockInfo.name,
          name_ar: stockInfo.name,
          price: stockInfo.price,
          change_percent: stockInfo.change_percent,
          alert_price_above: row.alert_price_above,
          alert_price_below: row.alert_price_below,
          alert_change_percent: row.alert_change_percent,
          notes: row.notes,
          added_at: row.added_at,
          purchase_price: row.purchase_price,
          quantity: row.quantity,
          last_viewed: row.last_viewed,
          view_count: row.view_count,
        };
      });
    } catch {
      enrichedItems = rows.map((row) => ({
        id: row.id,
        ticker: '',
        name: '',
        name_ar: '',
        price: 0,
        change_percent: 0,
        alert_price_above: row.alert_price_above,
        alert_price_below: row.alert_price_below,
        notes: row.notes,
        added_at: row.added_at,
        purchase_price: row.purchase_price,
        quantity: row.quantity,
      }));
    }

    return NextResponse.json({
      success: true,
      items: enrichedItems,
      total: enrichedItems.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[/api/watchlist] Error:', message);
    return NextResponse.json(
      { success: false, error: 'فشل في جلب قائمة المراقبة', items: [], total: 0 },
      { status: 200 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { primaryUserId } = await getUserIdsWithLegacy();
    if (!primaryUserId) {
      return NextResponse.json(
        { success: false, error: 'سجل دخول لإضافة أسهم لقائمة المراقبة' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { ticker, alert_price_above, alert_price_below, notes, purchase_price, quantity } = body;

    if (!ticker) {
      return NextResponse.json({ success: false, error: 'ticker مطلوب' }, { status: 400 });
    }

    // FIX-P3-P5-P6 (Group P3 — Fix 2): enforce Free-tier watchlist limit
    // server-side (Free: 5 items). Paid tiers bypass inside the helper.
    try {
      await enforceWatchlistLimit(primaryUserId);
    } catch (err) {
      if (err instanceof EnforcementError) {
        return NextResponse.json(err.toJSON(), { status: 403 });
      }
      throw err;
    }

    const stocksDb = openDbWritable('stocks.db');
    if (!stocksDb) {
      return NextResponse.json(
        { success: false, error: 'stocks.db unavailable' },
        { status: 500 }
      );
    }

    let stockId: number | null = null;
    try {
      const row = stocksDb.prepare('SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1').get(ticker) as { id?: number } | undefined;
      if (row) stockId = row.id;
    } catch {}

    const result = stocksDb.prepare(`
      INSERT INTO user_stock_watchlists
        (user_id, stock_id, alert_price_above, alert_price_below, notes, purchase_price, quantity, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      primaryUserId,
      stockId,
      alert_price_above ?? null,
      alert_price_below ?? null,
      notes ?? null,
      purchase_price ?? null,
      quantity ?? null
    );

    stocksDb.close();

    return NextResponse.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'تمت الإضافة لقائمة المراقبة',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[/api/watchlist POST] Error:', message);
    return NextResponse.json({ success: false, error: 'فشل في الإضافة' }, { status: 500 });
  }
}
