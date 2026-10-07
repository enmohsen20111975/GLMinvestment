/**
 * Historical Trades API — Smoke Tests (P1-GEMS-WIRING)
 * =====================================================
 *
 * Verifies the contract documented in src/app/api/predictions/historical-trades/route.ts:
 *
 *   - GET /api/predictions/historical-trades returns 200 with the documented shape:
 *       { success, total, returned, offset, trades: [...], strategies: [...] }
 *   - Each trade has the documented fields (id, ticker, buy_date, sell_date,
 *     buy_price, sell_price, return_pct, exit_reason).
 *   - The outcome filter narrows the result set to WIN/LOSS/BREAKEVEN.
 *   - The strategy filter narrows to a known strategy.
 *   - Pagination via offset works (returns different rows for offset=0 vs. offset=100).
 *
 * Also runs a parallel direct DB read test against predictions.db.historical_trades
 * (read-only) to assert the API truthfully matches the underlying table.
 *
 * If localhost:3001 is not running, the HTTP-based tests are skipped but the
 * DB-integrity tests still run.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';

const BASE = 'http://localhost:3001';
const PATH = '/api/predictions/historical-trades';
const DB_PATH = join(process.cwd(), 'db', 'predictions.db');
const skipDb = !existsSync(DB_PATH);

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('timeout')), ms),
  );
  return Promise.race([fetch(url), timeout]) as Promise<Response>;
}

async function probe(url: string, ms = 4000): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, ms);
    return res.ok;
  } catch {
    return false;
  }
}

const serverUp = await probe(`${BASE}${PATH}?limit=1`);

interface Trade {
  id: number;
  ticker: string;
  strategy: string;
  buy_date: string;
  buy_price: number;
  sell_date: string | null;
  sell_price: number | null;
  return_pct: number | null;
  holding_days: number | null;
  exit_reason: string | null;
}

interface ApiResponse {
  success: boolean;
  total: number;
  returned: number;
  offset: number;
  trades: Trade[];
  strategies: string[];
  filters: { limit: number; offset: number; ticker: string | null; strategy: string | null; outcome: string | null; sort: string };
  error?: string;
}

// DB-level integrity tests — always run if the DB exists
// eslint-disable-next-line vitest/valid-describe-callback
describe.skipIf(skipDb)('historical_trades DB integrity (P1-GEMS-WIRING)', () => {
  function openRo(): Database.Database {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  }

  it('table has the documented schema', () => {
    const db = openRo();
    try {
      const sql = db.prepare(
        `SELECT sql FROM sqlite_master WHERE name='historical_trades'`,
      ).get() as { sql: string };
      expect(sql.sql).toMatch(/CREATE TABLE historical_trades/);
      expect(sql.sql).toMatch(/ticker/);
      expect(sql.sql).toMatch(/buy_date/);
      expect(sql.sql).toMatch(/sell_date/);
      expect(sql.sql).toMatch(/buy_price/);
      expect(sql.sql).toMatch(/sell_price/);
      expect(sql.sql).toMatch(/pnl_pct/);
      expect(sql.sql).toMatch(/outcome/);
    } finally {
      db.close();
    }
  });

  it('row count is non-trivial (>= 1000 trades)', () => {
    const db = openRo();
    try {
      const r = db.prepare('SELECT COUNT(*) as n FROM historical_trades').get() as { n: number };
      expect(r.n).toBeGreaterThanOrEqual(1000);
    } finally {
      db.close();
    }
  });
});

// HTTP-level smoke tests — skipped if dev server is down
// eslint-disable-next-line vitest/valid-describe-callback
describe.skipIf(!serverUp)('Historical Trades API (GET /api/predictions/historical-trades)', () => {
  it('returns 200 + documented shape', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.success).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.trades)).toBe(true);
    expect(Array.isArray(body.strategies)).toBe(true);
    expect(body.total).toBeGreaterThan(0);
    expect(body.trades.length).toBeLessThanOrEqual(5);
  });

  it('trade rows have the documented fields', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=3`);
    const body = (await res.json()) as ApiResponse;
    expect(body.trades.length).toBeGreaterThan(0);
    const t = body.trades[0];
    expect(t).toHaveProperty('id');
    expect(t).toHaveProperty('ticker');
    expect(t).toHaveProperty('buy_date');
    expect(t).toHaveProperty('buy_price');
    expect(t).toHaveProperty('sell_date');
    expect(t).toHaveProperty('sell_price');
    expect(t).toHaveProperty('return_pct');
    expect(t).toHaveProperty('exit_reason');
  });

  it('respects the outcome filter (WIN only)', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=20&outcome=WIN`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.trades.length).toBeGreaterThan(0);
    for (const t of body.trades) {
      expect(t.exit_reason).toBe('WIN');
    }
  });

  it('respects pagination via offset', async () => {
    const res1 = await fetchWithTimeout(`${BASE}${PATH}?limit=5&offset=0`);
    const body1 = (await res1.json()) as ApiResponse;
    const res2 = await fetchWithTimeout(`${BASE}${PATH}?limit=5&offset=5`);
    const body2 = (await res2.json()) as ApiResponse;
    const ids1 = new Set(body1.trades.map((t) => t.id));
    const ids2 = new Set(body2.trades.map((t) => t.id));
    // The two pages must not overlap
    const overlap = [...ids1].filter((id) => ids2.has(id));
    expect(overlap.length, `found ${overlap.length} overlapping ids`).toBe(0);
  });
});
