export const dynamic = 'force-dynamic';
/**
 * Mobile Gold API - Gold and Silver Prices
 * أسعار الذهب والفضة
 * Uses data_engine.db
 */

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getLatestGoldPrices, getLatestSilverPrices } = await import('@/lib/data-engine-db');

    const goldRows = getLatestGoldPrices();
    const silverRows = getLatestSilverPrices();

    if (!goldRows || goldRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا توجد بيانات أسعار الذهب',
        timestamp: new Date().toISOString(),
      }, { status: 404 });
    }

    // Filter Egypt gold prices
    const egyptGold = goldRows.filter((g: any) => g.country === 'مصر');
    const egyptSilver = silverRows.filter((s: any) => s.country === 'مصر');

    // Parse karat number from "عيار 24" format
    const parseKarat = (karatStr: string): string => {
      const match = karatStr.match(/\d+/);
      return match ? match[0] : karatStr;
    };

    // Build karats array
    const karats: any[] = [];
    for (const g of egyptGold) {
      const k = parseKarat(g.karat);
      if (['24', '22', '21', '18', '14', '12', '10', '8'].includes(k)) {
        karats.push({
          key: k,
          name_ar: g.karat,
          price_per_gram: g.price_per_gram,
          change: null,
          currency: g.currency || 'EGP',
        });
      }
    }

    // Get ounce price
    const ounceGold = egyptGold.find((g: any) => g.karat.toLowerCase().includes('ounce'));
    const ounce = ounceGold ? {
      price: ounceGold.price_per_ounce || ounceGold.price_per_gram,
      change: null,
      currency: ounceGold.currency || 'EGP',
      name_ar: 'أونصة ذهب',
    } : null;

    // Silver
    const silver = egyptSilver.length > 0 ? {
      price_per_gram: egyptSilver[0].price_per_gram,
      change: null,
      currency: egyptSilver[0].currency || 'EGP',
      name_ar: 'فضة',
    } : null;

    const lastUpdated = goldRows.length > 0 ? goldRows[0].timestamp : new Date().toISOString();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      last_updated: lastUpdated,
      source: 'data_engine.db',
      prices: {
        karats: karats.sort((a, b) => parseInt(b.key) - parseInt(a.key)),
        ounce,
        silver,
        silver_ounce: null,
        bullion: [],
      },
      summary: {
        gold_24k: karats.find(k => k.key === '24')?.price_per_gram || 0,
        gold_21k: karats.find(k => k.key === '21')?.price_per_gram || 0,
        gold_18k: karats.find(k => k.key === '18')?.price_per_gram || 0,
        silver: silver?.price_per_gram || 0,
      },
    });
  } catch (error: any) {
    console.error('[Mobile Gold API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error' || 'خطأ في جلب بيانات الذهب',
    }, { status: 500 });
  }
}
