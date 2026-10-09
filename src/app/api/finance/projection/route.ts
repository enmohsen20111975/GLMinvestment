/**
 * GET /api/finance/projection
 * ============================
 * P33 TASK 3: Future Wealth Projection (Robo-Advisor feature).
 *
 * Projects the user's net worth forward N years using either:
 *   - Simple interest:   future = current + (annual_yield * years) - (monthly_expenses * 12 * years)
 *   - Compound interest: year-by-year simulation where each year the yield is
 *                        reinvested (value *= (1 + rate)) then expenses are deducted.
 *
 * The annual yield rate is derived from the yield assets (bank/certificate/fund)
 * only — wealth assets (gold/stock/crypto) have 0% yield (they appreciate via
 * market price, not via interest). This matches the P31 smart_math separation.
 *
 * Query params:
 *   years     — number of years to project (1-40, default 5)
 *   compound  — "true" to reinvest yield (compound), "false" for simple (default true)
 *
 * Returns: { success, current_value, annual_yield_egp, annual_yield_rate,
 *           monthly_expenses, projection: [{year, value, yield, expenses, net}],
 *           final_value, total_yield, total_expenses, compound }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

const DEFAULT_BANK_YIELD_PCT = 20; // fallback for bank/cert/fund without explicit rate

const WEALTH_ASSET_TYPES = new Set([
  'gold', 'silver', 'real_estate', 'car', 'stock', 'crypto', 'currency', 'forex', 'other',
]);
const YIELD_ASSET_TYPES = new Set([
  'bank', 'certificate', 'fund', 'bond', 'savings_account', 'deposit',
]);

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const db = await getFinanceDb();
    const { searchParams } = new URL(request.url);
    const yearsRaw = parseInt(searchParams.get('years') || '5', 10);
    const years = Math.min(Math.max(yearsRaw || 5, 1), 40);
    const compound = searchParams.get('compound') !== 'false'; // default true

    // Load all portfolio assets
    const assets = db.prepare(
      `SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY id ASC`
    ).all(userId) as any[];

    let totalCurrentValue = 0;
    let totalInvested = 0;
    let yieldPrincipal = 0;
    let annualYieldEgp = 0;

    for (const a of assets) {
      const type = String(a.type || 'other').toLowerCase();
      const invested = Number(a.total_invested || a.avg_buy_price || 0) * (Number(a.quantity || 1) || 1);
      const current = Number(a.current_value || 0) || invested;
      totalCurrentValue += current;
      totalInvested += invested;

      if (YIELD_ASSET_TYPES.has(type)) {
        yieldPrincipal += invested;
        let rate = Number(
          a.interest_rate || a.certificate_return_rate || a.annual_return_rate ||
          a.return_rate || a.annual_yield || 0
        );
        if (rate <= 0) rate = DEFAULT_BANK_YIELD_PCT;
        annualYieldEgp += invested * (rate / 100);
      }
    }

    // Monthly expenses (from user_financial_settings, default 0)
    let monthlyExpenses = 0;
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS user_financial_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL UNIQUE,
          monthly_expenses REAL DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `).run();
      const row = db.prepare(
        "SELECT monthly_expenses FROM user_financial_settings WHERE user_id = ? LIMIT 1"
      ).get(userId) as any;
      monthlyExpenses = Number(row?.monthly_expenses || 0);
    } catch { // silent fallback (safe-by-design)
      monthlyExpenses = 0;
    }

    const annualExpenses = monthlyExpenses * 12;
    // Effective annual return rate based on CURRENT value (not just yield principal)
    // so the compound simulation reflects growth of the whole portfolio via yield.
    const annualYieldRate = totalCurrentValue > 0
      ? annualYieldEgp / totalCurrentValue
      : 0;

    // ── Year-by-year projection ──
    const projection: Array<{
      year: number;
      value: number;
      yield_egp: number;
      expenses_egp: number;
      net_change_egp: number;
    }> = [];

    let value = totalCurrentValue;
    let totalYield = 0;
    let totalExpenses = 0;

    for (let y = 1; y <= years; y++) {
      let yearYield: number;
      if (compound) {
        // Compound: this year's yield = current value * annual rate
        yearYield = value * annualYieldRate;
        value = value + yearYield - annualExpenses;
      } else {
        // Simple: yield is always based on the original principal
        yearYield = annualYieldEgp;
        value = value + yearYield - annualExpenses;
      }
      totalYield += yearYield;
      totalExpenses += annualExpenses;
      projection.push({
        year: y,
        value: Math.round(value * 100) / 100,
        yield_egp: Math.round(yearYield * 100) / 100,
        expenses_egp: Math.round(annualExpenses * 100) / 100,
        net_change_egp: Math.round((yearYield - annualExpenses) * 100) / 100,
      });
    }

    const finalValue = Math.round(value * 100) / 100;
    const growthPct = totalCurrentValue > 0
      ? Math.round(((finalValue - totalCurrentValue) / totalCurrentValue) * 10000) / 100
      : 0;

    return NextResponse.json({
      success: true,
      years,
      compound,
      current_value: Math.round(totalCurrentValue * 100) / 100,
      total_invested: Math.round(totalInvested * 100) / 100,
      annual_yield_egp: Math.round(annualYieldEgp * 100) / 100,
      annual_yield_rate: Math.round(annualYieldRate * 10000) / 100, // as %
      monthly_expenses_egp: Math.round(monthlyExpenses * 100) / 100,
      annual_expenses_egp: Math.round(annualExpenses * 100) / 100,
      projection,
      final_value: finalValue,
      growth_pct: growthPct,
      total_yield_egp: Math.round(totalYield * 100) / 100,
      total_expenses_egp: Math.round(totalExpenses * 100) / 100,
      wealth_assets_value: Math.round(
        assets
          .filter((a) => WEALTH_ASSET_TYPES.has(String(a.type || 'other').toLowerCase()))
          .reduce((s, a) => s + (Number(a.current_value || 0) || 0), 0) * 100
      ) / 100,
      yield_assets_value: Math.round(yieldPrincipal * 100) / 100,
    });
  } catch (error) {
    console.error('[/api/finance/projection] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في حساب التوقع المستقبلي للثروة' },
      { status: 500 }
    );
  }
}
