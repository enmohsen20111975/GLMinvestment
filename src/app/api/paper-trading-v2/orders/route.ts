/**
 * GET /api/paper-trading-v2/orders
 * =================================
 * P40-Academy Pillar 1: List all orders (open + closed) for the user.
 *
 * Query params:
 *   ?status=open   — only open orders
 *   ?status=closed — only closed orders (last 50)
 *   (default)      — all orders (last 100)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOpenOrders,
  getClosedOrders,
  getAllOrders,
  getPaperTradingUserId,
} from '@/lib/paper-trading-v2-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // F1.2 — auth guard (IDOR fix): require session.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    const user_id = sessionUserId;

    const userId = await getPaperTradingUserId();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let orders;
    if (status === 'open') {
      orders = getOpenOrders(userId);
    } else if (status === 'closed') {
      orders = getClosedOrders(userId, 50);
    } else {
      orders = getAllOrders(userId, 100);
    }

    return NextResponse.json({ success: true, orders, count: orders.length });
  } catch (err) {
    console.error('[paper-trading-v2/orders] Error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
