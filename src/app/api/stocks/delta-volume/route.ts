/**
 * GET /api/stocks/delta-volume?ticker=COMI&days=14
 * =================================================
 * CANONICAL delta-volume route — pure proxy to Python engine.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `data_engine.db` directly (`new Database(...)`) and read `egksco_price_history`
 * (buy_volume/sell_volume/delta_volume/pressure). That bypassed the canonical
 * Python engine. Now it calls Python `/api/stocks/{ticker}/delta-volume` and
 * passes the response through verbatim. If Python is unreachable → honest
 * empty (Rule 27 NO-FAKE-DATA).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const days = searchParams.get('days') || '14';

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker required' },
        { status: 400 },
      );
    }

    const tickerUpper = ticker.toUpperCase();
    const qs = `ticker=${encodeURIComponent(tickerUpper)}&days=${encodeURIComponent(days)}`;

    // Python canonical endpoints (primary + direct fallback).
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/stocks/${tickerUpper}/delta-volume?${qs}`,
      `http://127.0.0.1:8010/api/stocks/${tickerUpper}/delta-volume?${qs}`,
      `${PYTHON_BACKEND_URL}/api/delta-volume/${tickerUpper}?${qs}`,
      `http://127.0.0.1:8010/api/delta-volume/${tickerUpper}?${qs}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(6000),
          cache: 'no-store',
        });
        if (!res.ok) continue;
        const json = await res.json();
        if (json && (json.success === true || json.latest || json.summary)) {
          // Pass through Python response verbatim (Rule 4: mirror only).
          return NextResponse.json({
            success: true,
            ticker: tickerUpper,
            latest: json.latest ?? null,
            history: Array.isArray(json.history) ? json.history : [],
            summary: json.summary ?? null,
          });
        }
      } catch {
        // try next URL (safe-by-design)
      }
    }

    // Rule 27: honest empty — no fabricated delta-volume data.
    return NextResponse.json({
      success: false,
      error: 'delta_volume_data_unavailable',
      ticker: tickerUpper,
      fallback: true,
      latest: null,
      history: [],
      summary: null,
    }, { status: 200 });
  } catch (error: any) {
    console.error('[/api/stocks/delta-volume] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'delta_volume_data_unavailable',
      ticker: (error?.ticker || '').toUpperCase(),
      fallback: true,
      latest: null,
      history: [],
      summary: null,
    }, { status: 200 });
  }
}
