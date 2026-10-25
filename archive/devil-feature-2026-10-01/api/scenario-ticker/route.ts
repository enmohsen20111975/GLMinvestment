/**
 * GET /api/devil/scenario/[ticker]
 * =================================
 * 😈 مصفوفة السيناريوهات — 3 سيناريوهات لكل سهم
 *
 * بيرجع:
 * - scenarios (3: ذهبي، عرضي، أسود)
 * - bestCase, baseCase, worstCase
 * - devilVerdict
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { buildScenarioMatrix } from '@/lib/devil/scenario-matrix';
import { getStockBySymbol, getHistoricalData, getMarketStats } from '@/lib/data-engine-db';
import { detectMarketRegime } from '@/lib/devil/regime-engine';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: tickerRaw } = await params;
  const ticker = tickerRaw.toUpperCase();

  try {
    const stock = getStockBySymbol(ticker);
    const history = getHistoricalData(ticker, 60);

    // حساب beta تقريبي من التاريخ
    let beta = 1.0;
    if (history.length > 10) {
      const changes = history.slice(-20).map((h, i) => {
        if (i === 0) return 0;
        const prev = history[history.length - 21 + i - 1] || h;
        const prevClose = Number(prev.close || 0);
        const currClose = Number(h.close || 0);
        return prevClose > 0 ? ((currClose - prevClose) / prevClose) * 100 : 0;
      }).filter(c => !isNaN(c));
      const avgChange = changes.reduce((a, b) => a + b, 0) / Math.max(changes.length, 1);
      beta = Math.max(0.5, Math.min(2.5, 1 + Math.abs(avgChange) * 0.3));
    }

    // وضع السوق
    const stats = getMarketStats('EGX');
    const egx30Change = (stats as any)?.egx30Change || 0;
    const regime = detectMarketRegime(egx30Change, egx30Change);

    const nameAr = stock ? ((stock as any).name_ar || (stock as any).nameAr || (stock as any).name) : undefined;

    const matrix = buildScenarioMatrix({
      ticker,
      nameAr,
      beta: parseFloat(beta.toFixed(2)),
      marketRegime: regime,
    });

    return NextResponse.json({
      success: true,
      ...matrix,
    });
  } catch (error) {
    console.error(`[devil/scenario] Error for ${ticker}:`, error);
    return NextResponse.json(
      { success: false, ticker, error: 'فشل في بناء مصفوفة السيناريوهات' },
      { status: 500 }
    );
  }
}
