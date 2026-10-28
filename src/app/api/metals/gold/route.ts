import { NextResponse } from 'next/server';
import { openDb } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

interface MetalPriceRow {
  timestamp: string;
  country: string | null;
  currency: string | null;
  karat: string | null;
  price_per_gram: number | null;
  price_per_ounce: number | null;
}

interface ExchangeRateRow {
  currency: string;
  rate_to_usd: number;
  timestamp: string;
}

interface KaratPrice {
  key: string;
  name_ar: string;
  price_per_gram: number | null;
  price_per_ounce: number | null;
  country: string | null;
  currency: string | null;
}

interface MetalUnitPrice {
  key: string;
  name_ar: string;
  price_per_gram: number | null;
  price_per_ounce: number | null;
  country: string | null;
}

interface OuncePrice {
  price: number;
  name_ar: string;
  currency: string;
}

/**
 * GET /api/metals/gold
 *
 * يجلب كل أسعار المعادن من data_engine.db.gold_prices
 * - الذهب: عيار 24, 22, 21, 18, 14, 12, 10 + جنيه ذهب + أونصة
 * - الفضة: 999, 925, 900, 800, 600 + جنيه فضة + أونصة فضة
 * - كل المعادن من كل الدول المتاحة
 *
 * مصدر البيانات: Daleelak API (مصادر مصرية مرخصة) + metals_forex_fetcher
 */
