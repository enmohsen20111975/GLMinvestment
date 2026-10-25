import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { fetchMarketIndices, MARKET_NAMES_AR, MARKET_ALIASES } from '@/lib/market-data-access';

const PYTHON_BACKEND = process.env.EGXPY_SERVICE_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

let cache: { timestamp: number; data: unknown } | null = null;
const CACHE_TTL = 10_000;
const STALE_CACHE_TTL = 5 * 60_000;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
  const market = MARKET_ALIASES[marketRaw] || marketRaw;

  // 1) Try Python first
  try {
    const response = await fetch(`${PYTHON_BACKEND}/api/market-pulse?market=${market}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      cache = { timestamp: Date.now(), data };
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Return stale cache if available
  if (cache && Date.now() - cache.timestamp < STALE_CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  // 3) Fallback — compute from stocks.db
  try {
    const path = require('path');
    const fs = require('fs');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json({ success: false, error: 'stocks.db not found' }, { status: 500 });
    }
    const Database = require('better-sqlite3');
    const db = new Database(stocksDbPath, { readonly: true });

    const stocks = db.prepare("SELECT change_percent FROM stocks WHERE market = ? AND change_percent IS NOT NULL").all(market);
    db.close();

    const advancing = stocks.filter((s: any) => Number(s.change_percent) > 0).length;
    const declining = stocks.filter((s: any) => Number(s.change_percent) < 0).length;
    const total = stocks.length;
    const unchanged = total - advancing - declining;
    const breadth = total > 0 ? ((advancing - declining) / total * 100) : 0;

    // MARKET-INDICES-SYSTEM: fetch real market-specific indices (no fake data)
    const { indices } = await fetchMarketIndices(market);

    // Build primary index + secondary index for backwards-compat with the
    // legacy `index` / `index_70` shape that some consumers still expect.
    let indexData: any = null;
    let index70Data: any = null;
    if (indices.length > 0) {
      indexData = {
        value: Number(indices[0].value) || 0,
        previous_close: Number(indices[0].previous_close) || 0,
        change_percent: Number(indices[0].change_percent) || 0,
        symbol: indices[0].symbol,
        name_ar: indices[0].name_ar,
      };
    }
    if (indices.length > 1) {
      index70Data = {
        value: Number(indices[1].value) || 0,
        previous_close: Number(indices[1].previous_close) || 0,
        change_percent: Number(indices[1].change_percent) || 0,
        symbol: indices[1].symbol,
        name_ar: indices[1].name_ar,
      };
    }

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      data: {
        cairo_time: new Date().toISOString(),
        is_trading_hours: false,
        market_status: 'CLOSED',
        market,
        market_name_ar: MARKET_NAMES_AR[market] || market,
        index: indexData,
        index_70: index70Data,
        indices, // full market-specific list (NEW — MARKET-INDICES-SYSTEM)
        breadth: Math.round(breadth * 10) / 10,
        advancing,
        declining,
        unchanged,
        total_stocks: total,
      },
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: 'market_pulse_unavailable',
      message: String(e),
    }, { status: 500 });
  }
}
