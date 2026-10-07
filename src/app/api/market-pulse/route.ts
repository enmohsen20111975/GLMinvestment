import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PYTHON_BACKEND = process.env.EGXPY_SERVICE_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

let cache: { timestamp: number; data: unknown } | null = null;
const CACHE_TTL = 10_000;
const STALE_CACHE_TTL = 5 * 60_000;

const MARKET_NAMES: Record<string, string> = {
  EGX: 'البورصة المصرية', TADAWUL: 'تداول السعودية', KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر', US: 'البورصة الأمريكية', CRYPTO: 'العملات الرقمية',
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();

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

    const marketMap: Record<string, string> = {
      EGX: 'EGX', TADAWUL: 'TADAWUL', KSA: 'TADAWUL', KSE: 'KSE',
      QSE: 'QSE', US: 'US', CRYPTO: 'CRYPTO',
    };
    const dbMarket = marketMap[market] || market;

    const stocks = db.prepare("SELECT change_percent FROM stocks WHERE market = ? AND change_percent IS NOT NULL").all(dbMarket);
    const advancing = stocks.filter((s: any) => Number(s.change_percent) > 0).length;
    const declining = stocks.filter((s: any) => Number(s.change_percent) < 0).length;
    const total = stocks.length;
    const unchanged = total - advancing - declining;
    const breadth = total > 0 ? ((advancing - declining) / total * 100) : 0;

    // Compute indices
    let indexData: any = null;
    let index70Data: any = null;

    if (dbMarket === 'EGX') {
      // EGX: read stored indices
      try {
        const idxRows = db.prepare("SELECT symbol, current_value, previous_close, change_percent FROM market_indices WHERE symbol IN ('EGX30','EGX70')").all() as any[];
        const r30 = idxRows.find((r: any) => r.symbol === 'EGX30');
        const r70 = idxRows.find((r: any) => r.symbol === 'EGX70');
        if (r30) indexData = { value: Number(r30.current_value), previous_close: Number(r30.previous_close), change_percent: Number(r30.change_percent) };
        if (r70) index70Data = { value: Number(r70.current_value), previous_close: Number(r70.previous_close), change_percent: Number(r70.change_percent) };
      } catch {}
    } else {
      // Non-EGX: compute composite index
      const validStocks = stocks.filter((s: any) => Number(s.change_percent) !== 0);
      const compositePct = validStocks.length > 0
        ? validStocks.reduce((sum: number, s: any) => sum + Number(s.change_percent || 0), 0) / validStocks.length
        : 0;
      indexData = { value: 1000, previous_close: 1000 / (1 + compositePct / 100), change_percent: compositePct };
    }

    db.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      data: {
        cairo_time: new Date().toISOString(),
        is_trading_hours: false,
        market_status: 'CLOSED',
        market: dbMarket,
        market_name_ar: MARKET_NAMES[dbMarket] || dbMarket,
        index: indexData,
        index_70: index70Data,
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
