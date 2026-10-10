/**
 * last-active-helper.ts — Bypass Prisma 5.22.0 SQLite DateTime write bug.
 *
 * ROOT CAUSE (P0):
 *   Prisma 5.22.0's SQLite query engine writes `DateTime?` columns as
 *   millisecond timestamps (e.g. "1791063186058") but reads them back
 *   expecting ISO strings. This means EVERY Prisma write to `last_active_at`
 *   creates a value that Prisma itself cannot read → P2023 on every
 *   subsequent User query → login, /api/auth/me, notifications, etc.
 *   all fail with 503/401.
 *
 * FIX:
 *   Write `last_active_at` directly via better-sqlite3 (which stores
 *   ISO strings correctly) instead of going through Prisma. Reads still
 *   use Prisma (they work fine once the stored value is a valid ISO string).
 *
 *   This is a targeted workaround for the Prisma engine bug — it does NOT
 *   change the schema, the model, or any other write path.
 */

import Database from 'better-sqlite3';
import { join } from 'path';

let _db: Database.Database | null = null;

function getAuthSqlite(): Database.Database {
  if (_db) return _db;
  const dbPath = join(process.cwd(), 'db', 'auth.db');
  _db = new Database(dbPath, { readonly: false });
  return _db;
}

/**
 * Update User.last_active_at with an ISO string, bypassing Prisma's
 * millisecond-timestamp write bug. Fire-and-forget — never awaited.
 */
export function updateLastActiveRaw(userId: string): void {
  if (!userId) return;
  try {
    const sqlite = getAuthSqlite();
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE "User" SET last_active_at = ? WHERE id = ?').run(now, userId);
  } catch { // silent fallback (safe-by-design)
    // Non-fatal — tracking must never break auth.
  }
}

/**
 * Fix any existing corrupted last_active_at values (millisecond timestamps
 * stored as text) by converting them to ISO strings.
 * Idempotent — safe to call on every boot.
 */
export function repairLastActiveAt(): number {
  try {
    const sqlite = getAuthSqlite();
    // Find rows where last_active_at is a numeric string > 10 chars (ms timestamp)
    const badRows = sqlite.prepare(
      'SELECT id, last_active_at FROM "User" WHERE last_active_at IS NOT NULL AND typeof(last_active_at) = \'text\' AND CAST(last_active_at AS INTEGER) > 1000000000000'
    ).all() as { id: string; last_active_at: string }[];

    let fixed = 0;
    for (const row of badRows) {
      const ms = parseInt(row.last_active_at, 10);
      if (isNaN(ms)) continue;
      const iso = new Date(ms).toISOString();
      sqlite.prepare('UPDATE "User" SET last_active_at = ? WHERE id = ?').run(iso, row.id);
      fixed++;
    }
    return fixed;
  } catch { // silent fallback (safe-by-design)
    return 0;
  }
}