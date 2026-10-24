/**
 * GET /api/finance/portfolio-analysis
 * ===================================
 * FIX: was proxying to /api/live-monitor (wrong!).
 * Now analyzes the user's portfolio: allocation, risk, performance, diversification.
 *
 * Returns: { success, analysis: { allocation, risk_level, diversification,
 *            performance, recommendations[] } }
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

    // Check table exists
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'").get() as any;
      if (!tableCheck) {
        return NextResponse.json({
          success: true,
          analysis: {
            allocation: {},
            risk_level: 'unknown',
            diversification: { score: 0, status: 'no_data' },
            performance: { total_return: 0, total_return_pct: 0 },
            recommendations: ['أضف أصولاً لمحفظتك لبدء التحليل'],
          },
          message: 'Portfolio table not initialized',
        });
      }
    } catch {
      return NextResponse.json({
        success: true,
        analysis: {
          allocation: {},
          risk_level: 'unknown',
          diversification: { score: 0, status: 'no_data' },
          performance: { total_return: 0, total_return_pct: 0 },
          recommendations: [],
        },
      });
    }

    // Fetch all assets
    const assets = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY total_invested DESC"
    ).all(userId) as any[];

    if (assets.length === 0) {
      return NextResponse.json({
        success: true,
        analysis: {
          allocation: {},
          risk_level: 'unknown',
          diversification: { score: 0, status: 'empty' },
          performance: { total_return: 0, total_return_pct: 0 },
          recommendations: ['ابدأ بإضافة أصول لمحفظتك'],
        },
      });
    }

    // Calculate totals
    let totalInvested = 0;
    let totalCurrent = 0;
    const byType: Record<string, { invested: number; current: number; count: number }> = {};

    for (const asset of assets) {
      const invested = Number(asset.total_invested || 0);
      const current = Number(asset.current_value || 0);
      totalInvested += invested;
      totalCurrent += current;
      const type = asset.type || 'other';
      if (!byType[type]) byType[type] = { invested: 0, current: 0, count: 0 };
      byType[type].invested += invested;
      byType[type].current += current;
      byType[type].count++;
    }

    // Allocation percentages
    const allocation: Record<string, number> = {};
    for (const [type, data] of Object.entries(byType)) {
      allocation[type] = totalCurrent > 0
        ? Math.round((data.current / totalCurrent) * 1000) / 10
        : 0;
    }

    // Diversification score (0-100)
    // More types = more diversified
    const typeCount = Object.keys(byType).length;
    let maxConcentration = 0;
    for (const pct of Object.values(allocation)) {
      if (pct > maxConcentration) maxConcentration = pct;
    }
    const diversificationScore = Math.round(
      Math.min(100, (typeCount * 20) + (100 - maxConcentration))
    );
    const diversificationStatus = diversificationScore >= 70 ? 'good' :
      diversificationScore >= 40 ? 'moderate' : 'poor';

    // Risk level
    let riskLevel = 'moderate';
    if (maxConcentration > 70) riskLevel = 'high';
    else if (maxConcentration < 30 && typeCount >= 3) riskLevel = 'low';

    // Performance
    const totalReturn = totalCurrent - totalInvested;
    const totalReturnPct = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

    // Recommendations
    const recommendations: string[] = [];
    if (maxConcentration > 60) {
      const dominantType = Object.entries(allocation).find(([_, pct]) => pct === maxConcentration);
      if (dominantType) {
        recommendations.push(`تركيز عالي في ${dominantType[0]} (${maxConcentration}%) — يُنصح بتوزيع الاستثمارات`);
      }
    }
    if (typeCount === 1) {
      recommendations.push('محفظتك في نوع واحد فقط — فكّر في تنويع أصولك');
    }
    if (totalReturnPct < -10) {
      recommendations.push('المحفظة في خسارة — راجع الأصول الخاسرة وفكّر في إعادة التوزيع');
    }
    if (totalReturnPct > 20) {
      recommendations.push('أداء ممتاز! فكّر في جني بعض الأرباح');
    }
    if (recommendations.length === 0) {
      recommendations.push('محفظتك متوازنة — استمر في المراقبة الدورية');
    }

    return NextResponse.json({
      success: true,
      analysis: {
        allocation,
        risk_level: riskLevel,
        diversification: {
          score: diversificationScore,
          status: diversificationStatus,
          type_count: typeCount,
          max_concentration: maxConcentration,
        },
        performance: {
          total_return: Math.round(totalReturn * 100) / 100,
          total_return_pct: Math.round(totalReturnPct * 100) / 100,
          total_invested: Math.round(totalInvested * 100) / 100,
          total_current: Math.round(totalCurrent * 100) / 100,
        },
        by_type: byType,
        recommendations,
      },
    });
  } catch (error) {
    console.error('[/api/finance/portfolio-analysis] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في تحليل المحفظة',
      analysis: null,
    }, { status: 500 });
  }
}
