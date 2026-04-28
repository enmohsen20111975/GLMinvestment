import { NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import type { AssetType, FinancialAlert, PortfolioSummary } from '@/types';
import { getSessionUserId } from '@/lib/auth-helper';

// ---------------------------------------------------------------------------
// GET /api/finance/reports — Comprehensive portfolio summary with alerts
// ---------------------------------------------------------------------------

const ALL_ASSET_TYPES: AssetType[] = ['stock', 'gold', 'bank', 'certificate', 'fund', 'real_estate', 'other'];

const ASSET_TYPE_LABELS_AR: Record<string, string> = {
  stock: 'الأسهم',
  gold: 'الذهب',
  bank: 'البنوك',
  certificate: 'شهادات الإيداع',
  fund: 'صناديق الاستثمار',
  real_estate: 'العقارات',
  other: 'أخرى',
};

export async function GET() {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      const emptySummary: PortfolioSummary = {
        total_assets: 0,
        total_liabilities: 0,
        net_worth: 0,
        assets_by_type: { stock: 0, gold: 0, bank: 0, certificate: 0, fund: 0, real_estate: 0, other: 0 },
        monthly_income: 0,
        monthly_expenses: 0,
        monthly_savings: 0,
        savings_rate: 0,
        alerts: [],
      };
      return NextResponse.json({ success: true, summary: emptySummary, generated_at: new Date().toISOString() });
    }

    const db = await getFinanceDb();

    const alerts: FinancialAlert[] = [];

    // 1. Total assets from portfolio_assets
    const assetRows = db
      .prepare('SELECT type, COALESCE(SUM(total_invested), 0) as invested, COALESCE(SUM(current_value), 0) as value FROM portfolio_assets WHERE user_id = ? GROUP BY type')
      .all(userId!) as { type: string; invested: number; value: number }[];

    const totalAssets = assetRows.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
    const totalInvested = assetRows.reduce((sum, r) => sum + (Number(r.invested) || 0), 0);

    const assetsByType = {} as Record<AssetType, number>;
    for (const at of ALL_ASSET_TYPES) {
      assetsByType[at] = 0;
    }
    for (const row of assetRows) {
      const t = (row.type as AssetType) || 'other';
      if (assetsByType[t] !== undefined) {
        assetsByType[t] = Number(row.value) || 0;
      } else {
        assetsByType.other = (assetsByType.other || 0) + (Number(row.value) || 0);
      }
    }

    // Alert: losing assets
    for (const row of assetRows) {
      const invested = Number(row.invested) || 0;
      const value = Number(row.value) || 0;
      if (invested > 0 && value < invested * 0.8) {
        const lossPercent = ((value - invested) / invested) * 100;
        const label = ASSET_TYPE_LABELS_AR[row.type] || row.type;
        alerts.push({
          type: 'danger',
          category: 'portfolio_loss',
          message: `أصول "${label}" انخفضت بنسبة ${Math.abs(lossPercent).toFixed(1)}% من قيمة الشراء`,
          value: Number(lossPercent.toFixed(1)),
          threshold: -20,
        });
      }
    }

    // 2. Total liabilities from active obligations
    const obligationRows = db
      .prepare("SELECT COALESCE(SUM(remaining_amount), 0) as total FROM financial_obligations WHERE user_id = ? AND status = 'active'")
      .all(userId!) as { total: number }[];

    const totalLiabilities = Number(obligationRows[0]?.total) || 0;

    // 3. Net worth
    const netWorth = totalAssets - totalLiabilities;

    // 4. Monthly income/expense from current month
    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');

    const monthlyIncomeRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM financial_transactions
         WHERE user_id = ? AND type = 'income'
         AND strftime('%Y', transaction_date) = ?
         AND strftime('%m', transaction_date) = ?`
      )
      .get(userId!, currentYear, currentMonth) as { total: number } | undefined;

    const monthlyExpensesRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM financial_transactions
         WHERE user_id = ? AND type = 'expense'
         AND strftime('%Y', transaction_date) = ?
         AND strftime('%m', transaction_date) = ?`
      )
      .get(userId!, currentYear, currentMonth) as { total: number } | undefined;

    const monthlyIncome = Number(monthlyIncomeRow?.total) || 0;
    const monthlyExpenses = Number(monthlyExpensesRow?.total) || 0;
    const monthlySavings = monthlyIncome - monthlyExpenses;
    const savingsRate = monthlyIncome > 0 ? (monthlySavings / monthlyIncome) * 100 : 0;

    // 5. Monthly obligations payments
    const monthlyObligationsRow = db
      .prepare(
        `SELECT COALESCE(SUM(monthly_payment), 0) as total
         FROM financial_obligations
         WHERE user_id = ? AND status = 'active'`
      )
      .all(userId!) as { total: number }[];

    const monthlyObligations = Number(monthlyObligationsRow[0]?.total) || 0;

    // Alert: negative savings rate
    if (savingsRate < 0) {
      alerts.push({
        type: 'danger',
        category: 'negative_savings',
        message: `المصروفات تتجاوز الدخل الشهري بقيمة ${Math.abs(monthlySavings).toFixed(0)} ج.م`,
        value: Number(savingsRate.toFixed(1)),
        threshold: 0,
      });
    } else if (savingsRate < 10) {
      alerts.push({
        type: 'warning',
        category: 'low_savings_rate',
        message: `نسبة الادخار ${savingsRate.toFixed(1)}% فقط — يُنصح بأن تكون 20% على الأقل`,
        value: Number(savingsRate.toFixed(1)),
        threshold: 10,
      });
    }

    // Alert: high debt-to-income ratio
    if (monthlyIncome > 0 && monthlyObligations > monthlyIncome * 0.4) {
      alerts.push({
        type: 'danger',
        category: 'high_debt_ratio',
        message: `أقساط الالتزامات الشهرية (${monthlyObligations.toFixed(0)} ج.م) تتجاوز 40% من الدخل الشهري`,
        value: Number((monthlyObligations / monthlyIncome * 100).toFixed(1)),
        threshold: 40,
      });
    }

    // Alert: negative net worth
    if (netWorth < 0) {
      alerts.push({
        type: 'danger',
        category: 'negative_net_worth',
        message: `صافي الثروة سلبي بقيمة ${netWorth.toFixed(0)} ج.م`,
        value: Number(netWorth.toFixed(2)),
        threshold: 0,
      });
    }

    // Alert: overdue obligations
    const overdueRows = db
      .prepare("SELECT id, name, next_payment_date FROM financial_obligations WHERE user_id = ? AND status = 'overdue'")
      .all(userId!) as { id: number; name: string; next_payment_date: string }[];

    for (const row of overdueRows) {
      alerts.push({
        type: 'danger',
        category: 'overdue_obligation',
        message: `التزام "${row.name}" متأخر عن السداد`,
      });
    }

    // Alert: low diversification
    const nonZeroTypes = Object.values(assetsByType).filter((v) => v > 0).length;
    if (totalAssets > 0 && nonZeroTypes <= 1) {
      alerts.push({
        type: 'warning',
        category: 'low_diversification',
        message: 'المحفظة مركزة في نوع أصل واحد فقط. يُنصح بالتنويع لتقليل المخاطر.',
        value: nonZeroTypes,
        threshold: 2,
      });
    }

    // Info alert: positive savings
    if (monthlySavings > 0 && savingsRate >= 20) {
      alerts.push({
        type: 'info',
        category: 'good_savings',
        message: `نسبة ادخار ممتازة ${savingsRate.toFixed(1)}%! استمري على هذا المستوى.`,
        value: Number(savingsRate.toFixed(1)),
      });
    }

    const summary: PortfolioSummary = {
      total_assets: Number(totalAssets.toFixed(2)),
      total_liabilities: Number(totalLiabilities.toFixed(2)),
      net_worth: Number(netWorth.toFixed(2)),
      assets_by_type: assetsByType,
      monthly_income: Number(monthlyIncome.toFixed(2)),
      monthly_expenses: Number(monthlyExpenses.toFixed(2)),
      monthly_savings: Number(monthlySavings.toFixed(2)),
      savings_rate: Number(savingsRate.toFixed(2)),
      alerts,
    };

    return NextResponse.json({
      success: true,
      summary,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/finance/reports] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error generating financial report' },
      { status: 500 }
    );
  }
}
