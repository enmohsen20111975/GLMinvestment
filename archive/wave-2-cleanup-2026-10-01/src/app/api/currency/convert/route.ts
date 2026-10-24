import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

// Fallback exchange rates (approximate)
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 154.5,
  CNY: 7.24,
  INR: 83.5,
  AUD: 1.53,
  CAD: 1.36,
  CHF: 0.88,
  KRW: 1365,
  SGD: 1.34,
  HKD: 7.82,
  NOK: 10.8,
  SEK: 10.5,
  DKK: 6.88,
  NZD: 1.64,
  ZAR: 18.5,
  RUB: 92,
  TRY: 32.5,
  BRL: 5.05,
  MXN: 17.2,
  THB: 36.5,
  IDR: 16200,
  MYR: 4.72,
  PHP: 57.5,
  VND: 25400,
  PLN: 3.95,
  SAR: 3.75,
  AED: 3.67,
  KWD: 0.31,
  QAR: 3.64,
  BHD: 0.376,
  OMR: 0.385,
  EGP: 47.5,
  ILS: 3.68,
  PKR: 278,
  BDT: 110,
  NGN: 1550,
  KES: 153,
  GHS: 13.2,
  ETB: 57,
  TZS: 2520,
  UGX: 3850,
  MAD: 10.0,
  TND: 3.12,
  DZD: 134,
  LYD: 4.85,
  SDG: 450,
  JOD: 0.709,
  LBP: 89500,
  SYP: 13000,
  IQD: 1310,
  YER: 250,
  AFN: 72,
  IRR: 42000,
  ARS: 880,
  CLP: 920,
  COP: 3950,
  PEN: 3.72,
  CZK: 22.8,
  HUF: 360,
  RON: 4.58,
  BGN: 1.80,
  HRK: 6.95,
  UAH: 39.5
};

// Currency names
const CURRENCY_NAMES: Record<string, { name: string; name_ar: string }> = {
  USD: { name: "US Dollar", name_ar: "دولار أمريكي" },
  EUR: { name: "Euro", name_ar: "يورو" },
  GBP: { name: "British Pound", name_ar: "جنيه إسترليني" },
  JPY: { name: "Japanese Yen", name_ar: "ين ياباني" },
  CNY: { name: "Chinese Yuan", name_ar: "يوان صيني" },
  INR: { name: "Indian Rupee", name_ar: "روبية هندية" },
  AUD: { name: "Australian Dollar", name_ar: "دولار أسترالي" },
  CAD: { name: "Canadian Dollar", name_ar: "دولار كندي" },
  CHF: { name: "Swiss Franc", name_ar: "فرنك سويسري" },
  EGP: { name: "Egyptian Pound", name_ar: "جنيه مصري" },
  SAR: { name: "Saudi Riyal", name_ar: "ريال سعودي" },
  AED: { name: "UAE Dirham", name_ar: "درهم إماراتي" },
  KWD: { name: "Kuwaiti Dinar", name_ar: "دينار كويتي" },
  QAR: { name: "Qatari Riyal", name_ar: "ريال قطري" },
  BHD: { name: "Bahraini Dinar", name_ar: "دينار بحريني" },
  OMR: { name: "Omani Rial", name_ar: "ريال عماني" },
  JOD: { name: "Jordanian Dinar", name_ar: "دينار أردني" },
  TRY: { name: "Turkish Lira", name_ar: "ليرة تركية" },
};

function buildConversionResponse(amount: number, fromCurrency: string, toCurrency: string) {
  // Fallback calculation
  const fromRate = FALLBACK_RATES[fromCurrency] || 1;
  const toRate = FALLBACK_RATES[toCurrency] || 1;

  if (!FALLBACK_RATES[fromCurrency]) {
    return NextResponse.json({
      success: false,
      error: `Currency ${fromCurrency} not supported`
    }, { status: 400 });
  }

  if (!FALLBACK_RATES[toCurrency]) {
    return NextResponse.json({
      success: false,
      error: `Currency ${toCurrency} not supported`
    }, { status: 400 });
  }

  // Convert to USD first, then to target currency
  const amountInUSD = amount / fromRate;
  const result = amountInUSD * toRate;
  const rate = toRate / fromRate;

  const fromInfo = CURRENCY_NAMES[fromCurrency] || { name: fromCurrency, name_ar: fromCurrency };
  const toInfo = CURRENCY_NAMES[toCurrency] || { name: toCurrency, name_ar: toCurrency };

  return NextResponse.json({
    success: true,
    amount,
    from_currency: fromCurrency,
    from_name: fromInfo.name,
    from_name_ar: fromInfo.name_ar,
    to_currency: toCurrency,
    to_name: toInfo.name,
    to_name_ar: toInfo.name_ar,
    result: Math.round(result * 100) / 100,
    rate: Math.round(rate * 10000) / 10000,
    timestamp: new Date().toISOString(),
    source: 'fallback'
  });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const amount = parseFloat(searchParams.get('amount') || '1');
  const fromCurrency = searchParams.get('from_currency')?.toUpperCase() || 'USD';
  const toCurrency = searchParams.get('to_currency')?.toUpperCase() || 'EGP';

  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({
      success: false,
      error: 'Invalid amount'
    }, { status: 400 });
  }

  try {
    // Try Python backend first
    const url = `${PYTHON_API_URL}/api/currency/convert?amount=${amount}&from_currency=${fromCurrency}&to_currency=${toCurrency}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return NextResponse.json(data);
      }
    }
  } catch (error) {
    console.log('[Currency Convert] Backend unavailable, using fallback rates');
  }

  return buildConversionResponse(amount, fromCurrency, toCurrency);
}

/**
 * POST /api/currency/convert
 * Accepts the same params in the JSON body (or query string).
 */
export async function POST(request: NextRequest) {
  let amount = 1;
  let fromCurrency = 'USD';
  let toCurrency = 'EGP';

  try {
    const body = await request.json().catch(() => ({}));
    amount = parseFloat(String(body.amount ?? request.nextUrl.searchParams.get('amount') ?? '1'));
    fromCurrency = String(body.from_currency ?? request.nextUrl.searchParams.get('from_currency') ?? 'USD').toUpperCase();
    toCurrency = String(body.to_currency ?? request.nextUrl.searchParams.get('to_currency') ?? 'EGP').toUpperCase();
  } catch {
    // fall back to query string only
    const sp = request.nextUrl.searchParams;
    amount = parseFloat(sp.get('amount') || '1');
    fromCurrency = (sp.get('from_currency') || 'USD').toUpperCase();
    toCurrency = (sp.get('to_currency') || 'EGP').toUpperCase();
  }

  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid amount' }, { status: 400 });
  }

  return buildConversionResponse(amount, fromCurrency, toCurrency);
}
