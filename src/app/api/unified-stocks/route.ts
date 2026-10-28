/**
 * GET /api/unified-stocks
 * ========================
 * Unified stock list across markets for the Flutter Android app.
 *
 * Routes to the right DB based on ?market:
 *   EGX|TADAWUL|KSE|QSE  → stocks.db . stocks (filter by market column)
 *   US                   → stocks.db . stocks WHERE market='US' (fallback to EGX)
 *   CRYPTO               → data_engine.db . crypto_prices  (RESTRUCT-CLEANUP-1: was crypto.db)
 *   GOLD                 → data_engine.db . gold_prices    (RESTRUCT-CLEANUP-1: was gold_prices.db)
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

import type Database from 'better-sqlite3';
import { openDb as openDbDal } from '@/lib/db-manager';

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
  // openRo originally accepted an absolute path. The DAL needs just the bare
  // filename — strip any directory components.
  const file = p.includes('/') || p.includes('\\')
    ? p.split('/').pop()!.split('\\').pop()!
    : p;
  return openDbDal(file);
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
    // RESTRUCT-CLEANUP-1: redirect crypto.db → data_engine.db.crypto_prices (live source).
    if (market === 'CRYPTO') {
      const db = openRo(`${cwd}/db/data_engine.db`);
      if (!db) {
        return NextResponse.json({
          success: true,
          market,
          source: 'sqlite_fallback_empty',
          total: 0,
          returned: 0,
          stocks: [],
          message: 'data_engine.db غير متاح',
        });
      }
      try {
        // RESTRUCT-CLEANUP-1: crypto_prices is the canonical live crypto source.
        // Schema (per mandate): symbol, name, price_usd, price_change_24h, total_volume, market_cap, timestamp.
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
            `SELECT symbol AS ticker, name, price_usd AS current_price,
                    price_change_24h AS change_percent, total_volume AS volume,
                    market_cap, timestamp
             FROM crypto_prices ${where}
             ORDER BY market_cap DESC NULLS LAST
             LIMIT ?`
          )
          .all(...params, limit) as Array<Record<string, unknown>>;
        const totalRow = db
          .prepare(`SELECT COUNT(*) AS c FROM crypto_prices ${where}`)
          .get(...params) as { c: number };
        db.close();
        const stocks = rows.map((r) => ({
          ...buildStockRow({ ...r, market: 'CRYPTO' }),
          market_cap: r.market_cap != null ? Number(r.market_cap) : null,
        }));
        return NextResponse.json({
          success: true,
          market,
          source: 'data_engine.db',
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
    // RESTRUCT-CLEANUP-1: redirect gold_prices.db → data_engine.db.gold_prices (live source).
    if (market === 'GOLD') {
      const db = openRo(`${cwd}/db/data_engine.db`);
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
        // RESTRUCT-CLEANUP-1: gold_prices is the canonical live gold source.
        // Schema (per mandate): karat, price_per_gram, price_per_ounce, currency, country, timestamp.
        const rows = db
          .prepare(
            `SELECT karat, price_per_gram, price_per_ounce, currency, country, timestamp
             FROM gold_prices
             ORDER BY timestamp DESC
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
          name_ar: `ذهب عيار ${r.karat || '24'}`,
          market: 'GOLD',
          sector: 'METALS',
          current_price: Number(r.price_per_gram) || null,
          previous_close: null,
          change_percent: null,
          volume: null,
          karat: r.karat,
          currency: r.currency || 'EGP',
          country: r.country || null,
          date: r.timestamp,
        }));
        return NextResponse.json({
          success: true,
          market,
          source: 'data_engine.db',
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
    const db = openRo(`${cwd}/db/stocks.db`);
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
