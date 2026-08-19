/**
 * GET /api/devil/card/[ticker]
 * ============================
 * 😈 كارت الشيطان — رأي الخبير المخضرم على سهم معين
 *
 * بيجمع الـ 5 محركات:
 * 1. Divergence (التناقض)
 * 2. Chain Reaction (السلسلة)
 * 3. Pre-Event (اللعب قبل الحدث)
 * 4. Contrarian (العكسية)
 * 5. Regime + Seasonality (السياق)
 *
 * + القواعد الذهبية المفعّلة
 * + درجة الشيطان الإجمالية
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildDevilCard } from '@/lib/devil/devil-orchestrator';
import { getStockBySymbol, getHistoricalData, getMarketStats } from '@/lib/data-engine-db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: tickerRaw } = await params;
  const ticker = tickerRaw.toUpperCase();

  try {
    // نجيب بيانات السهم
    const stock = getStockBySymbol(ticker);
    const history = getHistoricalData(ticker, 252);

    // بيانات السوق
    const stats = getMarketStats('EGX');
    const egx30Change = (stats as any)?.egx30Change || 0;

    // السعر الحالي والتغير
    const currentPrice = stock ? Number((stock as any).close || (stock as any).price || 0) : 0;
    const currentChange = stock ? Number((stock as any).change_percent || (stock as any).changePercent || 0) : 0;
    const currentVolume = stock ? Number((stock as any).volume || 0) : 0;

    // متوسط السيولة (من آخر 20 يوم)
    const recentVolumes = history.slice(-20).map(h => Number(h.volume || 0));
    const avgVolume = recentVolumes.length > 0
      ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length
      : currentVolume || 1;

    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // الأسعار التاريخية لحساب percentile
    const historicalPrices = history.map(h => Number(h.close || 0)).filter(p => p > 0);

    // الاسم العربي
    const nameAr = stock ? ((stock as any).name_ar || (stock as any).nameAr || (stock as any).name) : undefined;

    // نبني الكارت
    const card = await buildDevilCard({
      ticker,
      nameAr,
      price: currentPrice,
      currentChange,
      volumeRatio,
      historicalPrices,
      currentVolume,
      averageVolume: avgVolume,
      egx30Change30d: egx30Change,
      egx30Change5d: egx30Change,
      egx30ChangeToday: egx30Change,
    });

    return NextResponse.json({
      success: true,
      ...card,
    });
  } catch (error) {
    console.error(`[devil/card] Error for ${ticker}:`, error);
    return NextResponse.json(
      { success: false, ticker, error: 'فشل في بناء كارت الشيطان' },
      { status: 500 }
    );
  }
}
