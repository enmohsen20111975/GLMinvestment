import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

const ArabicCurrencyNames: Record<string, string> = {
  'USD': 'دولار أمريكي',
  'EUR': 'يورو',
  'SAR': 'ريال سعودي',
  'AED': 'درهم إماراتي',
  'KWD': 'دينار كويتي',
  'QAR': 'ريال قطري',
  'BHD': 'دينار بحريني',
  'OMR': 'ريال عماني',
  'EGP': 'جنيه مصري',
  'GBP': 'جنيه إسترليني',
  'JOD': 'دينار أردني',
  'LBP': 'جنيه لبناني',
  'MAD': 'درهم مغربي',
  'DZD': 'دينار جزائري',
  'SDG': 'جنيه سوداني',
  'TND': 'دينار تونسي',
  'IQD': 'دينار عراقي',
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action') || 'list';

  // 1. Try Python backend
  try {
    const response = await fetch(`${PYTHON_API_URL}/api/currency/${action}`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch (e) {
    console.warn('[/api/currency] Python backend error:', e);
  }

  // 2. Fallback: data_engine.db exchange_rates
  try {
    const { getDataEngineDb, getLatestExchangeRates } = await import('@/lib/data-engine-db');
    const rates = getLatestExchangeRates();

    const egpRow = rates.find((r: any) => r.currency === 'EGP');
    const egpRate = egpRow?.rate_to_usd || 51.82;

    const mappedRates = rates.map((row: any) => {
      const curr = row.currency;
      let rateToEgp = 0;
      if (curr === 'USD') {
        rateToEgp = egpRate;
      } else if (curr === 'EGP') {
        rateToEgp = 1.0;
      } else {
        const rateToUsd = row.rate_to_usd || 1;
        rateToEgp = egpRate / rateToUsd;
      }

      const buy = Math.round(rateToEgp * 100) / 100;
      const sell = Math.round(rateToEgp * 1.002 * 100) / 100;

      return {
        id: row.id,
        code: curr,
        currency: curr,
        name_ar: ArabicCurrencyNames[curr] || curr,
        buy_rate: buy,
        sell_rate: sell,
        buy: buy,
        sell: sell,
        rate_to_egp: buy,
        rate_to_usd: row.rate_to_usd,
        change: 0.0,
        is_major: ['USD', 'EUR', 'SAR', 'AED', 'KWD'].includes(curr),
        last_updated: row.timestamp || new Date().toISOString(),
      };
    });

    return NextResponse.json({
      success: true,
      rates: mappedRates,
      data: mappedRates,
      currencies: mappedRates,
      count: mappedRates.length,
      source: 'data_engine',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[/api/currency] data_engine fallback error:', e);
  }

  // 3. Final fallback
  return NextResponse.json({
    success: true,
    rates: [],
    data: [],
    currencies: [],
    count: 0,
    source: 'empty',
    note: 'بيانات العملات غير متاحة حالياً',
  });
}

