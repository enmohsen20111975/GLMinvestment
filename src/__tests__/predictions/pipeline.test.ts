/**
 * Predictions Pipeline — Correctness Tests (P0-17/18/HELI)
 * ========================================================
 *
 * Verifies that the predictions DB (db/predictions.db) is in the expected
 * post-fix state:
 *
 *   1. P0-18 fix: no duplicate predictions (UNIQUE index on
 *      ticker, prediction_date, persona).
 *   2. The unique index `idx_predictions_unique_ticker_date_persona` exists.
 *   3. P0-1 fix: `stored_analyses` table is populated (>= 1 row).
 *   4. P0-2 fix: `hunter_pick_tracking` table is populated (>= 1 row).
 *   5. HELI fix: no false TARGET_HITs from `maker_fuel_exhausted` exits
 *      (status='TARGET_HIT' must imply highest_price_reached >= target_price).
 *   6. Schema integrity: `predictions` has all the columns the pipeline
 *      depends on (no accidental schema drift after a migration).
 *
 * Tests open db/predictions.db READ-ONLY and close the handle in `finally`
 * so they don't lock the DB for the dev server.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'db', 'predictions.db');

// Skip the whole file if the DB doesn't exist (e.g. fresh CI checkout).
const skip = !existsSync(DB_PATH);

// eslint-disable-next-line vitest/valid-describe-callback
describe.skipIf(skip)('Predictions Pipeline (P0-17/18/HELI fixes)', () => {
  function openRo(): Database.Database {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  }

  it('should have no duplicate predictions (P0-18 UNIQUE index)', () => {
    const db = openRo();
    try {
      const dups = db
        .prepare(
          `SELECT ticker, prediction_date, persona, COUNT(*) as c
           FROM predictions
           GROUP BY ticker, prediction_date, persona
           HAVING c > 1`
        )
        .all() as { ticker: string; prediction_date: string; persona: string; c: number }[];
      expect(dups, `found ${dups.length} duplicate groups`).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('should have the UNIQUE index idx_predictions_unique_ticker_date_persona', () => {
    const db = openRo();
    try {
      const idx = db
        .prepare(
          `SELECT name, sql FROM sqlite_master
           WHERE type='index' AND name='idx_predictions_unique_ticker_date_persona'`
        )
        .get() as { name: string; sql: string } | undefined;
      expect(idx, 'unique index must exist').toBeDefined();
      expect(idx!.sql).toMatch(/UNIQUE/i);
    } finally {
      db.close();
    }
  });

  it('should have stored_analyses populated (P0-1 fix)', () => {
    const db = openRo();
    try {
      const row = db.prepare('SELECT COUNT(*) as c FROM stored_analyses').get() as { c: number };
      expect(row.c, 'stored_analyses must have >= 1 row').toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('should have hunter_pick_tracking populated (P0-2 fix)', () => {
    const db = openRo();
    try {
      const row = db
        .prepare('SELECT COUNT(*) as c FROM hunter_pick_tracking')
        .get() as { c: number };
      expect(row.c, 'hunter_pick_tracking must have >= 1 row').toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('should have no false TARGET_HITs from maker_fuel_exhausted (HELI fix)', () => {
    const db = openRo();
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) as c FROM predictions
           WHERE exit_type = 'maker_fuel_exhausted'
             AND status = 'TARGET_HIT'
             AND highest_price_reached < target_price - 0.01`
        )
        .get() as { c: number };
      expect(row.c, 'found false TARGET_HITs from maker_fuel_exhausted').toBe(0);
    } finally {
      db.close();
    }
  });

  it('should have the expected columns on predictions (no schema drift)', () => {
    const db = openRo();
    try {
      const cols = db.prepare('PRAGMA table_info(predictions)').all() as { name: string }[];
      const names = new Set(cols.map((c) => c.name));
      const required = [
        'ticker',
        'prediction_date',
        'persona',
        'entry_price',
        'target_price',
        'stop_loss',
        'status',
        'exit_type',
        'highest_price_reached',
        'market',
        'created_at',
      ];
      for (const col of required) {
        expect(names.has(col), `predictions must have column "${col}"`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('should not have predictions with prediction_date in the future', () => {
    // Anomaly detection: prediction_date must not be later than today + 1 day
    // (allow 1-day grace for timezone differences).
    const db = openRo();
    try {
      const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const row = db
        .prepare('SELECT COUNT(*) as c FROM predictions WHERE prediction_date > ?')
        .get(tomorrow) as { c: number };
      // Allow up to 5 (some pipelines might pre-generate next-day predictions).
      expect(row.c, `${row.c} predictions have future dates > ${tomorrow}`).toBeLessThanOrEqual(5);
    } finally {
      db.close();
    }
  });

  it('should have all TARGET_HIT predictions with target_price > 0', () => {
    const db = openRo();
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) as c FROM predictions
           WHERE status = 'TARGET_HIT' AND (target_price IS NULL OR target_price <= 0)`
        )
        .get() as { c: number };
      expect(row.c, 'TARGET_HIT predictions must have valid target_price').toBe(0);
    } finally {
      db.close();
    }
  });
});
