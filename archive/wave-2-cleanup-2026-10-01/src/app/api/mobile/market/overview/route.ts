/**
 * GET /api/mobile/market/overview
 * ==============================
 * Mobile market overview — falls back to SQLite when Python is down.
 * Mirrors the /api/market/overview route: indices + top stocks + summary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketIndices } from '@/lib/egx-db';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  // 2) Fallback — SQLite (same shape as /api/market/overview)
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
        `SELECT ticker, name_ar, name, current_price, previous_close,
                change_percent, volume, sector
         FROM stocks WHERE market = ? COLLATE NOCASE
         AND current_price IS NOT NULL AND current_price > 0
         ORDER BY volume DESC LIMIT 50`
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
      (sum, s) =>
        sum + Number(s.current_price || 0) * Number(s.volume || 0),
      0
    );

    let indices: any[] = [];
    try {
      const allIndices = getMarketIndices();
      indices = allIndices
        .filter((idx) =>
          String(idx.symbol || '').toUpperCase().includes(dbMarket)
        )
        .slice(0, 5)
        .map((idx) => ({
          symbol: idx.symbol,
          name_ar: idx.name_ar,
          value: idx.current_value,
          previous_close: idx.previous_close,
          change: idx.change,
          change_percent: idx.change_percent,
        }));
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
    console.error('[mobile:market:overview]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
