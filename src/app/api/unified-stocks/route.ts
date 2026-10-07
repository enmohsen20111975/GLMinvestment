/**
 * GET /api/unified-stocks
 * ========================
 * Unified stock list across markets for the Flutter Android app.
 *
 * Routes to the right DB based on ?market:
 *   EGX|TADAWUL|KSE|QSE  → stocks.db . stocks (filter by market column)
 *   US                   → stocks.db . stocks WHERE market='US' (fallback to EGX)
 *   CRYPTO               → crypto.db . cryptos
 *   GOLD                 → gold_prices.db . gold_prices
 *
 * Public (no auth) — list endpoint, taste content.
 *
 * Query params:
 *   ?market=EGX  — default EGX
 *   ?limit=N     — default 100, clamped to 1..500
 *   ?search=COMI — optional substring filter on ticker / name / name_ar
 *
 * Returns:
 *   { success, market, source, total, returned, stocks: [...], generated_at }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

interface StockRow {
  ticker: string;
  name: string | null;
  name_ar: string | null;
  market: string;
  sector: string | null;
  current_price: number | null;
  previous_close: number | null;
  change_percent: number | null;
  volume: number | null;
}

function buildStockRow(r: Record<string, unknown>): StockRow {
  const ticker = String(r.ticker || r.symbol || '').toUpperCase();
  const current = Number(r.current_price ?? r.last_price ?? r.close ?? 0);
  const prev = Number(r.previous_close ?? r.prev_close ?? 0);
  let changePct: number | null = null;
  if (r.change_percent != null) {
    changePct = Number(r.change_percent);
  } else if (r.change_pct != null) {
    changePct = Number(r.change_pct);
  } else if (prev > 0 && current > 0) {
    changePct = ((current - prev) / prev) * 100;
  }
  return {
    ticker,
    name: (r.name as string) || null,
    name_ar: (r.name_ar as string) || null,
    market: String(r.market || 'EGX'),
    sector: (r.sector as string) || null,
    current_price: Number.isFinite(current) ? current : null,
    previous_close: Number.isFinite(prev) ? prev : null,
    change_percent: Number.isFinite(changePct as number)
      ? Number((changePct as number).toFixed(2))
      : null,
    volume: r.volume != null ? Number(r.volume) : null,
  };
}

function openRo(p: string): Database.Database | null {
  try {
    if (!fs.existsSync(p)) return null;
    return new Database(p, { readonly: true });
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const marketRaw = (searchParams.get('market') || 'EGX').toUpperCase();
    const market =
      ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD'].includes(
        marketRaw
      )
        ? marketRaw
        : 'EGX';
    const reqLimit = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(reqLimit)
      ? Math.min(Math.max(reqLimit, 1), 500)
      : 100;
    const search = (searchParams.get('search') || '').trim().toUpperCase();

    const cwd = process.cwd();

    // ── CRYPTO ──────────────────────────────────────────────────────────────
    if (market === 'CRYPTO') {
      const db = openRo(path.join(cwd, 'db', 'crypto.db'));
      if (!db) {
        return NextResponse.json({
          success: true,
          market,
          source: 'sqlite_fallback_empty',
          total: 0,
          returned: 0,
          stocks: [],
          message: 'crypto.db غير متاح',
        });
      }
      try {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (search) {
          conditions.push('(UPPER(symbol) LIKE ? OR UPPER(name) LIKE ?)');
          params.push(`%${search}%`, `%${search}%`);
        }
        const where = conditions.length
          ? 'WHERE ' + conditions.join(' AND ')
          : '';
        const rows = db
          .prepare(
            `SELECT symbol AS ticker, name, current_price, change_24h AS change_percent,
                    volume_24h AS volume, market_cap, last_updated
             FROM cryptos ${where}
             ORDER BY market_cap DESC NULLS LAST
             LIMIT ?`
          )
          .all(...params, limit) as Array<Record<string, unknown>>;
        const totalRow = db
          .prepare(`SELECT COUNT(*) AS c FROM cryptos ${where}`)
          .get(...params) as { c: number };
        db.close();
        const stocks = rows.map((r) => ({
          ...buildStockRow({ ...r, market: 'CRYPTO' }),
          market_cap: r.market_cap != null ? Number(r.market_cap) : null,
        }));
        return NextResponse.json({
          success: true,
          market,
          source: 'crypto.db',
          total: totalRow.c,
          returned: stocks.length,
          stocks,
          generated_at: new Date().toISOString(),
        });
      } catch (e) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        console.error('[unified-stocks CRYPTO]', e);
        return NextResponse.json({
          success: true,
          market,
          source: 'sqlite_fallback_empty',
          total: 0,
          returned: 0,
          stocks: [],
        });
      }
    }

    // ── GOLD ───────────────────────────────────────────────────────────────
    if (market === 'GOLD') {
      const db = openRo(path.join(cwd, 'db', 'gold_prices.db'));
      if (!db) {
        return NextResponse.json({
          success: true,
          market,
          source: 'sqlite_fallback_empty',
          total: 0,
          returned: 0,
          stocks: [],
        });
      }
      try {
        const rows = db
          .prepare(
            `SELECT
               id, date, karat, price_per_gram, change, currency, name_ar, created_at
             FROM gold_prices
             ORDER BY date DESC
             LIMIT ?`
          )
          .all(limit) as Array<Record<string, unknown>>;
        const totalRow = db
          .prepare(`SELECT COUNT(*) AS c FROM gold_prices`)
          .get() as { c: number };
        db.close();
        const stocks = rows.map((r) => ({
          ticker: `GOLD-${r.karat || '24'}`,
          name: `Gold ${r.karat || '24'}K`,
          name_ar: (r.name_ar as string) || `ذهب عيار ${r.karat || '24'}`,
          market: 'GOLD',
          sector: 'METALS',
          current_price: Number(r.price_per_gram) || null,
          previous_close: null,
          change_percent: r.change != null ? Number(r.change) : null,
          volume: null,
          karat: r.karat,
          currency: r.currency || 'EGP',
          date: r.date,
        }));
        return NextResponse.json({
          success: true,
          market,
          source: 'gold_prices.db',
          total: totalRow.c,
          returned: stocks.length,
          stocks,
          generated_at: new Date().toISOString(),
        });
      } catch (e) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        console.error('[unified-stocks GOLD]', e);
        return NextResponse.json({
          success: true,
          market,
          source: 'sqlite_fallback_empty',
          total: 0,
          returned: 0,
          stocks: [],
        });
      }
    }

    // ── STOCK MARKETS (EGX/TADAWUL/KSE/QSE/US) ─────────────────────────────
    const db = openRo(path.join(cwd, 'db', 'stocks.db'));
    if (!db) {
      return NextResponse.json({
        success: true,
        market,
        source: 'sqlite_fallback_empty',
        total: 0,
        returned: 0,
        stocks: [],
        message: 'stocks.db غير متاح',
      });
    }
    try {
      const conditions: string[] = ['market = ?'];
      const params: unknown[] = [market];
      if (search) {
        conditions.push(
          '(UPPER(ticker) LIKE ? OR UPPER(name) LIKE ? OR UPPER(name_ar) LIKE ?)'
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const where = 'WHERE ' + conditions.join(' AND ');
      const rows = db
        .prepare(
          `SELECT ticker, name, name_ar, market, sector,
                  current_price, previous_close, change_percent, volume
           FROM stocks ${where}
           ORDER BY ticker ASC
           LIMIT ?`
        )
        .all(...params, limit) as Array<Record<string, unknown>>;
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM stocks ${where}`)
        .get(...params) as { c: number };
      db.close();
      const stocks = rows.map(buildStockRow);
      return NextResponse.json({
        success: true,
        market,
        source: 'stocks.db',
        total: totalRow.c,
        returned: stocks.length,
        stocks,
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      console.error('[unified-stocks stocks]', e);
      return NextResponse.json({
        success: true,
        market,
        source: 'sqlite_fallback_empty',
        total: 0,
        returned: 0,
        stocks: [],
      });
    }
  } catch (err) {
    console.error('[unified-stocks] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}
