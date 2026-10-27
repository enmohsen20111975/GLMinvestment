/**
 * user-timestamp-helper.ts — Repair + defensive reader for Prisma 5.22.0 DateTime bug.
 *
 * ROOT CAUSE:
 *   Prisma 5.22.0's SQLite query engine writes `DateTime?` columns as
 *   millisecond timestamps (e.g. "1792334454208") but reads them back
 *   expecting ISO strings → PrismaClientKnownRequestError P2023 on every
 *   subsequent User query → login loop / 401 / 503.
 *
 * SCOPE:
 *   `last-active-helper.ts` already handles `last_active_at` writes via
 *   better-sqlite3. This module extends the same pattern to ALL User
 *   timestamp columns: created_at, last_login, updated_at, email_verified,
 *   last_active_at, trial_ends_at.
 *
 * PROVIDES:
 *   - repairAllUserTimestamps(): one-shot repair of any corrupted rows.
 *   - safeUserFindById(id, select): defensive reader that falls back to a
 *     raw better-sqlite3 query if Prisma throws P2023, then repairs the
 *     corrupted row(s) and retries Prisma once.
 *   - updateUserTimestampRaw(userId, column, value): raw SQL write that
 *     bypasses Prisma's write bug (stores ISO string directly).
 *
 * DESIGN:
 *   - Reads via Prisma are fine once data is clean. The defensive reader
 *     only kicks in on P2023 (column data inconsistency).
 *   - Writes via raw SQL are always safe (better-sqlite3 stores ISO strings
 *     as TEXT, which is what Prisma expects to read back).
 *   - All operations are idempotent and never throw (logging only).
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

let _db: Database.Database | null = null;

function getAuthSqlite(): Database.Database {
  if (_db) return _db;
  const dbPath = join(process.cwd(), 'db', 'auth.db');
  _db = new Database(dbPath, { readonly: false });
  return _db;
}

/** Columns that are DateTime? or DateTime in the Prisma schema. */
const TIMESTAMP_COLUMNS = [
  'created_at',
  'last_login',
  'updated_at',
  'email_verified',
  'last_active_at',
  'trial_ends_at',
  'trial_warning_sent_at',
  'trial_deletion_scheduled_at',
] as const;

type TimestampColumn = (typeof TIMESTAMP_COLUMNS)[number];

/**
 * Repair any corrupted timestamp rows (numeric ms stored as integer) by
 * converting them to ISO 8601 strings. Idempotent — safe to call on every
 * boot or on every read.
 *
 * @returns number of rows repaired across all columns
 */
export function repairAllUserTimestamps(): number {
  let totalFixed = 0;
  try {
    const sqlite = getAuthSqlite();
    for (const col of TIMESTAMP_COLUMNS) {
      // SQLite strftime converts ms → ISO directly inside the engine.
      // typeof() = 'integer' identifies the corrupted rows (ISO strings
      // are typeof() = 'text', NULL is typeof() = 'null').
      const result = sqlite
        .prepare(
          `UPDATE "User"
           SET "${col}" = strftime('%Y-%m-%dT%H:%M:%fZ', CAST("${col}" AS REAL) / 1000, 'unixepoch')
           WHERE typeof("${col}") = 'integer'`
        )
        .run();
      totalFixed += result.changes;
    }
  } catch (err) {
    console.error('[user-timestamp-helper] repairAllUserTimestamps failed:', err);
  }
  return totalFixed;
}

/**
 * Update a single User timestamp column via raw SQL (bypasses Prisma's
 * millisecond-timestamp write bug). Stores an ISO string directly.
 */
export function updateUserTimestampRaw(
  userId: string,
  column: TimestampColumn,
  value: Date | string | null
): void {
  if (!userId) return;
  try {
    const sqlite = getAuthSqlite();
    const iso = value === null ? null : value instanceof Date ? value.toISOString() : value;
    sqlite.prepare(`UPDATE "User" SET "${column}" = ? WHERE id = ?`).run(iso, userId);
  } catch (err) {
    console.error(`[user-timestamp-helper] updateUserTimestampRaw(${column}) failed:`, err);
  }
}

