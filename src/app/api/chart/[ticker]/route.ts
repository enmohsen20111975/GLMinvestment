/**
 * GET /api/chart/[ticker] — Rule 20 Pure Thin Proxy
 * ===================================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO synthetic candles, NO direct SQLite.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 * Rule 12 (load_merged_history): Python is the SOLE source of price data.
 *
 * The previous route had 969 lines of:
 *   - Direct SQLite reads from price_history.db, stocks.db, data_engine.db,
 *     intraday.db (Rule 20 violation — direct SQLite from 4 DBs)
 *   - ticker resolution + dedup (KORRA → KORA, COMI.CA → COMI, etc.)
 *   - OHLCV candle resampling (5m/15m/30m/1h buckets from intraday snapshots)
 *   - Weekly candle aggregation (1W interval)
 *   - Yahoo Finance fetch + merge with local history (15s timeout)
 *   - stocks_table_synthetic fallback (1-2 candles from current_price)
 *   - 6+ Math.round/Math.max/Math.min calls (computation in Node)
 *   - Multiple fallback chains (Python → SQLite → Yahoo → synthetic)
 *
 * Now it's a pure proxy to Python /api/chart/<ticker> which uses
 * load_merged_history() (Rule 12) + intraday_storage + smart fallbacks.
 *
 * The Python endpoint returns the same shape that the frontend expects:
 *   { success, ticker, period, asset, source, note, count, data, stats }
 *
 * If Python is unavailable, returns 503 with success:false (no fake candles).
 */

import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 0; // No cache - always fresh data
export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const searchParams = request.nextUrl.searchParams;

  // Build query string — preserve all query params (period, interval, asset, timeframe, etc.)
  const qs = searchParams.toString();
  const targetUrl = `${PY}/api/chart/${encodeURIComponent(rawTicker)}${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        ticker: rawTicker,
        message: 'تعذّر جلب بيانات الشارت — Python backend أرجع خطأ',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-chart',
      },
    });
  } catch (error) {
    console.error('[chart/[ticker]] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      ticker: rawTicker,
      message: 'Python backend غير متاح — لا يمكن عرض شارت وهمي (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
