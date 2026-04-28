import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

// ---------------------------------------------------------------------------
// GET  /api/watchlist-enhanced — Watchlist items with P&L computed fields
// POST /api/watchlist-enhanced — Add item with purchase_price & quantity
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET — Return watchlist with P&L fields
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    const db = await getFinanceDb();

    const rows = db
      .prepare(
        `SELECT
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
           s.ticker,
           s.name,
           s.name_ar,
           s.current_price,
           s.previous_close,
           s.sector,
           s.volume,
           s.market_cap,
           s.pe_ratio,
           s.pb_ratio,
           s.dividend_yield,
           s.eps,
           s.rsi,
           s.ma_50,
           s.ma_200,
           s.egx30_member,
           s.egx70_member,
           s.egx100_member
         FROM user_stock_watchlists w
         JOIN stocks s ON w.stock_id = s.id
         WHERE w.user_id = ?
         ORDER BY w.added_at DESC`
      )
      .all(userId!) as Record<string, unknown>[];

    const items = rows.map((row) => {
      const purchasePrice = Number(row.purchase_price) || 0;
      const qty = Number(row.quantity) || 0;
      const currentPrice = Number(row.current_price) || 0;
      const prevClose = Number(row.previous_close) || 0;
      const totalInvested = purchasePrice * qty;
      const currentValue = currentPrice * qty;
      const gainLoss = currentValue - totalInvested;
      const gainLossPercent = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;
      const priceChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;

      return {
        ...row,
        current_price: currentPrice,
        price_change: Number(priceChange.toFixed(2)),
        price_change_percent: Number(priceChange.toFixed(2)),
        total_invested: Number(totalInvested.toFixed(2)),
        current_value: Number(currentValue.toFixed(2)),
        gain_loss: Number(gainLoss.toFixed(2)),
        gain_loss_percent: Number(gainLossPercent.toFixed(2)),
        stock: {
          id: row.stock_id,
          ticker: row.ticker,
          name: row.name,
          name_ar: row.name_ar,
          current_price: currentPrice,
          previous_close: prevClose,
          sector: row.sector,
          volume: row.volume,
          market_cap: row.market_cap,
          pe_ratio: row.pe_ratio,
          pb_ratio: row.pb_ratio,
          dividend_yield: row.dividend_yield,
          eps: row.eps,
          rsi: row.rsi,
          ma_50: row.ma_50,
          ma_200: row.ma_200,
          egx30_member: row.egx30_member === 1,
          egx70_member: row.egx70_member === 1,
          egx100_member: row.egx100_member === 1,
          price_change: Number(priceChange.toFixed(2)),
        },
      };
    });

    return NextResponse.json({
      success: true,
      items,
      total: items.length,
    });
  } catch (error) {
    console.error('[GET /api/watchlist-enhanced] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading enhanced watchlist' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Add item with purchase_price and quantity
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();

    const body = await request.json();
    const { stock_id, ticker, purchase_price, quantity, alert_price_above, alert_price_below, alert_change_percent, notes } = body;

    const identifier = stock_id ?? ticker;
    if (!identifier) {
      return NextResponse.json(
        { success: false, error: 'Stock ticker or ID is required' },
        { status: 400 }
      );
    }

    // Resolve stock_id from ticker or numeric id
    let resolvedStockId: number | null = null;
    if (typeof identifier === 'number' || /^\d+$/.test(String(identifier))) {
      const row = db
        .prepare('SELECT id FROM stocks WHERE id = ? LIMIT 1')
        .get(Number(identifier)) as { id: number } | undefined;
      resolvedStockId = row ? row.id : null;
    } else {
      const row = db
        .prepare('SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1')
        .get(String(identifier)) as { id: number } | undefined;
      resolvedStockId = row ? row.id : null;
    }

    if (!resolvedStockId) {
      return NextResponse.json(
        { success: false, error: 'Stock not found' },
        { status: 404 }
      );
    }

    // Check for duplicate
    const existing = db
      .prepare('SELECT id FROM user_stock_watchlists WHERE user_id = ? AND stock_id = ? LIMIT 1')
      .get(userId!, resolvedStockId) as { id: number } | undefined;

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Stock already in watchlist', watchlist_id: existing.id },
        { status: 409 }
      );
    }

    const result = db
      .prepare(
        `INSERT INTO user_stock_watchlists (user_id, stock_id, purchase_price, quantity, alert_price_above, alert_price_below, alert_change_percent, notes, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        userId!,
        resolvedStockId,
        purchase_price ?? null,
        quantity ?? null,
        alert_price_above ?? null,
        alert_price_below ?? null,
        alert_change_percent ?? null,
        notes ?? null
      );

    return NextResponse.json({
      success: true,
      message: 'Stock added to watchlist with tracking info',
      id: result.lastInsertRowid,
      stock_id: resolvedStockId,
    });
  } catch (error) {
    console.error('[POST /api/watchlist-enhanced] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error adding to enhanced watchlist' },
      { status: 500 }
    );
  }
}