/**
 * Defensive reader: find a User by id. If Prisma throws P2023 (inconsistent
 * column data — the classic ms-timestamp bug), fall back to a raw
 * better-sqlite3 query, repair the corrupted row(s), and retry Prisma once.
 *
 * Returns the same shape as db.user.findUnique (with DateTime fields as
 * Date objects) so callers don't need to change their downstream code.
 *
 * @param id - User id (cuid or uuid)
 * @returns User object or null (never throws — logs on error)
 */
export async function safeUserFindById<T extends Record<string, unknown>>(
  id: string,
  select?: Prisma.UserSelect
): Promise<T | null> {
  return safeUserFind<T>({ id }, select);
}

/**
 * Defensive reader: find a User by email. Same P2023 recovery as
 * safeUserFindById.
 */
export async function safeUserFindByEmail<T extends Record<string, unknown>>(
  email: string,
  select?: Prisma.UserSelect
): Promise<T | null> {
  return safeUserFind<T>({ email }, select);
}

/**
 * Core defensive reader used by both safeUserFindById and safeUserFindByEmail.
 * `where` must contain either { id } or { email }.
 */
async function safeUserFind<T extends Record<string, unknown>>(
  where: { id?: string; email?: string },
  select?: Prisma.UserSelect
): Promise<T | null> {
  // Attempt 1: Prisma
  try {
    return (await db.user.findUnique({
      where,
      select,
    })) as T | null;
  } catch (err: unknown) {
    // Only handle Prisma P2023 (inconsistent column data). Other errors
    // (e.g. connection failure) should propagate to the caller's own
    // error handling.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2023') {
      console.error('[user-timestamp-helper] safeUserFind non-P2023 error:', err);
      throw err;
    }

    // P2023: a timestamp column holds a numeric ms value. Repair it.
    console.warn('[user-timestamp-helper] P2023 detected — repairing User timestamps');
    const fixed = repairAllUserTimestamps();
    console.warn(`[user-timestamp-helper] repaired ${fixed} corrupted row(s)`);

    // Attempt 2: retry Prisma after repair
    try {
      return (await db.user.findUnique({
        where,
        select,
      })) as T | null;
    } catch (retryErr) {
      // Still failing — fall back to raw query so the user isn't locked out.
      console.error('[user-timestamp-helper] Prisma retry failed, using raw query:', retryErr);
      const key = where.id ? 'id' : 'email';
      const val = where.id || where.email;
      if (!val) return null;
      return rawUserFindBy<T>(key, val, select);
    }
  }
}

/**
 * Raw better-sqlite3 fallback reader. Returns the row with DateTime fields
 * parsed back into Date objects (matching Prisma's return shape).
 *
 * @param key - 'id' or 'email'
 * @param val - the value to match
 */
function rawUserFindBy<T extends Record<string, unknown>>(
  key: 'id' | 'email',
  val: string,
  select?: Prisma.UserSelect
): T | null {
  try {
    const sqlite = getAuthSqlite();
    const columns = select
      ? Object.keys(select).filter((k) => select[k as keyof typeof select])
      : ['*'];

    const colList = columns.includes('*') ? '*' : columns.map((c) => `"${c}"`).join(', ');
    const row = sqlite.prepare(`SELECT ${colList} FROM "User" WHERE "${key}" = ?`).get(val) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    // Parse timestamp strings back to Date objects for the columns Prisma
    // would have returned as Date.
    const dateCols = new Set<string>([
      'created_at',
      'last_login',
      'updated_at',
      'email_verified',
      'last_active_at',
      'trial_ends_at',
      'trial_warning_sent_at',
      'trial_deletion_scheduled_at',
    ]);
    for (const [k, v] of Object.entries(row)) {
      if (dateCols.has(k) && typeof v === 'string') {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          row[k] = d;
        }
      }
    }
    return row as T;
  } catch (err) {
    console.error('[user-timestamp-helper] rawUserFindBy failed:', err);
    return null;
  }
}
