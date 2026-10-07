/**
 * POST /api/zakat/calculate
 * Islamic zakat calculator — 2.5% of qualifying wealth above nisab.
 * حاسبة الزكاة — 2.5% من المال النامي فوق النصاب.
 *
 * Flutter app (lib/api/client.dart:567) POSTs:
 *   { cash, gold_silver, stocks, receivables, other_assets, debts }
 * The ZakatCalculation model (lib/models/zakat.dart) expects in the response:
 *   cash, gold_silver, stocks, receivables, other_assets, debts
 *   total_assets, net_zakatable, nisab, zakat_due, zakat_rate
 *
 * This endpoint returns both the Flutter-expected shape AND the task-spec shape
 *   { success, zakat_amount, total_wealth, nisab, is_above_nisab, breakdown }
 * so all clients can consume it.
 *
 * Nisab: 85g of gold (per the Hanafi / majority view used in /components/zakat/ZakatView).
 * The gold_24k price is fetched from data_engine.db when available; otherwise
 * a sensible EGP placeholder (4850/g) is used and flagged in the response.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ZAKAT_RATE = 0.025; // 2.5% — ربع العشر
const NISAB_GOLD_GRAMS = 85;
const NISAB_SILVER_GRAMS = 595;
const PLACEHOLDER_GOLD_24K = 4850; // EGP per gram — fallback when no live data
const PLACEHOLDER_SILVER = 56; // EGP per gram

function num(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

async function fetchGold24Price(): Promise<{ price: number; source: string }> {
  try {
    const { getLatestGoldPrices } = await import('@/lib/data-engine-db');
    const rows = getLatestGoldPrices();
    const eg = (rows || []).find(
      (g: any) => g.country === 'مصر' && (g.karat || '').includes('24')
    );
    if (eg && eg.price_per_gram) {
      return { price: eg.price_per_gram, source: 'data_engine.db' };
    }
  } catch {
    /* ignore */
  }
  return { price: PLACEHOLDER_GOLD_24K, source: 'placeholder' };
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // Accept the Flutter app's field names, with sensible aliases for callers
    // that use the task-spec field names (cash, gold, silver, stocks,
    // realestate, investments, ...).
    const cash = num(body.cash);
    const goldSilver =
      num(body.gold_silver) + num(body.gold) + num(body.silver);
    const stocks =
      num(body.stocks) + num(body.investments);
    const receivables = num(body.receivables);
    const otherAssets =
      num(body.other_assets) + num(body.realestate) + num(body.real_estate);
    const debts = num(body.debts);

    const totalAssets = cash + goldSilver + stocks + receivables + otherAssets;
    const netZakatable = Math.max(0, totalAssets - debts);

    const { price: gold24Price, source: goldSource } = await fetchGold24Price();
    const nisab = NISAB_GOLD_GRAMS * gold24Price; // 85g × gold_24k price
    const silverNisab = NISAB_SILVER_GRAMS * PLACEHOLDER_SILVER;
    const isAboveNisab = netZakatable >= nisab;
    const zakatDue = isAboveNisab ? netZakatable * ZAKAT_RATE : 0;

    const breakdown = [
      { key: 'cash', label_ar: 'النقود والمدخرات', amount: cash },
      { key: 'gold_silver', label_ar: 'الذهب والفضة', amount: goldSilver },
      { key: 'stocks', label_ar: 'الأسهم والاستثمارات', amount: stocks },
      { key: 'receivables', label_ar: 'المستحقات', amount: receivables },
      { key: 'other_assets', label_ar: 'أصول أخرى', amount: otherAssets },
      { key: 'debts', label_ar: 'الديون (تُخصم)', amount: -debts },
    ];

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),

      // ----- Flutter ZakatCalculation shape (lib/models/zakat.dart) -----
      cash,
      gold_silver: goldSilver,
      stocks,
      receivables,
      other_assets: otherAssets,
      debts,
      total_assets: totalAssets,
      net_zakatable: netZakatable,
      nisab,
      zakat_due: zakatDue,
      zakat_rate: ZAKAT_RATE,

      // ----- Task-spec shape (mirror for clarity) -----
      zakat_amount: zakatDue,
      total_wealth: totalAssets,
      is_above_nisab: isAboveNisab,
      breakdown: {
        cash,
        gold_silver: goldSilver,
        stocks,
        receivables,
        other_assets: otherAssets,
        debts,
        total_assets: totalAssets,
        net_zakatable: netZakatable,
        items: breakdown,
      },

      // ----- Nisab details -----
      nisab_details: {
        gold_grams: NISAB_GOLD_GRAMS,
        gold_24k_price: gold24Price,
        gold_nisab: nisab,
        silver_grams: NISAB_SILVER_GRAMS,
        silver_price: PLACEHOLDER_SILVER,
        silver_nisab: silverNisab,
        source: goldSource,
      },

      message: isAboveNisab
        ? 'تجب الزكاة في مالك'
        : 'لا تجب الزكاة — المال دون النصاب',
      message_en: isAboveNisab
        ? 'Zakat is due on your wealth'
        : 'Zakat not due — wealth below nisab',
    });
  } catch (error: any) {
    console.error('[/api/zakat/calculate] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'خطأ في حساب الزكاة',
        error_en: 'Failed to calculate zakat',
        zakat_due: 0,
        zakat_amount: 0,
      },
      { status: 500 }
    );
  }
}

// Optional GET — returns nisab info so clients can show the threshold.
export async function GET() {
  try {
    const { price: gold24Price, source } = await fetchGold24Price();
    return NextResponse.json({
      success: true,
      nisab: NISAB_GOLD_GRAMS * gold24Price,
      nisab_grams: NISAB_GOLD_GRAMS,
      gold_24k_price: gold24Price,
      zakat_rate: ZAKAT_RATE,
      source,
      message: 'أرسل POST مع {cash, gold_silver, stocks, receivables, other_assets, debts}',
      message_en: 'POST with {cash, gold_silver, stocks, receivables, other_assets, debts}',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}
