/**
 * GET /api/live-monitor
 * ======================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from intraday.db.stock_intraday + stocks.db.stocks — no mock data (Rule 27).
 *
 * Tries Python /api/live-monitor first (5s timeout).
 * On failure, returns latest 50 ticks + active stocks list.
 *
 * Shape: { success, source: 'sqlite_fallback', ticks, active_stocks, last_update }
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

interface Tick {
  ticker: string;
  market: string;
  timestamp: string;
  price: number;
  change_percent: number;
  volume: number;
  open: number | null;
  high: number | null;
  low: number | null;
}

interface ActiveStock {
  ticker: string;
  name_ar: string;
  sector: string;
  current_price: number;
  change_percent: number;
  volume: number;
  is_egx30: boolean;
  is_egx100: boolean;
  last_update: string | null;
}

export async function GET() {
  // 1) Try Python first (5s timeout)
  try {
    const res = await fetch(`${PY}/api/live-monitor`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error('[live-monitor] Python proxy error:', error);
  }

  // 2) Fallback — read from intraday.db + stocks.db
  try {
    const path = require('path');
    const fs = require('fs');
    const intradayDbPath = path.join(process.cwd(), 'db', 'intraday.db');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(intradayDbPath)) {
      return NextResponse.json(
        { success: false, error: 'intraday.db not found' },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const intraDb = new Database(intradayDbPath, { readonly: true });

    const tickRows = intraDb
      .prepare(
        `SELECT
           ticker, market, timestamp, price, change_percent, volume,
           open, high, low
         FROM stock_intraday
         ORDER BY timestamp DESC
         LIMIT 50`
      )
      .all() as Array<Record<string, unknown>>;
    const lastUpdateTick = tickRows[0]?.timestamp ?? null;

    const ticks: Tick[] = tickRows.map((r) => ({
      ticker: String(r.ticker || ''),
      market: String(r.market || ''),
      timestamp: String(r.timestamp || ''),
      price: Number(r.price ?? 0),
      change_percent: Number(r.change_percent ?? 0),
      volume: Number(r.volume ?? 0),
      open: r.open === null || r.open === undefined ? null : Number(r.open),
      high: r.high === null || r.high === undefined ? null : Number(r.high),
      low: r.low === null || r.low === undefined ? null : Number(r.low),
    }));

    intraDb.close();

    // Active stocks from stocks.db — top 30 by volume today
    // ملاحظة: الـ schema ممكن ما يكون فيه change_percent أو is_egx30 — نتعامل مع كل الحالات
    let activeStocks: ActiveStock[] = [];
    if (fs.existsSync(stocksDbPath)) {
      const stocksDb = new Database(stocksDbPath, { readonly: true });
      // اكتشف الأعمدة المتاحة
      const tableInfo = stocksDb.prepare('PRAGMA table_info(stocks)').all() as Array<{ name: string }>;
      const colNames = new Set(tableInfo.map(c => c.name));
      const hasChangePercent = colNames.has('change_percent');
      const hasIsEgx30 = colNames.has('is_egx30');
      const hasEgx30Member = colNames.has('egx30_member');

      const selectSql = `
        SELECT
          ticker, name_ar, sector, current_price, previous_close, volume, last_update
          ${hasChangePercent ? ', change_percent' : ''}
          ${hasIsEgx30 ? ', is_egx30' : hasEgx30Member ? ', egx30_member AS is_egx30' : ''}
          ${colNames.has('is_egx100') ? ', is_egx100' : colNames.has('egx100_member') ? ', egx100_member AS is_egx100' : ''}
        FROM stocks
        WHERE market = 'EGX'
        ORDER BY volume DESC
        LIMIT 30
      `;
      const stockRows = stocksDb
        .prepare(selectSql)
        .all() as Array<Record<string, unknown>>;
      activeStocks = stockRows.map((r) => {
        // احسب change_percent لو مفيش column
        let chgPct = 0;
        if (hasChangePercent && r.change_percent != null) {
          chgPct = Number(r.change_percent);
        } else {
          const curr = Number(r.current_price) || 0;
          const prev = Number(r.previous_close) || 0;
          chgPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        }
        return {
          ticker: String(r.ticker || ''),
          name_ar: String(r.name_ar || r.ticker || ''),
          sector: String(r.sector || ''),
          current_price: Number(r.current_price ?? 0),
          change_percent: chgPct,
          volume: Number(r.volume ?? 0),
          is_egx30: Boolean(r.is_egx30),
          is_egx100: Boolean(r.is_egx100),
          last_update:
            r.last_update === null || r.last_update === undefined
              ? null
              : String(r.last_update),
        };
      });
      stocksDb.close();
    }

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      ticks,
      active_stocks: activeStocks,
      last_update: lastUpdateTick,
      stats: {
        total_ticks: ticks.length,
        active_count: activeStocks.length,
        gainers: ticks.filter((t) => t.change_percent > 0).length,
        losers: ticks.filter((t) => t.change_percent < 0).length,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[live-monitor] SQLite fallback error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
