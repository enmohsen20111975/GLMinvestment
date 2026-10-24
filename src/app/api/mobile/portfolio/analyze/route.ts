/**
 * POST /api/mobile/portfolio/analyze → reads JSON body {ticker, buy_price, quantity, buy_date?}
 * GET  /api/mobile/portfolio/analyze → reads query params ?ticker=&buy_price=&quantity=&buy_date=
 *
 * The Flutter Android client sends GET with query params to this endpoint
 * (see client.dart ~line 611). The Next.js server historically only exposed
 * POST. To avoid duplicating the validation + delegation chain, both verbs
 * now route through the same `analyzePosition` helper — single source of
 * truth (Rule 67).
 *
 * Reuses the deep rescue analysis already implemented by Task 31-C at
 * `/api/portfolio/rescue/route.ts` (which itself reads stocks.db +
 * price_history.db + data_engine.db sharia table). To avoid duplicating the
 * ~550 LOC of analysis logic, this handler validates the mobile input shape
 * and delegates to the same internal computation by re-importing that route
 * file's POST handler.
 *
 * Auth: required (getSessionUserId). 401 if no userId.
 *
 * Response: the same rich envelope as POST /api/portfolio/rescue:
 *   { success, ticker, name, current_price, loss_pct, technical,
 *     fundamentals, scenarios, recommendation, journal_template, ... }
 *
 * On missing/invalid input we return 400 with Arabic + English error.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getSessionUserId } from '@/lib/auth-helper';
// Import the existing rescue POST handler (Task 31-C) so we delegate the
// heavy analysis to a single source of truth — no duplicated RSI / MA /
// Weinstein / sharia lookup code.
import { POST as rescuePOST } from '@/app/api/portfolio/rescue/route';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'مطلوب تسجيل الدخول',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

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

// Shared validator + delegator. Returns a NextResponse so both GET (query
// string) and POST (JSON body) handlers stay thin.
async function analyzePosition(
  tickerRaw: unknown,
  buyPriceRaw: unknown,
  quantityRaw: unknown,
  buyDateRaw: unknown
): Promise<Response> {
  if (typeof tickerRaw !== 'string' || !tickerRaw.trim()) {
    return badRequest('كود السهم مطلوب', 'ticker is required');
  }

  const buyPrice =
    typeof buyPriceRaw === 'number'
      ? buyPriceRaw
      : typeof buyPriceRaw === 'string'
        ? Number(buyPriceRaw)
        : NaN;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
    return badRequest(
      'سعر الشراء يجب أن يكون رقماً موجباً',
      'buy_price must be a positive number'
    );
  }

  const quantity =
    typeof quantityRaw === 'number'
      ? quantityRaw
      : typeof quantityRaw === 'string'
        ? Number(quantityRaw)
        : NaN;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return badRequest(
      'الكمية يجب أن تكون رقماً موجباً',
      'quantity must be a positive number'
    );
  }

  // Delegate to the rescue route's POST handler. We pass a synthetic
  // NextRequest-like object so the existing handler's req.json() call works.
  const delegatedBody = {
    ticker: tickerRaw.trim().toUpperCase(),
    buy_price: buyPrice,
    quantity,
    buy_date:
      typeof buyDateRaw === 'string' && buyDateRaw.trim()
        ? buyDateRaw.trim()
        : undefined,
  };
  const fakeReq = {
    json: async () => delegatedBody,
  } as unknown as NextRequest;

  // rescuePOST returns NextResponse with the full analysis envelope.
  return await rescuePOST(fakeReq);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return badRequest('جسم الطلب غير صالح', 'Invalid JSON body');
    }

    return await analyzePosition(
      body.ticker,
      body.buy_price,
      body.quantity,
      body.buy_date
    );
  } catch (err) {
    console.error('[mobile/portfolio/analyze] POST fatal:', err);
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

// GET alias — Flutter client sends query params ?ticker=&buy_price=&quantity=&buy_date=
// Delegates to the same analyzePosition() helper so there's a single source
// of truth for the validation + rescue delegation (Rule 67 — SSOT).
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { searchParams } = new URL(req.url);
    return await analyzePosition(
      searchParams.get('ticker'),
      searchParams.get('buy_price'),
      searchParams.get('quantity'),
      searchParams.get('buy_date')
    );
  } catch (err) {
    console.error('[mobile/portfolio/analyze] GET fatal:', err);
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
