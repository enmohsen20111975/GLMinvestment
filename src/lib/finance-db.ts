/**
 * finance-db.ts — Writable database helper for financial tracking tables.
 *
 * IMPORTANT: This module now uses the SHARED custom.db singleton from egx-db.ts
 * to prevent dual-singleton data conflicts. Both admin operations (gold, currency)
 * and finance operations (portfolio, transactions) share the same DB connection.
 */

import { getSharedCustomDb, isSharedCustomDbAvailable, ensureInitialized } from '@/lib/egx-db';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

// ---------------------------------------------------------------------------
// Lazy singleton for writable custom.db connection (SHARED with egx-db.ts)
// ---------------------------------------------------------------------------

let _financeDbFailed = false;
let _financeFailedAt = 0;
const RETRY_DELAY_MS = 15_000;

/**
 * Get a writable connection to custom.db for financial tracking tables.
 * Uses the SAME singleton as getWritableLightDb() in egx-db.ts
 * to prevent data loss from dual-singleton conflicts.
 */
export async function getFinanceDb(): Promise<SqliteDatabase> {
  if (isSharedCustomDbAvailable()) {
    return getSharedCustomDb();
  }

  // Auto-retry after RETRY_DELAY_MS if previous attempt failed
  if (_financeDbFailed) {
    const elapsed = Date.now() - _financeFailedAt;
    if (elapsed < RETRY_DELAY_MS) {
      throw new Error('Finance DB (custom.db) is unavailable. Retrying in ' +
        Math.ceil((RETRY_DELAY_MS - elapsed) / 1000) + 's...');
    }
    _financeDbFailed = false;
  }

  try {
    const db = await getSharedCustomDb();
    return db;
  } catch (err) {
    _financeDbFailed = true;
    _financeFailedAt = Date.now();
    console.error('[finance-db] Failed to load custom.db:', err);
    throw new Error('Finance DB (custom.db) could not be loaded: ' +
      (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * Check if the finance DB is available.
 */
export function isFinanceDbAvailable(): boolean {
  return isSharedCustomDbAvailable();
}
