/**
 * GET /api/mobile/summary
 * ======================
 * Mobile market summary — falls back to SQLite when Python is down.
 * Reads advancing/declining/unchanged + top gainers/losers from stocks.db.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  // 1) Try Python first (5s timeout — mobile-friendly)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — read from stocks.db
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 500 }
      );
    }
    const db = new Database(stocksDbPath, { readonly: true });

    const marketMap: Record<string, string> = {
      EGX: 'EGX',
      TADAWUL: 'TADAWUL',
      KSA: 'TADAWUL',
      KSE: 'KSE',
      QSE: 'QSE',
    };
    const dbMarket = marketMap[market.toUpperCase()] || 'EGX';

    const stocks: any[] = db
      .prepare(
        `SELECT ticker, name_ar, name, current_price, previous_close, change_percent,
                volume, value_traded, turnover_egp, sector
         FROM stocks WHERE market = ? COLLATE NOCASE
         AND current_price IS NOT NULL AND current_price > 0`
      )
      .all(dbMarket);

    const advancing = stocks.filter((s) => Number(s.change_percent) > 0).length;
    const declining = stocks.filter((s) => Number(s.change_percent) < 0).length;
    const unchanged = stocks.length - advancing - declining;
    const totalVolume = stocks.reduce(
      (sum, s) => sum + Number(s.volume || 0),
      0
    );
    const totalTurnover = stocks.reduce(
      (sum, s) => sum + Number(s.value_traded || s.turnover_egp || 0),
      0
    );

    const topGainers = [...stocks]
      .sort((a, b) => Number(b.change_percent) - Number(a.change_percent))
      .slice(0, 10)
      .map((s) => ({
        ticker: s.ticker,
        name_ar: s.name_ar || s.name,
        price: Number(s.current_price),
        change_percent: Number(s.change_percent),
        volume: Number(s.volume || 0),
      }));

    const topLosers = [...stocks]
      .sort((a, b) => Number(a.change_percent) - Number(b.change_percent))
      .slice(0, 10)
      .map((s) => ({
        ticker: s.ticker,
        name_ar: s.name_ar || s.name,
        price: Number(s.current_price),
        change_percent: Number(s.change_percent),
        volume: Number(s.volume || 0),
      }));

    db.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      summary: {
        total_stocks: stocks.length,
        advancing,
        declining,
        unchanged,
        total_volume: totalVolume,
        total_turnover: totalTurnover,
      },
      top_gainers: topGainers,
      top_losers: topLosers,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:summary]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
