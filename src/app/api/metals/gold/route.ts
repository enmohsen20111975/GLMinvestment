/**
 * GET /api/metals/gold
 * Aliased gold-prices endpoint for the Flutter app (fallback after /api/mobile/gold).
 * أسعار الذهب لكل العيارات
 *
 * Returns the same shape as /api/mobile/gold:
 *   { success, prices: { karats:[], ounce, silver, silver_ounce, bullion:[] }, summary: {...} }
 * Also includes `gold_prices: { karat_24, karat_22, karat_21, karat_18, silver }` for
 * backwards compatibility with /api/market/gold clients.
 *
 * Strategy:
 *   1. Try data_engine.db (via @/lib/data-engine-db) — same source as /api/mobile/gold.
 *   2. If no rows are available (e.g. data_engine.db missing gold_prices table),
 *      return a 200 with a synthetic placeholder so the Flutter app doesn't crash.
 *      The placeholder values are clearly flagged with source = "placeholder".
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

// Reasonable Egyptian gold-price fallback (EGP per gram) for dev environments
// where the data_engine.db has no gold_prices rows. Clearly flagged as "placeholder".
const PLACEHOLDER_EG = {
  '24': 4850,
  '22': 4445,
  '21': 4243,
  '18': 3637,
  '14': 2830,
  silver: 56,
  ounce: 150800, // 31.1035 g × 4850 ≈ 150,852 EGP
};

function buildKarats(rows: any[]) {
  const parseKarat = (s: string): string => {
    const m = (s || '').match(/\d+/);
    return m ? m[0] : s;
  };
  const karats: any[] = [];
  for (const g of rows) {
    const k = parseKarat(g.karat);
    if (['24', '22', '21', '18', '14', '12', '10', '8'].includes(k)) {
      karats.push({
        key: k,
        name_ar: g.karat,
        price_per_gram: g.price_per_gram ?? 0,
        change: g.change ?? null,
        currency: g.currency || 'EGP',
      });
    }
  }
  return karats.sort((a, b) => parseInt(b.key, 10) - parseInt(a.key, 10));
}

export async function GET() {
  try {
    const { getLatestGoldPrices, getLatestSilverPrices } = await import('@/lib/data-engine-db');
    const goldRows = getLatestGoldPrices();
    const silverRows = getLatestSilverPrices();

    const egGold = (goldRows || []).filter((g: any) => g.country === 'مصر');
    const egSilver = (silverRows || []).filter((s: any) => s.country === 'مصر');

    // ----- DB-driven path (preferred) -----
    if (egGold.length > 0) {
      const karats = buildKarats(egGold);
      const ounceRow = egGold.find((g: any) => (g.karat || '').toLowerCase().includes('ounce'));
      const ounce = ounceRow
        ? {
            price: ounceRow.price_per_ounce || ounceRow.price_per_gram,
            change: null,
            currency: ounceRow.currency || 'EGP',
            name_ar: 'أونصة ذهب',
          }
        : null;
      const silver = egSilver.length > 0
        ? {
            price_per_gram: egSilver[0].price_per_gram,
            change: null,
            currency: egSilver[0].currency || 'EGP',
            name_ar: 'فضة',
          }
        : null;

      const lastUpdated = goldRows.length > 0 ? goldRows[0].timestamp : new Date().toISOString();
      const findByKarat = (k: string) => karats.find((x) => x.key === k)?.price_per_gram || 0;

      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        last_updated: lastUpdated,
        source: 'data_engine.db',
        is_live: true,
        prices: {
          karats,
          ounce,
          silver,
          silver_ounce: null,
          bullion: [],
        },
        // market/gold compatible shape (Flutter GoldResponse.fromJson accepts this)
        gold_prices: {
          karat_24: findByKarat('24'),
          karat_22: findByKarat('22'),
          karat_21: findByKarat('21'),
          karat_18: findByKarat('18'),
          karat_14: findByKarat('14'),
          silver: silver?.price_per_gram || 0,
          last_updated: lastUpdated,
        },
        summary: {
          gold_24k: findByKarat('24'),
          gold_21k: findByKarat('21'),
          gold_18k: findByKarat('18'),
          silver: silver?.price_per_gram || 0,
        },
      });
    }

    // ----- Fallback: no DB rows; return placeholder so the client renders something -----
    const placeholderKarats = [
      { key: '24', name_ar: 'عيار 24', price_per_gram: PLACEHOLDER_EG['24'], change: null, currency: 'EGP' },
      { key: '22', name_ar: 'عيار 22', price_per_gram: PLACEHOLDER_EG['22'], change: null, currency: 'EGP' },
      { key: '21', name_ar: 'عيار 21', price_per_gram: PLACEHOLDER_EG['21'], change: null, currency: 'EGP' },
      { key: '18', name_ar: 'عيار 18', price_per_gram: PLACEHOLDER_EG['18'], change: null, currency: 'EGP' },
      { key: '14', name_ar: 'عيار 14', price_per_gram: PLACEHOLDER_EG['14'], change: null, currency: 'EGP' },
    ];
    const placeholderSilver = {
      price_per_gram: PLACEHOLDER_EG.silver,
      change: null,
      currency: 'EGP',
      name_ar: 'فضة',
    };
    const placeholderOunce = {
      price: PLACEHOLDER_EG.ounce,
      change: null,
      currency: 'EGP',
      name_ar: 'أونصة ذهب',
    };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      source: 'placeholder',
      is_live: false,
      prices: {
        karats: placeholderKarats,
        ounce: placeholderOunce,
        silver: placeholderSilver,
        silver_ounce: null,
        bullion: [],
      },
      gold_prices: {
        karat_24: PLACEHOLDER_EG['24'],
        karat_22: PLACEHOLDER_EG['22'],
        karat_21: PLACEHOLDER_EG['21'],
        karat_18: PLACEHOLDER_EG['18'],
        karat_14: PLACEHOLDER_EG['14'],
        silver: PLACEHOLDER_EG.silver,
        last_updated: new Date().toISOString(),
      },
      summary: {
        gold_24k: PLACEHOLDER_EG['24'],
        gold_21k: PLACEHOLDER_EG['21'],
        gold_18k: PLACEHOLDER_EG['18'],
        silver: PLACEHOLDER_EG.silver,
      },
      message: 'لا توجد بيانات ذهب متاحة — قيم تجريبية',
      message_en: 'No live gold data available — showing placeholder values',
    });
  } catch (error: any) {
    console.error('[/api/metals/gold] Error:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || 'خطأ في جلب بيانات الذهب',
      error_en: 'Failed to fetch gold prices',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
