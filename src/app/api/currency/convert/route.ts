/**
 * GET /api/currency/convert  → reads query params (?from=&to=&amount=)
 * POST /api/currency/convert → reads JSON body    {from, to, amount}
 *
 * The Flutter Android client sends POST with a JSON body to this endpoint
 * (see client.dart ~line 1376). The Next.js server historically only exposed
 * GET. To avoid breaking the SSOT (the conversion logic below), both verbs
 * now route through the same `convertCurrency` helper — no duplicated rates.
 *
 * Sandbox-safe: NO external API calls. Uses a static rate table seeded from
 * the task spec (1 USD = 48 EGP, 1 USD = 3.75 SAR, 1 USD = 0.92 EUR). For
 * any pair, we convert via USD (cross-rate through USD) so adding new
 * currencies is one line.
 *
 * Public (no auth) — utility endpoint.
 *
 * Returns:
 *   {
 *     success, from, to, amount, rate, result, fetched_at, source: "static"
 *   }
 *
 * Unknown currency codes → 400 with Arabic + English error.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Rate table — value = 1 USD in target currency (as of 2026-10-03).
// Per task spec: 1 USD = 48 EGP, 1 USD = 3.75 SAR, 1 USD = 0.92 EUR.
// Extended with sensible regional rates for the markets the platform serves.
const USD_RATES: Record<string, number> = {
  USD: 1,
  EGP: 48,
  SAR: 3.75,
  EUR: 0.92,
  AED: 3.67,
  KWD: 0.31,
  QAR: 3.64,
  BHD: 0.376,
  OMR: 0.385,
  JOD: 0.709,
  GBP: 0.79,
  CHF: 0.86,
};

const ARABIC_NAMES: Record<string, string> = {
  USD: 'دولار أمريكي',
  EGP: 'جنيه مصري',
  SAR: 'ريال سعودي',
  EUR: 'يورو',
  AED: 'درهم إماراتي',
  KWD: 'دينار كويتي',
  QAR: 'ريال قطري',
  BHD: 'دينار بحريني',
  OMR: 'ريال عماني',
  JOD: 'دينار أردني',
  GBP: 'جنيه إسترليني',
  CHF: 'فرنك سويسري',
};

function badRequest(ar: string, en: string) {
  return NextResponse.json(
    {
      success: false,
      error: ar,
      error_en: en,
    },
    { status: 400 }
  );
}

// Shared conversion logic — single source of truth (Rule 67) for both GET
// (query params) and POST (JSON body). Returns a NextResponse so the verb
// handlers stay thin.
async function convertCurrency(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  amountRaw: string | number | null | undefined
): Promise<Response> {
  const from = (fromRaw || 'USD').toString().toUpperCase();
  const to = (toRaw || 'EGP').toString().toUpperCase();
  const amount =
    amountRaw == null || amountRaw === ''
      ? 1
      : typeof amountRaw === 'number'
        ? amountRaw
        : Number(amountRaw);

  if (!/^[A-Z]{3}$/.test(from)) {
    return badRequest(
      'كود العملة المصدر غير صالح (يجب أن يكون 3 أحرف)',
      'Invalid source currency code (must be 3 letters)'
    );
  }
  if (!/^[A-Z]{3}$/.test(to)) {
    return badRequest(
      'كود العملة الهدف غير صالح (يجب أن يكون 3 أحرف)',
      'Invalid target currency code (must be 3 letters)'
    );
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return badRequest(
      'المبلغ يجب أن يكون رقماً موجباً',
      'amount must be a non-negative number'
    );
  }

  if (!(from in USD_RATES)) {
    return badRequest(
      `العملة ${from} غير مدعومة`,
      `Currency ${from} is not supported`
    );
  }
  if (!(to in USD_RATES)) {
    return badRequest(
      `العملة ${to} غير مدعومة`,
      `Currency ${to} is not supported`
    );
  }

  // Cross-rate through USD: 1 `from` = USD_RATES[to] / USD_RATES[from] `to`.
  const rate = USD_RATES[to] / USD_RATES[from];
  const result = amount * rate;

  return NextResponse.json({
    success: true,
    from,
    to,
    from_name_ar: ARABIC_NAMES[from] || from,
    to_name_ar: ARABIC_NAMES[to] || to,
    amount: Number(amount.toFixed(4)),
    rate: Number(rate.toFixed(6)),
    result: Number(result.toFixed(4)),
    fetched_at: new Date().toISOString(),
    source: 'static_rates',
    disclaimer:
      'الأسعار ثابتة لأغراض العرض. للأسعار اللحظية استخدم /api/currency.',
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    return await convertCurrency(
      searchParams.get('from'),
      searchParams.get('to'),
      searchParams.get('amount')
    );
  } catch (err) {
    console.error('[currency/convert] GET fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}

// POST alias — Flutter client sends JSON body {from, to, amount}.
// Delegates to the same convertCurrency() helper so there's a single source
// of truth for the rate math (Rule 67 — ROOT-CAUSE-FIRST, SSOT).
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    // Body is optional: if Flutter sends an empty body, fall back to query
    // params so the same handler works for both transport shapes.
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text) as Record<string, unknown>;
      }
    } catch {
      // ignore JSON parse errors and fall through to query params
    }
    const url = new URL(req.url);
    const fromRaw =
      (body.from as string | undefined) ?? url.searchParams.get('from');
    const toRaw =
      (body.to as string | undefined) ?? url.searchParams.get('to');
    const amountRaw =
      (body.amount as string | number | undefined) ??
      url.searchParams.get('amount');
    return await convertCurrency(fromRaw, toRaw, amountRaw);
  } catch (err) {
    console.error('[currency/convert] POST fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}
