/**
 * GET /api/mobile/watchlist
 *
 * قائمة المراقبة للموبايل - بتجيب من stocks.db (user_stock_watchlists)
 * مع enrich من data_engine.db (أسعار + أسماء)
 *
 * بيدعم: CUID + legacy Google Numeric ID (backward compatible)
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getUserIdsWithLegacy, buildUserIdClause } from '@/lib/auth-helper';

export const revalidate = 30; // Cache for 30s

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

    // استخدم stocks.db للـ watchlist entries
    const Database = require('better-sqlite3');
    const path = require('path');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const stocksDb = new Database(stocksDbPath, { readonly: true });

    // بناء WHERE clause لكل الـ user IDs
    const { clause, params } = buildUserIdClause(userIds, 'w.user_id');

    const rows = stocksDb.prepare(`
      SELECT
        w.id,
        w.user_id,
        w.stock_id,
        w.alert_price_above,
        w.alert_price_below,
        w.alert_change_percent,
        w.notes,
        w.added_at,
        w.purchase_price,
        w.quantity,
        w.last_viewed,
        w.view_count
      FROM user_stock_watchlists w
      WHERE ${clause}
      ORDER BY w.added_at DESC
    `).all(...params) as Record<string, unknown>[];

    stocksDb.close();

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        items: [],
        total: 0,
      });
    }

    // enrich مع data_engine.db للأسعار والأسماء
    let enrichedItems: Record<string, unknown>[] = [];
    try {
      const { getDataEngineDb } = await import('@/lib/data-engine-db');
      const deDb = getDataEngineDb();

      enrichedItems = rows.map((row) => {
        // محاولة جلب السعر والاسم من data_engine.db
        // stock_id في stocks.db ممكن يكون رقم، فنحاول نطابقه مع symbol
        let stockInfo: Record<string, unknown> = { ticker: '', name: '', price: 0, change_percent: 0 };

        // محاولة جلب الـ ticker من stocks.db عن طريق stock_id
        // لو مفيش، نستخدم الـ stock_id كـ ticker
        try {
          const stocksDb2 = new Database(stocksDbPath, { readonly: true });
          const stockRow = stocksDb2.prepare(
            'SELECT ticker, name, name_ar FROM stocks WHERE id = ? LIMIT 1'
          ).get(row.stock_id) as Record<string, unknown>;
          if (stockRow) {
            stockInfo.ticker = stockRow.ticker || '';
            stockInfo.name = stockRow.name_ar || stockRow.name || stockRow.ticker || '';
          }
          stocksDb2.close();
        } catch { /* safe-by-design */ }

        // جلب السعر من data_engine.db
        if (stockInfo.ticker) {
          try {
            const deRow = deDb.prepare(
              'SELECT name, price, change_percent FROM stocks WHERE symbol = ? COLLATE NOCASE LIMIT 1'
            ).get(stockInfo.ticker) as Record<string, unknown>;
            if (deRow) {
              stockInfo.name = deRow.name || stockInfo.name;
              stockInfo.price = Number(deRow.price || 0);
              stockInfo.change_percent = Number(deRow.change_percent || 0);
            }
          } catch { /* safe-by-design */ }
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
    } catch { // silent fallback (safe-by-design)
      // fallback: ارجع البيانات بدون enrichment
      enrichedItems = rows.map((row) => ({
        id: row.id,
        ticker: '',
        name: '',
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
  } catch (error: Record<string, unknown>) {
    console.error('[/api/mobile/watchlist] Error:', error);
    return NextResponse.json({
      success: true,
      items: [],
      total: 0,
      error: 'فشل في جلب قائمة المراقبة',
    });
  }
}

/**
 * POST /api/mobile/watchlist
 * إضافة سهم لقائمة المراقبة
 */
export async function POST(request: NextRequest) {
  try {
    const { userIds, primaryUserId } = await getUserIdsWithLegacy();

    if (!primaryUserId) {
      return NextResponse.json(
        { success: false, error: 'سجل دخول لإضافة أسهم لقائمة المراقبة' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { ticker, alert_price_above, alert_price_below, notes, purchase_price, quantity } = body;

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker مطلوب' },
        { status: 400 }
      );
    }

    const Database = require('better-sqlite3');
    const path = require('path');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const stocksDb = new Database(stocksDbPath, { readonly: false });

    // إيجاد stock_id من ticker
    let stockId: number | null = null;
    try {
      const row = stocksDb.prepare(
        'SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1'
      ).get(ticker) as Record<string, unknown>;
      if (row) {
        stockId = row.id;
      }
    } catch { /* safe-by-design */ }

    // إضافة لقائمة المراقبة
    const result = stocksDb.prepare(`
      INSERT INTO user_stock_watchlists
        (user_id, stock_id, alert_price_above, alert_price_below, notes, purchase_price, quantity, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      primaryUserId,
      stockId,
      alert_price_above || null,
      alert_price_below || null,
      notes || null,
      purchase_price || null,
      quantity || null
    );

    stocksDb.close();

    return NextResponse.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'تمت الإضافة لقائمة المراقبة',
    });
  } catch (error: Record<string, unknown>) {
    console.error('[/api/mobile/watchlist POST] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في الإضافة' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mobile/watchlist?id=<id>
 * حذف سهم من قائمة المراقبة
 */
export async function DELETE(request: NextRequest) {
  try {
    const { primaryUserId } = await getUserIdsWithLegacy();

    if (!primaryUserId) {
      return NextResponse.json(
        { success: false, error: 'سجل دخول' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id مطلوب' },
        { status: 400 }
      );
    }

    const Database = require('better-sqlite3');
    const path = require('path');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const stocksDb = new Database(stocksDbPath, { readonly: false });

    stocksDb.prepare(
      'DELETE FROM user_stock_watchlists WHERE id = ? AND user_id = ?'
    ).run(id, primaryUserId);

    stocksDb.close();

    return NextResponse.json({
      success: true,
      message: 'تم الحذف من قائمة المراقبة',
    });
  } catch (error: Record<string, unknown>) {
    console.error('[/api/mobile/watchlist DELETE] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في الحذف' },
      { status: 500 }
    );
  }
}
