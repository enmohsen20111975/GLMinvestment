/**
 * canonical-price.ts — Unified Market Data Adapter (PKG3 — SSOT)
 * ================================================================
 * THE single source of truth for reading a stock's price across the
 * entire frontend. Replaces the 6 parallel price-reading paths found
 * in the scoping report (egx-db / data-engine-db / market-data-access /
 * egxpy-bridge / multi-source-adapter / unified-stock-data).
 *
 * Rule 67 (SSOT): the number in screen A = screen B = report C.
 *
 * Resolution order (documented, deterministic):
 *   1. stocks.db.stocks.current_price        (canonical primary — SQLite)
 *   2. data_engine.db.egksco_price_history   (historical clean close)
 *   3. VPS Python API /api/stock/{ticker}     (live, with cache)
 *
 * Every read returns a `CanonicalPrice` that stamps WHICH source was
 * used + the read timestamp, so screens can detect stale data and the
 * auditor can verify the SSOT contract.
 *
 * Usage:
 *   import { getCanonicalPrice } from '@/lib/canonical-price';
 *   const p = await getCanonicalPrice('COMI');
 *   if (p) renderPrice(p.value, p.source, p.asOf);
 */

import { getStockByTicker } from '@/lib/egx-db';

export type PriceSource =
  | 'stocks.db.current_price'
  | 'data_engine.egksco_price_history'
  | 'vps_api.live';

export interface CanonicalPrice {
  ticker: string;
  value: number;
  source: PriceSource;
  asOf: string;        // ISO timestamp of the read
  previousClose: number | null;
  /** True if the value is older than `staleMs`. */
  stale: boolean;
}

const STALE_MS = 15 * 60 * 1000; // 15 min — flag reads older than this

/**
 * Read the canonical price for a ticker.
 * Tries the documented resolution order and returns the first hit.
 */
export async function getCanonicalPrice(
  ticker: string,
  opts?: { allowLive?: boolean }
): Promise<CanonicalPrice | null> {
  const upper = ticker.toUpperCase().trim();
  const allowLive = opts?.allowLive ?? true;
  const now = new Date().toISOString();

  // 1. stocks.db (primary)
  try {
    const row = await getStockByTicker(upper);
    const price = numOrNull(row?.current_price);
    if (row && price != null && price > 0) {
      return {
        ticker: upper,
        value: price,
        source: 'stocks.db.current_price',
        asOf: now,
        previousClose: numOrNull(row.previous_close),
        stale: false,
      };
    }
  } catch {
    // fall through to next source
  }

  // 2. data_engine historical (clean close) — lazy import to avoid circular
  try {
    const { getLastCleanClose } = await import('@/lib/data-engine-db-sqljs');
    const result = await getLastCleanClose(upper);
    // getLastCleanClose returns { price, source, date } | null
    const close = result && typeof result === 'object' ? numOrNull((result as { price?: unknown }).price) : null;
    if (close != null && close > 0) {
      return {
        ticker: upper,
        value: close,
        source: 'data_engine.egksco_price_history',
        asOf: now,
        previousClose: null,
        stale: false,
      };
    }
  } catch {
    // module optional
  }

  // 3. VPS Python API (live) — opt-in
  if (allowLive) {
    try {
      const { fetchQuote } = await import('@/lib/egxpy-bridge');
      const quote = await fetchQuote(upper);
      if (quote) {
        const price = numOrNull(quote.current_price);
        if (price != null && price > 0) {
          return {
            ticker: upper,
            value: price,
            source: 'vps_api.live',
            asOf: now,
            previousClose: numOrNull(quote.previous_close),
            stale: false,
          };
        }
      }
    } catch {
      // live source unavailable
    }
  }

  return null;
}

/**
 * Batch canonical read for multiple tickers (avoids N+1 dispatch).
 */
export async function getCanonicalPrices(
  tickers: string[]
): Promise<Map<string, CanonicalPrice>> {
  const out = new Map<string, CanonicalPrice>();
  await Promise.all(
    tickers.map(async (t) => {
      const p = await getCanonicalPrice(t).catch(() => null);
      if (p) out.set(t.toUpperCase(), p);
    })
  );
  return out;
}

/**
 * Mark a price as stale if its `asOf` is older than STALE_MS.
 */
export function isPriceStale(asOf: string, staleMs: number = STALE_MS): boolean {
  const ts = Date.parse(asOf);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > staleMs;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
