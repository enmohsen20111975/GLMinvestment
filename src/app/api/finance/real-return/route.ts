import { NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';

// ---------------------------------------------------------------------------
// ROBO-ADVISOR-P3: GET /api/finance/real-return
// محرك العائد الحقيقي: Real_Return = Asset_Yield - Inflation_Rate
// لو العائد أقل من التضخم → توليد تحذير "فلوسك بتذوب"
// ---------------------------------------------------------------------------
// P30 TASK 2: Defaults — if the user enters a bank certificate/fund WITHOUT
// specifying the annual yield, we assume 20% (typical Egyptian certificate).
// If inflation is missing from macro_indicators, we assume 30% (Egypt 2024-25).
// This ensures the real return is NEVER falsely 0%.
// ---------------------------------------------------------------------------
const DEFAULT_BANK_YIELD = 20;   // 20% — typical Egyptian bank certificate
const DEFAULT_INFLATION = 30;    // 30% — Egypt inflation fallback
const REAL_RETURN_WARNING_THRESHOLD = 3; // below 3% real return → mild warning

export async function GET() {
  try {
    const db = await getFinanceDb();
    if (!db) {
      return NextResponse.json({ success: false, error: 'DB unavailable' }, { status: 503 });
    }

    // 1. جلب معدل التضخم من macro_indicators (fallback: 30% Egypt default)
    let inflationRate = DEFAULT_INFLATION;
    let inflationSource = 'default (30% Egypt fallback)';
    let inflationDate: string | null = null;
    try {
      const row = db.prepare("SELECT indicator_value, source, recorded_at FROM macro_indicators WHERE indicator_name = 'egypt_inflation' ORDER BY updated_at DESC LIMIT 1").get() as any;
      if (row && typeof row.indicator_value === 'number' && row.indicator_value > 0) {
        inflationRate = row.indicator_value;
        inflationSource = row.source || 'macro_indicators';
        inflationDate = row.recorded_at;
      }
    } catch {
      // الجدول ممكن ما يكونش اتإنشأ بعد — نستخدم الـ fallback
    }

    // 2. جلب أصول الدخل الثابت (cash_equivalent) اللي ليها annual_yield
    let assets: any[] = [];
    try {
      assets = db.prepare("SELECT id, name, type, asset_class, annual_yield, interest_rate, certificate_return_rate, total_invested, current_value, fund_name, fund_type, bank_name FROM portfolio_assets WHERE asset_class = 'cash_equivalent' OR type IN ('certificate', 'fund', 'bond', 'savings_account')").all() as any[];
    } catch {
      try {
        assets = db.prepare("SELECT id, name, type, interest_rate, certificate_return_rate, total_invested, current_value, fund_name, fund_type, bank_name FROM portfolio_assets WHERE type IN ('certificate', 'fund', 'bond', 'savings_account')").all() as any[];
      } catch { assets = []; }
    }

    // 3. حساب العائد الحقيقي لكل أصل
    // P30 TASK 2: If yield is missing for bank/fund/certificate, use DEFAULT_BANK_YIELD (20%)
    const analyses = assets.map((a: any) => {
      let yieldRate = Number(a.annual_yield || a.certificate_return_rate || a.interest_rate || 0);
      let yieldSource = 'user_input';
      const assetType = (a.type || '').toLowerCase();

      // If no yield specified AND asset is a fixed-income type → use default 20%
      if (yieldRate <= 0 && ['bank', 'certificate', 'fund', 'bond', 'savings_account', 'deposit'].includes(assetType)) {
        yieldRate = DEFAULT_BANK_YIELD;
        yieldSource = 'default (20% bank certificate)';
      }

      const realReturn = yieldRate - inflationRate;
      const invested = Number(a.total_invested || 0);
      const realLossAmount = invested > 0 ? invested * (Math.min(realReturn, 0) / 100) : 0;

      let warning: string | null = null;
      let severity: 'none' | 'mild' | 'severe' = 'none';
      if (inflationRate > 0 && realReturn < 0) {
        severity = Math.abs(realReturn) > 5 ? 'severe' : 'mild';
        warning = `أنت حاطش فلوسك في "${a.name}" بعائد ${yieldRate.toFixed(1)}% والتضخم ${inflationRate.toFixed(1)}%. فلوسك بتذوب بمعدل ${Math.abs(realReturn).toFixed(1)}% سنوياً — حوّل لأسهم أو ذهب.`;
      } else if (inflationRate > 0 && realReturn < REAL_RETURN_WARNING_THRESHOLD) {
        severity = 'mild';
        warning = `العائد الحقيقي لـ "${a.name}" منخفض (${realReturn.toFixed(1)}%). العائد بالكاد بيساوي التضخم.`;
      }

      return {
        id: a.id,
        name: a.name,
        type: a.type,
        asset_class: a.asset_class || 'cash_equivalent',
        nominal_yield: Math.round(yieldRate * 100) / 100,
        annual_yield: Math.round(yieldRate * 100) / 100,
        yield_source: yieldSource,
        inflation_rate: inflationRate,
        real_return: Math.round(realReturn * 100) / 100,
        total_invested: invested,
        real_loss_amount: Math.round(realLossAmount * 100) / 100,
        warning,
        severity,
      };
    });

    // 4. ملخص عام
    const totalInvested = analyses.reduce((s, a) => s + (a.total_invested || 0), 0);
    const weightedYield = totalInvested > 0
      ? analyses.reduce((s, a) => s + a.annual_yield * (a.total_invested || 0), 0) / totalInvested
      : 0;
    const weightedRealReturn = weightedYield - inflationRate;
    const totalRealLoss = analyses.reduce((s, a) => s + (a.real_loss_amount || 0), 0);
    const hasWarnings = analyses.some(a => a.warning);

    // P31-PORTFOLIO-SMART-MATH: monthly yield from yield assets only (bank/fund/cert).
    // Gold/real_estate/stock/crypto contribute 0 yield (they're wealth-preservation assets).
    const annualYieldEgp = totalInvested * (weightedYield / 100);
    const monthlyYieldEgp = annualYieldEgp / 12;

    return NextResponse.json({
      success: true,
      inflation: {
        rate: inflationRate,
        source: inflationSource,
        date: inflationDate,
      },
      assets: analyses,
      summary: {
        total_invested: totalInvested,
        weighted_yield: Math.round(weightedYield * 100) / 100,
        weighted_real_return: Math.round(weightedRealReturn * 100) / 100,
        total_real_loss: Math.round(totalRealLoss * 100) / 100,
        has_warnings: hasWarnings,
        warning_count: analyses.filter(a => a.warning).length,
        // P31-SMART-MATH: only yield assets (bank/fund/cert) generate this — gold/stocks don't.
        annual_yield_egp: Math.round(annualYieldEgp * 100) / 100,
        monthly_yield_egp: Math.round(monthlyYieldEgp * 100) / 100,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
