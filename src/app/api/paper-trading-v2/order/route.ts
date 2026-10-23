/**
 * POST /api/paper-trading-v2/order
 * ================================
 * P40-Academy Pillar 1: Place a new paper trading order.
 *
 * Body: {
 *   ticker: string,
 *   asset_type: 'stock' | 'crypto' | 'gold',
 *   order_type: 'BUY' | 'SELL',
 *   shares: number,
 *   entry_price: number,
 *   stop_loss?: number,
 *   take_profit?: number,
 *   notes?: string
 * }
 *
 * For BUY: deducts shares × entry_price from virtual_balance.
 * For SELL: validates open position has enough shares, credits proceeds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { placeOrder, getPaperTradingUserId } from '@/lib/paper-trading-v2-db';

import { getSessionUserId } from '@/lib/auth-helper';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // F1.2 — auth guard (IDOR fix): require session.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    const user_id = sessionUserId;

    const userId = await getPaperTradingUserId();
    const body = await request.json();

    // Validate required fields
    const { ticker, asset_type, order_type, shares, entry_price } = body;
    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json({ success: false, error: 'ticker مطلوب' }, { status: 400 });
    }
    if (!['stock', 'crypto', 'gold'].includes(asset_type)) {
      return NextResponse.json({ success: false, error: 'asset_type غير صالح' }, { status: 400 });
    }
    if (!['BUY', 'SELL'].includes(order_type)) {
      return NextResponse.json({ success: false, error: 'order_type يجب أن يكون BUY أو SELL' }, { status: 400 });
    }
    if (typeof shares !== 'number' || shares <= 0) {
      return NextResponse.json({ success: false, error: 'الكمية يجب أن تكون أكبر من صفر' }, { status: 400 });
    }
    if (typeof entry_price !== 'number' || entry_price <= 0) {
      return NextResponse.json({ success: false, error: 'السعر يجب أن يكون أكبر من صفر' }, { status: 400 });
    }

    const order = placeOrder(userId, {
      ticker: ticker.toUpperCase(),
      asset_type,
      order_type,
      shares,
      entry_price,
      stop_loss: body.stop_loss != null ? Number(body.stop_loss) : null,
      take_profit: body.take_profit != null ? Number(body.take_profit) : null,
      notes: body.notes ?? null,
    });

    return NextResponse.json({ success: true, order });
  } catch (err) {
    console.error('[paper-trading-v2/order] Error:', err);
    const message = err instanceof Error ? err.message : 'فشل تنفيذ الأمر';
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('غير كاف') || message.includes('لا توجد') ? 400 : 500 },
    );
  }
}
