/**
 * GET /api/stocks/[ticker]/intraday-flow
 * ========================================
 * Intraday Liquidity & CVD Engine (GM directive — GLM5.2)
 *
 * Returns three institutional-grade analytics for a single ticker:
 *   1. CVD (Cumulative Volume Delta) — proxy for maker accumulation.
 *   2. Volume Profile POC — price level with the most traded volume.
 *   3. Large Blocks vs Retail Flow — notional-based classification.
 *
 * Data sources (Rule 67 SSOT, in priority order):
 *   - PRIMARY:  db/intraday.db.stock_intraday (ticker, timestamp, price,
 *               volume, open, high, low, change_percent)
 *   - FALLBACK: db/intraday.db.intraday_prices (ticker, price_time, price,
 *               volume, bid, ask)
 *
 * Rule 27 (NO-FAKE-DATA) — strict:
 *   - If BOTH tables are empty for the ticker → 404 with explanation.
 *     We NEVER fabricate bars, deltas, or POC values.
 *
 * Rule 20 (Python = brain):
 *   - This is a READ-ONLY analytics layer (no writes). All data comes from
 *     SQLite. No Node-side computation that the Python backend should own.
 *
 * If the latest available session is NOT today (market closed / no data
 * yet today), the response carries `is_historical_session: true` and
 * `session_date: 'YYYY-MM-DD'` so the UI can label it clearly.
 *
 * Response shape (200 OK):
 *   {
 *     "success": true,
 *     "data": IntradayFlowResult   (see src/lib/intraday-flow.ts)
 *   }
 *
 * Response shape (404 — no intraday data):
 *   {
 *     "success": false,
 *     "error": "no_intraday_data",
 *     "message": "لا توجد بيانات لحظية لهذا السهم في db/intraday.db — قد يكون الـ ingestion pipeline معطلاً",
 *     "ticker": "COMI",
 *     "hint": "intraday_data_ingestion_may_be_broken"
 *   }
 *
 * References:
 *   - GM directive: P0-RADAR-STATS-REPAIR → Intraday Liquidity Engine
 *   - Rule 27, Rule 67, Rule 75
 */

import { NextRequest, NextResponse } from 'next/server';
import { computeIntradayFlow } from '@/lib/intraday-flow';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  // Normalize: strip market suffix (.CA / .SR / .KW / ...) and uppercase.
  const ticker = rawTicker
    .replace(/\.(CA|SR|KW|AE|BH|QA)$/i, '')
    .toUpperCase();

  if (!ticker) {
    return NextResponse.json(
      {
        success: false,
        error: 'bad_request',
        message: 'ticker parameter is required',
      },
      { status: 400 },
    );
  }

  try {
    const result = computeIntradayFlow(ticker);

    if (!result) {
      // Rule 27: no data → honest 404. Never fabricate.
      return NextResponse.json(
        {
          success: false,
          error: 'no_intraday_data',
          ticker,
          message:
            'لا توجد بيانات لحظية لهذا السهم في db/intraday.db — قد يكون الـ ingestion pipeline معطلاً',
          hint: 'intraday_data_ingestion_may_be_broken',
          checked_tables: ['stock_intraday', 'intraday_prices'],
          db_path: 'db/intraday.db',
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      ticker,
      data: result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[intraday-flow]', ticker, message);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        ticker,
        message: 'فشل في حساب التدفق اللحظي',
        details: message,
      },
      { status: 500 },
    );
  }
}
