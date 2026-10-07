/**
 * Database Integrity — P0-8 Unification Tests
 * ============================================
 *
 * Verifies the database consolidation done by P0-8-DB-UNIFY:
 *
 *   - `gold_prices` moved OUT of stocks.db (the old location) and is now ONLY
 *     in data_engine.db (the canonical location). The stocks.db still has
 *     `gold_alerts` (a different table) — that's intentional and not in scope.
 *   - Each expected table exists in its canonical DB.
 *   - Critical DBs (stocks.db, predictions.db, price_history.db, data_engine.db)
 *     are not corrupted (can open read-only + run SELECT 1).
 *   - The unified `stocks` table exists in BOTH stocks.db (legacy alias) and
 *     data_engine.db (canonical) — but `gold_prices` only in data_engine.db.
 *
 * Tests open each DB read-only and close in `finally`.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';

const DB_DIR = join(process.cwd(), 'db');

function dbPath(name: string): string {
  return join(DB_DIR, name);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined;
  return !!row;
}

describe('Database Integrity (P0-8 unification)', () => {
  it('stocks.db opens read-only and responds to SELECT 1', () => {
    const p = dbPath('stocks.db');
    if (!existsSync(p)) return; // skip silently in fresh checkout
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT 1 AS v').get() as { v: number };
      expect(row.v).toBe(1);
    } finally {
      db.close();
    }
  });

  it('predictions.db opens read-only and responds to SELECT 1', () => {
    const p = dbPath('predictions.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT 1 AS v').get() as { v: number };
      expect(row.v).toBe(1);
    } finally {
      db.close();
    }
  });

  it('data_engine.db opens read-only and responds to SELECT 1', () => {
    const p = dbPath('data_engine.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT 1 AS v').get() as { v: number };
      expect(row.v).toBe(1);
    } finally {
      db.close();
    }
  });

  it('price_history.db opens read-only and responds to SELECT 1', () => {
    const p = dbPath('price_history.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT 1 AS v').get() as { v: number };
      expect(row.v).toBe(1);
    } finally {
      db.close();
    }
  });

  it('does NOT have gold_prices in stocks.db (moved to data_engine)', () => {
    const p = dbPath('stocks.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      expect(tableExists(db, 'gold_prices')).toBe(false);
    } finally {
      db.close();
    }
  });

  it('has gold_prices in data_engine.db (canonical location)', () => {
    const p = dbPath('data_engine.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      expect(tableExists(db, 'gold_prices')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('has `stocks` table in stocks.db', () => {
    const p = dbPath('stocks.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      expect(tableExists(db, 'stocks')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('has `predictions` table in predictions.db', () => {
    const p = dbPath('predictions.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      expect(tableExists(db, 'predictions')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('has `price_history` table in price_history.db', () => {
    const p = dbPath('price_history.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      expect(tableExists(db, 'price_history')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('stocks.db has `stocks` table with >= 100 rows (real data)', () => {
    const p = dbPath('stocks.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      if (!tableExists(db, 'stocks')) return;
      const row = db.prepare('SELECT COUNT(*) AS c FROM stocks').get() as { c: number };
      expect(row.c, 'stocks table should have at least 100 rows').toBeGreaterThanOrEqual(100);
    } finally {
      db.close();
    }
  });

  it('data_engine.db gold_prices has >= 1 row (canonical gold data is populated)', () => {
    const p = dbPath('data_engine.db');
    if (!existsSync(p)) return;
    const db = new Database(p, { readonly: true, fileMustExist: true });
    try {
      if (!tableExists(db, 'gold_prices')) return;
      const row = db.prepare('SELECT COUNT(*) AS c FROM gold_prices').get() as { c: number };
      expect(row.c, 'gold_prices should have at least 1 row').toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });
});
