import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

/**
 * GET /api/market/gold
 * يجلب أسعار الذهب من data_engine.db
 * (compatibility endpoint - نفس /api/mobile/gold)
 */
export async function GET(request: NextRequest) {
  try {
    const { getLatestGoldPrices, getLatestSilverPrices } = await import('@/lib/data-engine-db');

    const gold = getLatestGoldPrices();
    const silver = getLatestSilverPrices();

    // فلتر الذهب المصري
    const egGold = gold.filter((g: any) => g.country === 'مصر');
    const egSilver = silver.filter((s: any) => s.country === 'مصر');

    let goldPrices: any = null;
    if (egGold.length > 0) {
      goldPrices = {
        karat_24: egGold.find((g: any) => g.karat.includes('24'))?.price_per_gram || egGold[0]?.price_per_gram || 0,
        karat_22: egGold.find((g: any) => g.karat.includes('22'))?.price_per_gram || 0,
        karat_21: egGold.find((g: any) => g.karat.includes('21'))?.price_per_gram || 0,
        karat_18: egGold.find((g: any) => g.karat.includes('18'))?.price_per_gram || 0,
        silver: egSilver[0]?.price_per_gram || 0,
        last_updated: egGold[0]?.timestamp || new Date().toISOString(),
      };
    }

    // كل الدول (للمعلومات الإضافية)
    const allCountries: Record<string, any> = {};
    for (const g of gold) {
      if (!allCountries[g.country]) {
        allCountries[g.country] = {};
      }
      allCountries[g.country][g.karat] = g.price_per_gram;
    }

    return NextResponse.json({
      success: true,
      gold_prices: goldPrices,
      all_countries: allCountries,
      source: 'data_engine',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/market/gold] Error:', e);
    return NextResponse.json({
      success: false,
      error: 'فشل في جلب أسعار الذهب',
      gold_prices: null,
    }, { status: 500 });
  }
}
