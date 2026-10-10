/**
 * GET /api/finance/reports
 * ========================
 * FIX: was proxying to /api/market-pulse (wrong!).
 * Now generates a portfolio report from the user's assets and transactions.
 *
 * Returns: { success, report: { assets_summary, transactions_summary,
 *            obligations_summary, net_worth, report_date } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'يجب تسجيل الدخول',
      }, { status: 401 });
    }

    const db = await getFinanceDb();

    // 1. Assets summary
    let assetsSummary = { total_invested: 0, total_current: 0, count: 0, by_type: {} as any };
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'").get() as any;
      if (tableCheck) {
        const assets = db.prepare("SELECT * FROM portfolio_assets WHERE user_id = ?").all(userId) as any[];
        let totalInvested = 0;
        let totalCurrent = 0;
        const byType: Record<string, { count: number; invested: number; current: number }> = {};
        for (const a of assets) {
          const inv = Number(a.total_invested || 0);
          const cur = Number(a.current_value || 0);
          totalInvested += inv;
          totalCurrent += cur;
          const t = a.type || 'other';
          if (!byType[t]) byType[t] = { count: 0, invested: 0, current: 0 };
          byType[t].count++;
          byType[t].invested += inv;
          byType[t].current += cur;
        }
        assetsSummary = {
          total_invested: Math.round(totalInvested * 100) / 100,
          total_current: Math.round(totalCurrent * 100) / 100,
          count: assets.length,
          by_type: byType,
        };
      }
    } catch { /* safe-by-design */ }

    // 2. Transactions summary (current month)
    let transactionsSummary = { total_income: 0, total_expense: 0, net: 0, count: 0 };
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='financial_transactions'").get() as any;
      if (tableCheck) {
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const txns = db.prepare(
          "SELECT * FROM financial_transactions WHERE user_id = ? AND strftime('%Y-%m', transaction_date) = ?"
        ).all(userId, currentMonth) as any[];
        let income = 0;
        let expense = 0;
        for (const t of txns) {
          if (t.type === 'income') income += Number(t.amount || 0);
          else if (t.type === 'expense') expense += Number(t.amount || 0);
        }
        transactionsSummary = {
          total_income: Math.round(income * 100) / 100,
          total_expense: Math.round(expense * 100) / 100,
          net: Math.round((income - expense) * 100) / 100,
          count: txns.length,
        };
      }
    } catch { /* safe-by-design */ }

    // 3. Obligations summary
    let obligationsSummary = { total_remaining: 0, total_monthly: 0, active_count: 0 };
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='financial_obligations'").get() as any;
      if (tableCheck) {
        const obligations = db.prepare(
          "SELECT * FROM financial_obligations WHERE user_id = ? AND status = 'active'"
        ).all(userId) as any[];
        let remaining = 0;
        let monthly = 0;
        for (const o of obligations) {
          remaining += Number(o.remaining_amount || 0);
          monthly += Number(o.monthly_payment || 0);
        }
        obligationsSummary = {
          total_remaining: Math.round(remaining * 100) / 100,
          total_monthly: Math.round(monthly * 100) / 100,
          active_count: obligations.length,
        };
      }
    } catch { /* safe-by-design */ }

    // 4. Net worth = assets current value - obligations remaining
    const netWorth = assetsSummary.total_current - obligationsSummary.total_remaining;

    return NextResponse.json({
      success: true,
      report: {
        assets_summary: assetsSummary,
        transactions_summary: transactionsSummary,
        obligations_summary: obligationsSummary,
        net_worth: Math.round(netWorth * 100) / 100,
        report_date: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[/api/finance/reports] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في توليد التقرير',
      report: null,
    }, { status: 500 });
  }
}
