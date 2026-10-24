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

    // BUG-FIX (FRONTEND-DATA-INTEGRITY-A-1, Bug 1):
    // MARKET_MAP previously converted "EGX" → "مصر" and the SQL filtered on
    // that mapped value alone. But stocks.db stores the raw code "EGX"
    // (data_engine.db stores "مصر"), so the single-sided filter matched
    // NOTHING in stocks.db → empty results even though the stock exists.
    // Now we filter on BOTH the raw code and the Arabic mapping so the same
    // clause works on either DB. MARKET_MAP is kept only to derive the
    // Arabic variant; it no longer replaces the raw value.
    const mappedMarket = MARKET_MAP[marketRaw] || '';
    const hasMarket = marketRaw && marketRaw !== 'ALL';
    const marketClause = hasMarket ? 'AND (market = ? OR market = ?)' : '';
    const marketParams = hasMarket ? [marketRaw, mappedMarket] : [];

    // Try data_engine.db first (via getLightDb), then fall back to stocks.db
    // (via getStocksDb). Either may be missing the `stocks` table depending on
    // the sync state — safeQuery swallows the "no such table" error and lets
    // us try the next source instead of returning a 500.
    const lightDb = (() => { try { return getLightDb(); } catch { return null; } })();
    const stocksDb = (() => { try { return getStocksDb(); } catch { return null; } })();

    // BUG-FIX (FRONTEND-DATA-INTEGRITY-A-1, Bug 1):
    // stocks.db.stocks uses the column `ticker` (+ current_price), while
    // data_engine.db.stocks uses `symbol` (+ price). The previous SQL only
    // referenced `symbol`, which threw "no such column: symbol" on stocks.db
    // → safeQuery returned null → empty `stocks: []` even though COMI exists.
    // (getLightDb() currently returns stocks.db, so both DB handles point at
    // the ticker-schema DB.) We now build two SQL variants — one per schema —
    // and try each against its matching column set. safeQuery swallows the
    // "no such column" error so the wrong-schema query degrades to null and
    // the right-schema query wins. The response always exposes BOTH `ticker`
    // and `symbol` aliases so callers using either field keep working.
    const buildSql = (
      col: 'symbol' | 'ticker',
      priceCol: 'price' | 'current_price',
      withQ: boolean,
    ): { sql: string; params: unknown[] } => {
      // DEAL-ADVISOR-002: filter out polluted rows where the scraper merged
      // ticker + name into the identifier column (e.g. "VALUU Consumer
      // Finance S.A.ED"). Real tickers are <= 12 chars and contain no spaces.
      // Dedup by the identifier column (GROUP BY) so the same ticker never
      // appears twice. Prefer rows with the highest volume.
      const base = `SELECT id, ${col} AS ticker, ${col} AS symbol, name, name AS name_ar, sector,
                ${priceCol} AS current_price, change_percent AS price_change, volume, market
         FROM stocks
         WHERE 1=1 ${marketClause}
           AND ${col} NOT LIKE '% %'
           AND LENGTH(${col}) <= 12`;
      if (!withQ) {
        return {
          sql: `${base}
           GROUP BY ${col}
           ORDER BY MAX(volume) DESC
           LIMIT ?`,
          params: [...marketParams, limit],
        };
      }
      const term = `%${q}%`;
      return {
        sql: `${base}
           AND (${col} LIKE ? OR name LIKE ?)
           GROUP BY ${col}
           ORDER BY
             CASE
               WHEN ${col} LIKE ? THEN 1
               WHEN ${col} = ? THEN 2
               ELSE 3
             END,
             MAX(volume) DESC
           LIMIT ?`,
        params: [...marketParams, term, term, term, q.toUpperCase(), limit],
      };
    };

    const withQ = !!q;
    // Variant A targets the data_engine.db schema (symbol + price).
    // Variant B targets the stocks.db schema (ticker + current_price).
    const variantA = buildSql('symbol', 'price', withQ);
    const variantB = buildSql('ticker', 'current_price', withQ);

    const rows =
      safeQuery(lightDb, variantA.sql, variantA.params) ||
      safeQuery(stocksDb, variantB.sql, variantB.params) ||
      [];

    // FIX (DEAL-ADVISOR-002): normalize the price field — if current_price is
    // null/0/NaN, replace with null so the UI shows "غير متاح" instead of
    // displaying 0 as a fake price.
    const normalizedRows = (rows || []).map((r) => {
      const price = Number(r.current_price);
      const valid = Number.isFinite(price) && price > 0;
      return { ...r, current_price: valid ? price : null };
    });

    return NextResponse.json({ success: true, stocks: normalizedRows });
  } catch (error: any) {
    // Last-resort safety net: NEVER return 500 from this endpoint. Any
    // unexpected error (param parsing, DB load, etc.) degrades to an empty
    // 200 response so the frontend's stock picker renders an empty state
    // instead of crashing the page.
    console.error('[/api/stocks/search] Unexpected error (returning empty 200):', error);
    return NextResponse.json({ success: true, stocks: [] });
  }
}
