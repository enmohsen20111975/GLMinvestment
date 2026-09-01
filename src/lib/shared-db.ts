/**
 * shared-db.ts — Robust SQLite access for databases shared with the Python service.
 *
 * PROBLEM:
 *   The Python Flask service (port 8010) and the Next.js app both access the same
 *   .db files. Python writes in WAL mode, leaving uncommitted pages in the -wal file.
 *   When Next.js opens these DBs with `readonly: true`, better-sqlite3 cannot
 *   reconcile the WAL → "file is not a database" / "disk I/O error" at prepare() time.
 *
 * SOLUTION:
 *   Open the DBs in READ-WRITE mode (so SQLite can reconcile the WAL), set a high
 *   busy_timeout, and retry on transient lock errors. We never actually write to the
 *   shared data DBs (data_engine.db / stocks.db) — read-write mode is only used so
 *   the WAL can be applied. For predictions.db (which Next.js owns) read-write is native.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import { existsSync, copyFileSync, mkdirSync } from 'fs';

// Cache open connections per absolute path (process-wide)
const _cache = new Map<string, Database.Database>();

const SHARED_DB_NAMES = new Set([
  'data_engine.db',
  'stocks.db',
  'price_history.db',
  'historical.db',
  'intraday.db',
]);

// DBs that are written by BOTH Next.js and Python backend.
// These must NOT be cached because the Python backend's writes invalidate
// the cached connection, causing segfaults when reused.
const NO_CACHE_DB_NAMES = new Set([
  'predictions.db',
]);

/** Transient errors that warrant a retry. */
function isTransientError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err);
  return (
    msg.includes('file is not a database') ||
    msg.includes('disk I/O error') ||
    msg.includes('database is locked') ||
    msg.includes('SQLITE_BUSY') ||
    msg.includes('SQLITE_NOTADB') ||
    msg.includes('SQLITE_IOERR')
  );
}

export interface OpenOptions {
  /** Force read-write even for shared DBs (needed if you want to checkpoint). */
  writable?: boolean;
  /** Override the busy timeout (ms). Default 10000. */
  busyTimeoutMs?: number;
}

/**
 * Open a SQLite database robustly, handling WAL contention with the Python service.
 *
 * Strategy:
 *   1. For SHARED DBs (data_engine.db, stocks.db, etc.): open READ-WRITE so the WAL
 *      can be reconciled. We never write to them — read-write mode just lets SQLite
 *      apply the WAL journal. Retries on transient errors.
 *   2. For Next.js-owned DBs (predictions.db, auth.db): open READ-WRITE normally.
 *   3. Caches the connection per path for the process lifetime.
 */
