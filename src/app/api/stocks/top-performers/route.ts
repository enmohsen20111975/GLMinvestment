/**
 * GET /api/stocks/top-performers
 * ==============================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from stocks.db.stocks directly — no mock data (Rule 27).
 *
 * Returns top-10 gainers + top-10 losers + top-10 most active.
 * Shape: { success, source: 'sqlite_fallback', gainers, losers, most_active }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

const MARKET_MAP: Record<string, string> = {
  EGX: 'EGX',
  TADAWUL: 'TADAWUL',
  KSA: 'TADAWUL',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

interface PerformerRow {
  ticker: string;
  name_ar: string;
  sector: string;
  current_price: number;
  previous_close: number;
  change_percent: number;
  volume: number;
  turnover_egp: number;
  market_cap: number;
}

function mapRow(r: Record<string, unknown>): PerformerRow {
  return {
    ticker: String(r.ticker || ''),
    name_ar: String(r.name_ar || r.name || r.ticker || ''),
    sector: String(r.sector || ''),
    current_price: Number(r.current_price || 0),
    previous_close: Number(r.previous_close || 0),
    change_percent: Number(r.change_percent || 0),
    volume: Number(r.volume || 0),
    turnover_egp: Number(r.turnover_egp || 0),
    market_cap: Number(r.market_cap || 0),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // 1) Try Python first (5s timeout)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/stocks/top-performers${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch { /* safe-by-design */ }

  // 2) Fallback — read from stocks.db
  try {
    const path = require('path');
    const fs = require('fs');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const db = new Database(stocksDbPath, { readonly: true });

    const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const market = MARKET_MAP[marketRaw] || 'EGX';
    const limitRaw = Number(url.searchParams.get('limit') || 10);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 10));

    const baseSelect = `
      SELECT
        ticker, name_ar, name, sector,
        current_price, previous_close, change_percent, volume,
        COALESCE(turnover_egp, current_price * volume) AS turnover_egp,
        market_cap
      FROM stocks
      WHERE market = ?
    `;

    const gainers = (db.prepare(
      `${baseSelect} AND change_percent > 0 ORDER BY change_percent DESC LIMIT ?`
    ).all(market, limit) as Array<Record<string, unknown>>).map(mapRow);

    const losers = (db.prepare(
      `${baseSelect} AND change_percent < 0 ORDER BY change_percent ASC LIMIT ?`
    ).all(market, limit) as Array<Record<string, unknown>>).map(mapRow);

    const mostActive = (db.prepare(
      `${baseSelect} ORDER BY volume DESC LIMIT ?`
    ).all(market, limit) as Array<Record<string, unknown>>).map(mapRow);

    db.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      gainers,
      losers,
      most_active: mostActive,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[stocks:top-performers]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
