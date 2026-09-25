/**
 * GET /api/mobile/reports
 * ======================
 * Market report — falls back to stocks.db when Python is down.
 * Builds a simple report: indices + top movers + sector turnover + summary.
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
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — stocks.db
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
    const sdb = new Database(stocksDbPath, { readonly: true });

    const marketMap: Record<string, string> = {
      EGX: 'EGX',
      TADAWUL: 'TADAWUL',
      KSA: 'TADAWUL',
      KSE: 'KSE',
      QSE: 'QSE',
    };
    const dbMarket = marketMap[market.toUpperCase()] || 'EGX';

    const stocks: any[] = sdb
      .prepare(
        `SELECT ticker, name_ar, name, current_price, previous_close,
                change_percent, volume, value_traded, turnover_egp, sector,
                market_cap, is_egx30, is_egx70, is_egx100
         FROM stocks
         WHERE market = ? COLLATE NOCASE
         AND current_price IS NOT NULL AND current_price > 0`
      )
      .all(dbMarket);

    const advancing = stocks.filter((s) => Number(s.change_percent) > 0);
    const declining = stocks.filter((s) => Number(s.change_percent) < 0);
    const unchanged = stocks.filter((s) => Number(s.change_percent) === 0);
    const totalVolume = stocks.reduce(
      (sum, s) => sum + Number(s.volume || 0),
      0
    );
    const totalTurnover = stocks.reduce(
      (sum, s) => sum + Number(s.value_traded || s.turnover_egp || 0),
      0
    );
    const totalMarketCap = stocks.reduce(
      (sum, s) => sum + Number(s.market_cap || 0),
      0
    );

    // Sector turnover breakdown
    const sectorMap = new Map<string, { turnover: number; volume: number; count: number }>();
    for (const s of stocks) {
      const sector = s.sector || 'Unknown';
      const entry = sectorMap.get(sector) || { turnover: 0, volume: 0, count: 0 };
      entry.turnover += Number(s.value_traded || s.turnover_egp || 0);
      entry.volume += Number(s.volume || 0);
      entry.count += 1;
      sectorMap.set(sector, entry);
    }
    const sectors = Array.from(sectorMap.entries())
      .map(([sector, e]) => ({
        sector,
        turnover: Number(e.turnover.toFixed(2)),
        volume: e.volume,
        count: e.count,
        weight:
          totalTurnover > 0
            ? Number(((e.turnover / totalTurnover) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.turnover - a.turnover);

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

    const topVolume = [...stocks]
      .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0))
      .slice(0, 10)
      .map((s) => ({
        ticker: s.ticker,
        name_ar: s.name_ar || s.name,
        price: Number(s.current_price),
        volume: Number(s.volume || 0),
        turnover: Number(s.value_traded || s.turnover_egp || 0),
      }));

    // Market indices
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

    sdb.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      report: {
        market_breadth: {
          total_stocks: stocks.length,
          advancing: advancing.length,
          declining: declining.length,
          unchanged: unchanged.length,
          advance_decline_ratio:
            declining.length > 0
              ? Number((advancing.length / declining.length).toFixed(2))
              : advancing.length,
        },
        liquidity: {
          total_volume: totalVolume,
          total_turnover: Number(totalTurnover.toFixed(2)),
          total_market_cap: Number(totalMarketCap.toFixed(2)),
        },
        indices,
        sectors,
        top_gainers: topGainers,
        top_losers: topLosers,
        top_volume: topVolume,
        generated_at: new Date().toISOString(),
      },
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
