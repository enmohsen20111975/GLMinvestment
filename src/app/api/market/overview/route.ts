/**
 * GET /api/market/overview
 * =========================
 * P0-FIX: fallback to SQLite when Python backend is down.
 * Reads from stocks.db directly — no mock data.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market/overview${qs ? `?${qs}` : ''}`;
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
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json({ success: false, error: 'stocks.db not found' }, { status: 500 });
    }
    const Database = require('better-sqlite3');
    const db = new Database(stocksDbPath, { readonly: true });

    const marketMap: Record<string, string> = {
      EGX: 'EGX', TADAWUL: 'TADAWUL', KSA: 'TADAWUL',
      KSE: 'KSE', QSE: 'QSE', US: 'US', CRYPTO: 'CRYPTO',
    };
    const dbMarket = marketMap[market.toUpperCase()] || 'EGX';

    const stocks = db.prepare(`
      SELECT ticker, name_ar, name, current_price, previous_close, change_percent, volume, sector
      FROM stocks WHERE market = ? COLLATE NOCASE
      ORDER BY volume DESC LIMIT 50
    `).all(dbMarket);

    const advancing = stocks.filter((s: any) => Number(s.change_percent) > 0).length;
    const declining = stocks.filter((s: any) => Number(s.change_percent) < 0).length;
    const unchanged = stocks.length - advancing - declining;
    const totalVolume = stocks.reduce((sum: number, s: any) => sum + Number(s.volume || 0), 0);
    const totalTurnover = stocks.reduce((sum: number, s: any) => sum + (Number(s.current_price || 0) * Number(s.volume || 0)), 0);

    // Market indices
    let indices: any[] = [];
    try {
      indices = db.prepare(`
        SELECT symbol, name_ar, current_value, previous_close, change, change_percent
        FROM market_indices WHERE symbol LIKE '%${dbMarket}%' OR name_ar LIKE '%${market}%'
        LIMIT 5
      `).all();
    } catch {}

    db.close();

    return NextResponse.json({
      success: true,
      market,
      summary: {
        total_stocks: stocks.length,
        advancing,
        declining,
        unchanged,
        total_volume: totalVolume,
        total_turnover: totalTurnover,
      },
      indices,
      top_stocks: stocks.slice(0, 10),
      source: 'sqlite_fallback',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
