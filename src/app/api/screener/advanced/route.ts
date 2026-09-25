/**
 * GET /api/screener/advanced
 * =========================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from stocks.db.stocks directly — no mock data (Rule 27).
 *
 * Supports the same query params the Python screener accepts (best-effort):
 *   - sector: exact match on stocks.sector (case-insensitive)
 *   - min_volume: minimum stocks.volume
 *   - min_turnover: minimum computed turnover (current_price * volume)
 *   - min_market_cap: minimum market_cap
 *   - signal: numeric threshold on stocks.signal (>=value)
 *   - sort: 'change_percent' (default) | 'volume' | 'market_cap'
 *   - limit: max 50 (default 50)
 *   - market: EGX (default) | TADAWUL | KSE | QSE | US | CRYPTO
 *
 * Returns:
 *   { success, source: 'sqlite_fallback', stocks: [...], count, filters_applied: {...} }
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // 1) Try Python first (5s timeout)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/screener/advanced${qs ? `?${qs}` : ''}`;
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
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const db = new Database(stocksDbPath, { readonly: true });

    const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const market = MARKET_MAP[marketRaw] || 'EGX';

    const sector = url.searchParams.get('sector')?.trim();
    const minVolume = url.searchParams.get('min_volume');
    const minTurnover = url.searchParams.get('min_turnover');
    const minMarketCap = url.searchParams.get('min_market_cap');
    const minSignal = url.searchParams.get('signal');
    const sortRaw = (url.searchParams.get('sort') || 'change_percent').toLowerCase();
    const sort = ['change_percent', 'volume', 'market_cap'].includes(sortRaw)
      ? sortRaw
      : 'change_percent';
    const limitRaw = Number(url.searchParams.get('limit') || 50);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 50));

    const filtersApplied: Record<string, unknown> = { market, sort, limit };
    const where: string[] = ['market = ?'];
    const params: unknown[] = [market];

    if (sector) {
      where.push('sector = ? COLLATE NOCASE');
      params.push(sector);
      filtersApplied.sector = sector;
    }
    if (minVolume && !Number.isNaN(Number(minVolume))) {
      where.push('volume >= ?');
      params.push(Number(minVolume));
      filtersApplied.min_volume = Number(minVolume);
    }
    if (minMarketCap && !Number.isNaN(Number(minMarketCap))) {
      where.push('market_cap >= ?');
      params.push(Number(minMarketCap));
      filtersApplied.min_market_cap = Number(minMarketCap);
    }
    if (minSignal && !Number.isNaN(Number(minSignal))) {
      where.push('signal >= ?');
      params.push(Number(minSignal));
      filtersApplied.min_signal = Number(minSignal);
    }
    if (minTurnover && !Number.isNaN(Number(minTurnover))) {
      // turnover_egp often NULL — compute via current_price * volume
      where.push('(COALESCE(turnover_egp, current_price * volume) >= ?)');
      params.push(Number(minTurnover));
      filtersApplied.min_turnover = Number(minTurnover);
    }

    // Build ORDER BY: NULLs last for sort column
    const orderBy = sort === 'volume'
      ? 'volume DESC NULLS LAST'
      : sort === 'market_cap'
        ? 'market_cap DESC NULLS LAST'
        : 'change_percent DESC NULLS LAST';

    const sql = `
      SELECT
        ticker, name_ar, name, sector,
        current_price, previous_close, change_percent, volume,
        COALESCE(turnover_egp, current_price * volume) AS turnover_egp,
        market_cap, signal, rsi, ma_50, ma_200, support, resistance, trend
      FROM stocks
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const stocks = rows.map((r) => ({
      ticker: r.ticker,
      name_ar: r.name_ar || r.name || r.ticker,
      sector: r.sector || '',
      current_price: Number(r.current_price || 0),
      change_percent: Number(r.change_percent || 0),
      volume: Number(r.volume || 0),
      turnover_egp: Number(r.turnover_egp || 0),
      market_cap: Number(r.market_cap || 0),
      signal: Number(r.signal || 0),
      rsi: r.rsi === null ? null : Number(r.rsi),
      ma_50: r.ma_50 === null ? null : Number(r.ma_50),
      ma_200: r.ma_200 === null ? null : Number(r.ma_200),
      support: r.support === null ? null : Number(r.support),
      resistance: r.resistance === null ? null : Number(r.resistance),
      trend: r.trend || null,
    }));

    db.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      stocks,
      count: stocks.length,
      filters_applied: filtersApplied,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