export function openDb(dbName: string, options?: OpenOptions): Database.Database {
  const inputBaseName = path.basename(dbName);
  const candidates = [
    path.isAbsolute(dbName) ? dbName : null,
    `/home/meme/my_apps/GLMinvestment/db/${inputBaseName}`,
    path.join(process.cwd(), 'db', inputBaseName),
    path.resolve('db', inputBaseName),
    `\\\\wsl.localhost\\Ubuntu\\home\\meme\\my_apps\\GLMinvestment\\db\\${inputBaseName}`,
    dbName,
  ].filter(Boolean) as string[];
  let absPath = candidates[0];
  for (const c of candidates) {
    if (c && typeof c === 'string' && existsSync(c)) {
      absPath = c;
      break;
    }
  }

  const baseName = path.basename(absPath);
  const noCache = NO_CACHE_DB_NAMES.has(baseName);

  const cacheKey = absPath;
  if (!noCache) {
    const cached = _cache.get(cacheKey);
    if (cached) {
      try {
        cached.prepare('SELECT 1').get();
        return cached;
      } catch {
        // Stale connection — drop and reopen
        try { cached.close(); } catch { /* ignore */ }
        _cache.delete(cacheKey);
      }
    }
  }

  if (!existsSync(absPath)) {
    throw new Error(`[shared-db] Database not found: ${absPath}`);
  }

  const busyTimeout = options?.busyTimeoutMs ?? 10000;
  const isShared = SHARED_DB_NAMES.has(path.basename(absPath));

  const tryOpen = (readonly: boolean): Database.Database => {
    const db = new Database(absPath, { readonly, timeout: busyTimeout });
    db.pragma(`busy_timeout = ${busyTimeout}`);
    if (!readonly) {
      // Match the Python service's journal mode so WAL is reconciled correctly
      try { db.pragma('journal_mode = WAL'); } catch { /* ignore */ }
    }
    return db;
  };

  const tryOpenImmutable = (): Database.Database => {
    // IMPORTANT: better-sqlite3 v12 does NOT support `{ immutable: true }` or
    // `{ mode: 'immutable' }` — both options are silently IGNORED (the DB opens
    // in default read-write mode, which fails the SAME way as the primary
    // attempt when the WAL is mid-checkpoint by the Python service). The
    // better-sqlite3 native binding (src/objects/database.cpp) only ever passes
    // SQLITE_OPEN_READONLY / SQLITE_OPEN_READWRITE / SQLITE_OPEN_CREATE to
    // sqlite3_open_v2() — it never sets SQLITE_OPEN_URI, so even the
    // `file:path?immutable=1` URI form doesn't work.
    //
    // The fallback used to copy ONLY the main .db file to a snapshot and open
    // that. That is WRONG for a WAL-mode database: committed transactions live
    // in the -wal sidecar until they are checkpointed, so a copy of the main
    // file alone can show stale or EMPTY data (zero tables) even though the
    // real database is perfectly healthy. That is exactly what produced the
    // false "corrupted" / "empty" status. To get a consistent, readable snapshot
    // we must copy the whole WAL set (main file + -wal + -shm) together, which
    // lets SQLite reconcile the WAL when the snapshot is opened.
    const snapName = `node-readonly-snapshot-${process.pid}-${path.basename(absPath)}`;
    const snapDir = path.join(os.tmpdir(), 'glminvestment-snapshots');
    try { mkdirSync(snapDir, { recursive: true }); } catch { /* ignore */ }
    const snapPath = path.join(snapDir, snapName);
    const sidecars = [`${absPath}-wal`, `${absPath}-shm`];
    try {
      copyFileSync(absPath, snapPath);
      for (const sc of sidecars) {
        try { copyFileSync(sc, `${snapPath}${sc.slice(absPath.length)}`); } catch { /* no sidecar yet */ }
      }
    } catch (copyErr) {
      throw new Error(
        `[shared-db] snapshot copy failed for ${absPath}: ${String((copyErr as Error).message)}`
      );
    }
    // Open read-write so SQLite reconciles the copied WAL into the snapshot
    // (no other process touches the snapshot, so writing only applies the WAL).
    const db = new Database(snapPath, { readonly: false, timeout: busyTimeout });
    try { db.pragma(`busy_timeout = ${busyTimeout}`); } catch { /* ignore */ }
    return db;
  };

  let db: Database.Database;
  let lastErr: unknown;

  // Try up to 4 times with backoff for transient WAL/lock errors
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (isShared && !options?.writable) {
        // Shared DB: read-write so WAL reconciles (we never actually write).
        // If read-write fails for ANY reason (transient WAL contention OR
        // permissions), immediately try readonly on the same attempt —
        // readonly doesn't reconcile the WAL but often succeeds when
        // read-write can't, and a successful readonly is strictly better
        // than retrying read-write 4 times then falling to immutable.
        try {
          db = tryOpen(false);
        } catch (err) {
          try {
            db = tryOpen(true);
          } catch (roErr) {
            // Both read-write and readonly failed on this attempt —
            // throw the original error so the loop can retry/immutable.
            throw err;
          }
        }
      } else {
        db = tryOpen(false);
      }
      // Smoke-test the connection
      db.prepare('SELECT 1').get();
      if (!noCache) _cache.set(cacheKey, db);
      return db;
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) break;
      // Backoff: 50ms, 150ms, 400ms
      const backoff = 50 * Math.pow(3, attempt);
      const start = Date.now();
      while (Date.now() - start < backoff) { /* busy wait */ }
    }
  }

  // Last-resort fallback: immutable mode (bypasses WAL entirely).
  // This catches the case where read-write + readonly both fail because the
  // -wal / -shm files are in an unreconcilable state (e.g. mid-checkpoint by
  // the Python service, or a stale connection in this process is holding a
  // corrupted view). immutable opens the main DB file directly and never
  // touches the WAL, so it succeeds even when the other modes can't.
  try {
    db = tryOpenImmutable();
    db.prepare('SELECT 1').get();
    if (!noCache) _cache.set(cacheKey, db);
    return db;
  } catch (immErr) {
    // immutable also failed — give up and report the original error
    throw new Error(
      `[shared-db] Failed to open ${absPath} after retries + immutable fallback. ` +
      `Original: ${String((lastErr as Error)?.message || lastErr)}. ` +
      `Immutable: ${String((immErr as Error)?.message || immErr)}`
    );
  }
}

/** Convenience: get predictions.db (Next.js-owned). */
export function getPredictionsDb(): Database.Database {
  return openDb('predictions.db');
}

/** Convenience: get data_engine.db (shared with Python — read-write for WAL reconcile). */
export function getDataEngineDb(): Database.Database {
  return openDb('data_engine.db');
}

/** Convenience: get stocks.db (shared with Python). */
export function getStocksDb(): Database.Database {
  return openDb('stocks.db');
}

/** Run a read query with automatic retry on transient WAL errors. */
export function safeQuery<T = any>(
  db: Database.Database,
  sql: string,
  params: any[] = []
): T[] {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return db.prepare(sql).all(...params) as T[];
    } catch (err) {
      if (!isTransientError(err) || attempt === 2) throw err;
      const backoff = 50 * Math.pow(3, attempt);
      const start = Date.now();
      while (Date.now() - start < backoff) { /* busy wait */ }
    }
  }
  return [];
}

/** Run a read query returning a single row, with retry. */
export function safeQueryOne<T = any>(
  db: Database.Database,
  sql: string,
  params: any[] = []
): T | undefined {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return db.prepare(sql).get(...params) as T | undefined;
    } catch (err) {
      if (!isTransientError(err) || attempt === 2) throw err;
      const backoff = 50 * Math.pow(3, attempt);
      const start = Date.now();
      while (Date.now() - start < backoff) { /* busy wait */ }
    }
  }
  return undefined;
}
