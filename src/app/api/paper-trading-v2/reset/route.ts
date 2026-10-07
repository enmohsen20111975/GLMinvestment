/**
 * POST /api/paper-trading-v2/reset
 * =================================
 * P40-Academy Pillar 1: Reset the user's paper trading account.
 *
 * Cancels all open orders and resets virtual_balance, total_equity,
 * starting_balance to 100,000 EGP. Counters (total_pnl, total_trades,
 * winning_trades) are zeroed.
 */

import { NextResponse } from 'next/server';
import { resetAccount, getPaperTradingUserId } from '@/lib/paper-trading-v2-db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const userId = await getPaperTradingUserId();
    const account = resetAccount(userId);
    return NextResponse.json({
      success: true,
      account: {
        ...account,
        win_rate: 0,
      },
      message: 'تم تصفير الحساب — رصيد جديد: 100,000 ج.م',
    });
  } catch (err) {
    console.error('[paper-trading-v2/reset] Error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
