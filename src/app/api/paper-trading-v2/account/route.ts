/**
 * GET /api/paper-trading-v2/account
 * ================================
 * P40-Academy Pillar 1: Get or create the user's paper trading account.
 *
 * Returns the account with virtual_balance (default 100,000 EGP),
 * total_equity, total_pnl, total_trades, winning_trades.
 *
 * Auth: uses getSessionUserId() — falls back to 'guest' for unauthenticated
 * users so the academy simulator works without login.
 */

import { NextResponse } from 'next/server';
import { getOrCreateAccount, getPaperTradingUserId } from '@/lib/paper-trading-v2-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userId = await getPaperTradingUserId();
    const account = getOrCreateAccount(userId);
    return NextResponse.json({
      success: true,
      account: {
        ...account,
        win_rate: account.total_trades > 0
          ? Math.round((account.winning_trades / account.total_trades) * 1000) / 10
          : 0,
      },
    });
  } catch (err) {
    console.error('[paper-trading-v2/account] Error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'فشل تحميل الحساب' },
      { status: 500 },
    );
  }
}
