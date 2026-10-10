/**
 * finance-db.ts — Writable database helper for financial tracking tables.
 *
 * IMPORTANT: custom.db has been REMOVED. This module now uses stocks.db
 * for stock data operations. User-specific data should use Prisma with auth.db.
 */

import { getWritableDb, ensureInitialized } from '@/lib/egx-db';
import type { SqliteDatabase } from '@/lib/sqlite-wrapper';

// ---------------------------------------------------------------------------
// Get writable database connection
// ---------------------------------------------------------------------------

let _financeDbFailed = false;
let _financeFailedAt = 0;
const RETRY_DELAY_MS = 15_000;

/**
 * Get a writable connection to stocks.db for financial operations.
 * @deprecated custom.db has been removed. Uses stocks.db instead.
 */
export async function getFinanceDb(): Promise<SqliteDatabase> {
  // Auto-retry after RETRY_DELAY_MS if previous attempt failed
  if (_financeDbFailed) {
    const elapsed = Date.now() - _financeFailedAt;
    if (elapsed < RETRY_DELAY_MS) {
      throw new Error('Finance DB (stocks.db) is unavailable. Retrying in ' +
        Math.ceil((RETRY_DELAY_MS - elapsed) / 1000) + 's...');
    }
    _financeDbFailed = false;
  }

  try {
    await ensureInitialized();
    return getWritableDb();
  } catch (err) {
    _financeDbFailed = true;
    _financeFailedAt = Date.now();
    console.error('[finance-db] Failed to load stocks.db:', err);
    throw new Error('Finance DB (stocks.db) could not be loaded: ' +
      (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * Check if the finance DB is available.
 */
export function isFinanceDbAvailable(): boolean {
  try {
    getWritableDb();
    return true;
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}
