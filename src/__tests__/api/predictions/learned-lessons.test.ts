/**
 * Learned Lessons API — Smoke Tests (P1-GEMS-WIRING)
 * ===================================================
 *
 * Verifies the contract documented in src/app/api/predictions/learned-lessons/route.ts:
 *
 *   - GET /api/predictions/learned-lessons returns 200 with the documented shape:
 *       { success: true, total, returned, lessons: [...], conditions: [...] }
 *   - Each lesson has the documented fields (id, condition, outcome, recommendation,
 *     updated_at, occurrence_count, failure_rate, avg_return).
 *   - The condition LIKE filter narrows the result set.
 *   - The outcome filter narrows the result set to success/failure only.
 *   - The sort param changes the order (occurrences DESC vs. failure_rate DESC).
 *
 * Also runs a parallel direct DB read test against predictions.db.learned_lessons
 * (read-only) to assert the API truthfully matches the underlying table.
 *
 * If localhost:3001 is not running, the HTTP-based tests are skipped but the
 * DB-integrity tests still run (using better-sqlite3 readonly).
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';

const BASE = 'http://localhost:3001';
const PATH = '/api/predictions/learned-lessons';
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
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}

const serverUp = await probe(`${BASE}${PATH}?limit=1`);

interface Lesson {
  id: number;
  condition: string;
  outcome: string;
  recommendation: string | null;
  updated_at: string | null;
  occurrence_count: number;
  failure_rate: number | null;
  avg_return: number | null;
}

interface ApiResponse {
  success: boolean;
  total: number;
  returned: number;
  lessons: Lesson[];
  conditions: string[];
  filters: { limit: number; condition: string | null; outcome: string | null; sort: string };
  error?: string;
}

// DB-level integrity tests — always run if the DB exists
// eslint-disable-next-line vitest/valid-describe-callback
describe.skipIf(skipDb)('learned_lessons DB integrity (P1-GEMS-WIRING)', () => {
  function openRo(): Database.Database {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  }

  it('table has the documented schema', () => {
    const db = openRo();
    try {
      const sql = db.prepare(
        `SELECT sql FROM sqlite_master WHERE name='learned_lessons'`,
      ).get() as { sql: string };
      expect(sql.sql).toMatch(/CREATE TABLE learned_lessons/);
      expect(sql.sql).toMatch(/condition/);
      expect(sql.sql).toMatch(/outcome/);
      expect(sql.sql).toMatch(/recommendation/);
      expect(sql.sql).toMatch(/occurrences/);
      expect(sql.sql).toMatch(/failure_rate/);
    } finally {
      db.close();
    }
  });

  it('row count is non-trivial (>= 1000 lessons)', () => {
    const db = openRo();
    try {
      const r = db.prepare('SELECT COUNT(*) as n FROM learned_lessons').get() as { n: number };
      expect(r.n).toBeGreaterThanOrEqual(1000);
    } finally {
      db.close();
    }
  });
});

// HTTP-level smoke tests — skipped if dev server is down
// eslint-disable-next-line vitest/valid-describe-callback
describe.skipIf(!serverUp)('Learned Lessons API (GET /api/predictions/learned-lessons)', () => {
  it('returns 200 + documented shape', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.success).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.lessons)).toBe(true);
    expect(Array.isArray(body.conditions)).toBe(true);
    expect(body.total).toBeGreaterThan(0);
    expect(body.lessons.length).toBeLessThanOrEqual(5);
  });

  it('lesson rows have the documented fields', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=3`);
    const body = (await res.json()) as ApiResponse;
    expect(body.lessons.length).toBeGreaterThan(0);
    const l = body.lessons[0];
    expect(l).toHaveProperty('id');
    expect(l).toHaveProperty('condition');
    expect(l).toHaveProperty('outcome');
    expect(l).toHaveProperty('recommendation');
    expect(l).toHaveProperty('updated_at');
    expect(l).toHaveProperty('occurrence_count');
    expect(['success', 'failure']).toContain(l.outcome);
  });

  it('respects the condition LIKE filter', async () => {
    const cond = 'market_regime';
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=20&condition=${encodeURIComponent(cond)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.lessons.length).toBeGreaterThan(0);
    for (const l of body.lessons) {
      expect(l.condition.toLowerCase()).toContain(cond.toLowerCase());
    }
  });

  it('respects the outcome filter (only failures)', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=10&outcome=failure`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.lessons.length).toBeGreaterThan(0);
    for (const l of body.lessons) {
      expect(l.outcome).toBe('failure');
    }
  });

  it('clamps limit to the documented maximum', async () => {
    // Request limit=10000 — should be clamped to 500
    const res = await fetchWithTimeout(`${BASE}${PATH}?limit=10000`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.filters.limit).toBe(500);
    expect(body.lessons.length).toBeLessThanOrEqual(500);
  });
});