export async function GET() {
  try {
    const db = openDb('data_engine.db');
    if (!db) {
      return NextResponse.json({ success: false, error: 'data_engine.db unavailable' }, { status: 200 });
    }
    db.pragma('busy_timeout = 5000');

    // جلب كل أسعار الذهب + الفضة من آخر تحديث
    const allMetals = db.prepare(`
      SELECT timestamp, country, currency, karat, price_per_gram, price_per_ounce
      FROM gold_prices
      WHERE timestamp = (SELECT MAX(timestamp) FROM gold_prices)
      ORDER BY karat
    `).all() as MetalPriceRow[];

    // جلب كل العملات من آخر تحديث
    const allRates = db.prepare(`
      SELECT currency, rate_to_usd, timestamp
      FROM exchange_rates
      WHERE timestamp = (SELECT MAX(timestamp) FROM exchange_rates)
      ORDER BY currency
    `).all() as ExchangeRateRow[];

    db.close();

    // تنظيم المعادن
    const goldKarats: KaratPrice[] = [];
    const silverKarats: KaratPrice[] = [];
    let goldPound: MetalUnitPrice | null = null;
    let silverPound: MetalUnitPrice | null = null;
    let goldOunce: OuncePrice | null = null;
    let silverOunce: OuncePrice | null = null;

    for (const m of allMetals) {
      const karat = (m.karat || '').toLowerCase();
      const priceGram = m.price_per_gram;
      const priceOz = m.price_per_ounce;

      if (karat.includes('gold-') || karat.includes('عيار') && !karat.includes('silver')) {
        // Gold
        const num = (m.karat || '').match(/\d+/);
        const key = num ? num[0] : (m.karat || '');
        if (karat.includes('pound') || karat.includes('جنيه')) {
          goldPound = { key: 'gold-pound', name_ar: 'جنيه ذهب', price_per_gram: priceGram, price_per_ounce: priceOz, country: m.country };
        } else {
          goldKarats.push({
            key,
            name_ar: `عيار ${key}`,
            price_per_gram: priceGram,
            price_per_ounce: priceOz,
            country: m.country,
            currency: m.currency || 'EGP',
          });
        }
      } else if (karat.includes('silver') || karat.includes('فضة')) {
        // Silver
        const num = (m.karat || '').match(/\d+/);
        const key = num ? num[0] : (m.karat || '');
        if (karat.includes('pound') || karat.includes('جنيه')) {
          silverPound = { key: 'silver-pound', name_ar: 'جنيه فضة', price_per_gram: priceGram, price_per_ounce: priceOz, country: m.country };
        } else {
          silverKarats.push({
            key,
            name_ar: `فضة ${key}`,
            price_per_gram: priceGram,
            price_per_ounce: priceOz,
            country: m.country,
            currency: m.currency || 'EGP',
          });
        }
      }
    }

    // Sort gold by karat descending
    goldKarats.sort((a, b) => parseInt(b.key) - parseInt(a.key));
    silverKarats.sort((a, b) => parseInt(b.key) - parseInt(a.key));

    // الذهب: أونصة (استخدم gold-24k price_per_ounce لو موجودة)
    const gold24 = allMetals.find(m => (m.karat || '').toLowerCase() === 'gold-24k');
    if (gold24 && gold24.price_per_ounce) {
      goldOunce = { price: gold24.price_per_ounce, name_ar: 'أونصة ذهب', currency: 'EGP' };
    }

    // الفضة: أونصة (استخدم silver-999 price_per_ounce لو موجودة)
    const silver999 = allMetals.find(m => (m.karat || '').toLowerCase() === 'silver-999');
    if (silver999 && silver999.price_per_ounce) {
      silverOunce = { price: silver999.price_per_ounce, name_ar: 'أونصة فضة', currency: 'EGP' };
    }

    // العملات: تنظيم
    const currencies = allRates.map(r => ({
      code: r.currency,
      rate_to_usd: r.rate_to_usd,
      rate_to_egp: r.rate_to_usd > 0 ? Math.round((1 / r.rate_to_usd) * 100) / 100 : 0,
    }));

    // أسماء العملات بالعربي
    const CURRENCY_NAMES: Record<string, string> = {
      USD: 'دولار أمريكي', EUR: 'يورو', GBP: 'جنيه إسترليني', JPY: 'ين ياباني',
      SAR: 'ريال سعودي', AED: 'درهم إماراتي', KWD: 'دينار كويتي', BHD: 'دينار بحريني',
      OMR: 'ريال عماني', QAR: 'ريال قطري', JOD: 'دينار أردني', EGP: 'جنيه مصري',
      CNY: 'يوان صيني', AUD: 'دولار أسترالي', CAD: 'دولار كندي', CHF: 'فرنك سويسري',
      DZD: 'دينار جزائري', IQD: 'دينار عراقي', LBP: 'ليرة لبنانية', MAD: 'درهم مغربي',
      SDG: 'جنيه سوداني', TND: 'دينار تونسي', NOK: 'كرونة نرويجية', SEK: 'كرونة سويدية',
      DKK: 'كرونة دنماركية',
    };

    const currenciesNamed = currencies.map(c => ({
      ...c,
      name_ar: CURRENCY_NAMES[c.code] || c.code,
    }));

    const lastUpdated = allMetals.length > 0 ? allMetals[0].timestamp : new Date().toISOString();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      last_updated: lastUpdated,
      source: 'data_engine.db',
      is_live: true,
      prices: {
        gold_karats: goldKarats,
        gold_pound: goldPound,
        gold_ounce: goldOunce,
        silver_karats: silverKarats,
        silver_pound: silverPound,
        silver_ounce: silverOunce,
      },
      currencies: currenciesNamed,
      // Backwards compatibility
      gold_prices: {
        karat_24: goldKarats.find(k => k.key === '24')?.price_per_ounce || 0,
        karat_22: goldKarats.find(k => k.key === '22')?.price_per_ounce || 0,
        karat_21: goldKarats.find(k => k.key === '21')?.price_per_ounce || 0,
        karat_18: goldKarats.find(k => k.key === '18')?.price_per_ounce || 0,
        karat_14: goldKarats.find(k => k.key === '14')?.price_per_ounce || 0,
        silver: silver999?.price_per_ounce || 0,
        last_updated: lastUpdated,
      },
      summary: {
        gold_24k: goldKarats.find(k => k.key === '24')?.price_per_ounce || 0,
        gold_21k: goldKarats.find(k => k.key === '21')?.price_per_ounce || 0,
        gold_18k: goldKarats.find(k => k.key === '18')?.price_per_ounce || 0,
        gold_pound: goldPound?.price_per_ounce || 0,
        silver_999: silver999?.price_per_ounce || 0,
        silver_pound: silverPound?.price_per_ounce || 0,
        total_gold_karats: goldKarats.length,
        total_silver_karats: silverKarats.length,
        total_currencies: currencies.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[/api/metals/gold] Error:', message);
    return NextResponse.json({
      success: false,
      error: message || 'خطأ في جلب بيانات المعادن',
    }, { status: 500 });
  }
}
