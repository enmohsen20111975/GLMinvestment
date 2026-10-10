/**
 * POST /api/paper-trading-v2/orders/[id]/close
 * =============================================
 * P40-Academy Pillar 1: Close an open order at the current market price.
 *
 * Body: { current_price: number, reason?: 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT' }
 *
 * Computes realized P&L, credits proceeds to virtual_balance, updates
 * total_pnl, total_trades, winning_trades counters.
 */

import { NextRequest, NextResponse } from 'next/server';
import { closeOrder, getPaperTradingUserId } from '@/lib/paper-trading-v2-db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getPaperTradingUserId();
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'معرّف الصفقة غير صالح' }, { status: 400 });
    }

    const body = await request.json();
    const currentPrice = Number(body.current_price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return NextResponse.json({ success: false, error: 'السعر الحالي مطلوب ويجب أن يكون أكبر من صفر' }, { status: 400 });
    }

    const reason = body.reason === 'STOP_LOSS' || body.reason === 'TAKE_PROFIT'
      ? body.reason
      : 'MANUAL';

    const order = closeOrder(userId, orderId, currentPrice, reason);
    return NextResponse.json({
      success: true,
      order,
      message: order.pnl >= 0
        ? `تم إغلاق الصفقة بربح ${order.pnl.toFixed(2)} ج.م`
        : `تم إغلاق الصفقة بخسارة ${Math.abs(order.pnl).toFixed(2)} ج.م`,
    });
  } catch (err) {
    console.error('[paper-trading-v2/orders/[id]/close] Error:', err);
    const message = err instanceof Error ? err.message : 'فشل إغلاق الصفقة';
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('غير موجود') ? 404 : 500 },
    );
  }
}
