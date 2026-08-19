import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb, getStocksDb } from '@/lib/egx-db';

export const dynamic = 'force-dynamic';

const MARKET_MAP: Record<string, string> = {
  EGX: 'مصر',
  EG: 'مصر',
  TADAWUL: 'السعودية',
  SA: 'السعودية',
  KSE: 'الكويت',
  KW: 'الكويت',
  QSE: 'قطر',
  QA: 'قطر',
};

// ---------------------------------------------------------------------------
// Resilience helper: try the query on a given db, return null if the table
// is missing (instead of throwing a 500). This fixes the
// "no such table: stocks" error that happened when data_engine.db didn't
// have a `stocks` table (it only has egksco_stocks / egx_fundamentals).
// ---------------------------------------------------------------------------
function safeQuery(
  db: { prepare: (sql: string) => { all: (...params: unknown[]) => Record<string, unknown>[] } } | null,
  sql: string,
  params: unknown[]
): Record<string, unknown>[] | null {
  if (!db) return null;
  try {
    return db.prepare(sql).all(...params);
  } catch {
    // Table missing or schema mismatch — return null so caller can try next DB
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/stocks/search?q=...&limit=N — Lightweight search across symbol, name
// Returns up to `limit` (default 30, max 200) results from data_engine.db (stocks table).
// Optional `market` filter (e.g., market=EGX).
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // ensureInitialized() can throw if both better-sqlite3 AND sql.js fail to
    // load (e.g. native module mismatch on a fresh deploy). We swallow that
    // error here — the individual DB loaders below (getLightDb / getStocksDb)
    // are also wrapped in try/catch, so a total init failure degrades to an
    // empty 200 response instead of a 500. The frontend renders an empty
    // state gracefully.
    try {
      await ensureInitialized();
    } catch (initErr) {
      console.warn('[/api/stocks/search] ensureInitialized failed (continuing):', initErr);
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const marketRaw = (searchParams.get('market') || '').trim().toUpperCase();
    const limitRaw = parseInt(searchParams.get('limit') || '30', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 30;

    const mappedMarket = MARKET_MAP[marketRaw] || marketRaw;
    const marketClause = mappedMarket && mappedMarket !== 'ALL' ? 'AND market = ?' : '';
    const marketParams = mappedMarket && mappedMarket !== 'ALL' ? [mappedMarket] : [];

    // Try data_engine.db first (via getLightDb), then fall back to stocks.db
    // (via getStocksDb). Either may be missing the `stocks` table depending on
    // the sync state — safeQuery swallows the "no such table" error and lets
    // us try the next source instead of returning a 500.
    const lightDb = (() => { try { return getLightDb(); } catch { return null; } })();
    const stocksDb = (() => { try { return getStocksDb(); } catch { return null; } })();

    if (!q) {
      const sql = `SELECT id, symbol, symbol AS ticker, name, name AS name_ar, sector, price AS current_price,
                  change_percent AS price_change, volume, market
           FROM stocks
           WHERE 1=1 ${marketClause}
           ORDER BY volume DESC
           LIMIT ?`;
      const params = [...marketParams, limit];

      const rows =
        safeQuery(lightDb, sql, params) ||
        safeQuery(stocksDb, sql, params) ||
        [];

      return NextResponse.json({ success: true, stocks: rows });
    }

    const term = `%${q}%`;
    const sql = `SELECT id, symbol, symbol AS ticker, name, name AS name_ar, sector, price AS current_price,
                change_percent AS price_change, volume, market
         FROM stocks
         WHERE 1=1 ${marketClause}
           AND (symbol LIKE ? OR name LIKE ?)
         ORDER BY
           CASE
             WHEN symbol LIKE ? THEN 1
             WHEN symbol = ? THEN 2
             ELSE 3
           END,
           volume DESC
         LIMIT ?`;
    const params = [...marketParams, term, term, term, q.toUpperCase(), limit];

    const rows =
      safeQuery(lightDb, sql, params) ||
      safeQuery(stocksDb, sql, params) ||
      [];

    return NextResponse.json({ success: true, stocks: rows });
  } catch (error: any) {
    // Last-resort safety net: NEVER return 500 from this endpoint. Any
    // unexpected error (param parsing, DB load, etc.) degrades to an empty
    // 200 response so the frontend's stock picker renders an empty state
    // instead of crashing the page.
    console.error('[/api/stocks/search] Unexpected error (returning empty 200):', error);
    return NextResponse.json({ success: true, stocks: [] });
  }
}
