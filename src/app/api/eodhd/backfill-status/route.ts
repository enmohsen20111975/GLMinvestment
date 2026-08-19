/**
 * EODHD Backfill Status API - Proxy to Python Backend
 * حالة تعبئة البيانات التاريخية من EODHD
 *
 * Returns:
 *  - total_stocks: total active EGX stocks in DB
 *  - stocks_with_history: distinct tickers with daily prices
 *  - total_records: rows in stock_daily_prices
 *  - oldest_date / newest_date: data range
 */

import { NextResponse } from 'next/server';

const PYTHON_BACKEND = process.env.EGXPY_SERVICE_URL || process.env.EGX_VPS_API_URL || 'http://127.0.0.1:8010';

let cache: { timestamp: number; data: unknown } | null = null;
const CACHE_TTL = 15_000; // 15 seconds

export const dynamic = 'force-dynamic';

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${PYTHON_BACKEND}/api/eodhd/backfill-status`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Python backend returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    cache = { timestamp: Date.now(), data };
    return NextResponse.json(data);
  } catch (error) {
    console.error('[eodhd/backfill-status] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
