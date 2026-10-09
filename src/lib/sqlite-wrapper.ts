/**
 * sqlite-wrapper.ts — SQLite database access with fallback support.
 * 
 * Primary: better-sqlite3 (native, faster)
 * Fallback: sql.js (WASM-based, works everywhere)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'fs';
import { join, dirname } from 'path';

// Fix database file permissions
function fixDbPermissions(dbPath: string): void {
  try {
    if (existsSync(dbPath)) {
      chmodSync(dbPath, 0o666);
    }
    // Also fix WAL and SHM files
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (existsSync(walPath)) chmodSync(walPath, 0o666);
    if (existsSync(shmPath)) chmodSync(shmPath, 0o666);
    // Fix directory permissions
    const dir = dirname(dbPath);
    chmodSync(dir, 0o777);
  } catch (e) {
    // Ignore permission errors - might be running as root or different user
    console.log('[sqlite-wrapper] Note: Could not fix permissions for', dbPath);
  }
}

// ===========================================================================
// TYPES
// ===========================================================================

export interface DatabaseOptions {
  readonly?: boolean;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): RunResult;
}

export interface SqliteDatabase {
  prepare(sql: string): Statement;
  run(sql: string, ...params: unknown[]): RunResult;
  pragma(cmd: string): unknown[];
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
  save(): void;
}

// ===========================================================================
// GLOBAL STATE
// ===========================================================================

const _cacheKey = '__egx_sqlite_v4_' + (typeof process !== 'undefined' ? process.pid : 0);
let _betterSqlite3: typeof import('better-sqlite3') | null = null;
let _sqlJs: typeof import('sql.js') | null = null;
let _useSqlJs = false;
let _initialized = false;

// ===========================================================================
// INITIALIZATION
// ===========================================================================

export function isUsingSqlJs(): boolean {
  return _useSqlJs;
}

export function isInitialized(): boolean {
  return _initialized;
}

/**
 * Initialize SQLite - tries better-sqlite3 first, falls back to sql.js
 */
export async function initialize(): Promise<void> {
  if (_initialized) return;

  // Try better-sqlite3 first
  try {
    _betterSqlite3 = require('better-sqlite3');
    _useSqlJs = false;
    _initialized = true;
    (globalThis as Record<string, unknown>)[_cacheKey] = { type: 'better-sqlite3' };
    console.log('[sqlite-wrapper] ✓ Initialized better-sqlite3');
    return;
  } catch { // silent fallback (safe-by-design)
    console.log('[sqlite-wrapper] better-sqlite3 not available, trying sql.js...');
  }

  // Fallback to sql.js
  try {
    const initSqlJs = require('sql.js');
    _sqlJs = await initSqlJs();
    _useSqlJs = true;
    _initialized = true;
    (globalThis as Record<string, unknown>)[_cacheKey] = { type: 'sql.js' };
    console.log('[sqlite-wrapper] ✓ Initialized sql.js (fallback mode)');
    return;
  } catch (err) {
    console.error('[sqlite-wrapper] ✗ Failed to initialize any SQLite:', err);
    throw new Error(`[sqlite-wrapper] Failed to initialize SQLite: ${(err as Error).message}`);
  }
}

// ===========================================================================
// DATABASE CREATION
// ===========================================================================

export function createDatabase(dbPath: string, options?: DatabaseOptions): SqliteDatabase {
  const isReadonly = options?.readonly === true;

  // Ensure directory exists for new databases
  if (!isReadonly && !existsSync(dbPath)) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Use better-sqlite3 if available
  if (_betterSqlite3 && !_useSqlJs) {
    return createBetterSqlite3Database(dbPath, isReadonly);
  }

  // Use sql.js as fallback
  if (_sqlJs) {
    return createSqlJsDatabase(dbPath, isReadonly);
  }

  throw new Error('[sqlite-wrapper] SQLite not initialized. Call initialize() first.');
}

// ===========================================================================
// BETTER-SQLITE3 IMPLEMENTATION
// ===========================================================================

function createBetterSqlite3Database(dbPath: string, isReadonly: boolean): SqliteDatabase {
  const Database = _betterSqlite3!;
  
  // Fix permissions before opening
  if (!isReadonly) {
    fixDbPermissions(dbPath);
  }
  
  let db: ReturnType<typeof Database>;
  
  if (isReadonly) {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } else {
    db = new Database(dbPath);
  }

  if (!isReadonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // FIX July 2026: busy_timeout = 30s to prevent 'database is locked'
    db.pragma('busy_timeout = 30000');
  }

  console.log(`[sqlite-wrapper] Opened database (better-sqlite3): ${dbPath}`);

  return {
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        get(...params: unknown[]): Record<string, unknown> | undefined {
          return stmt.get(...params) as Record<string, unknown> | undefined;
        },
        all(...params: unknown[]): Record<string, unknown>[] {
          return stmt.all(...params) as Record<string, unknown>[];
        },
        run(...params: unknown[]): RunResult {
          const result = stmt.run(...params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
      };
    },
    run(sql: string, ...params: unknown[]): RunResult {
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    pragma(cmd: string): unknown[] {
      return db.pragma(cmd) as unknown[];
    },
    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      return db.transaction(fn) as (...args: unknown[]) => T;
    },
    close(): void {
      db.close();
    },
    save(): void {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* safe-by-design */ }
    },
  };
}

// ===========================================================================
// SQL.JS IMPLEMENTATION
// ===========================================================================

function createSqlJsDatabase(dbPath: string, isReadonly: boolean): SqliteDatabase {
  const SQL = _sqlJs!;
  
  // Load existing database or create new one
  let db: ReturnType<typeof SQL.Database>;
  
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
    console.log(`[sqlite-wrapper] Opened database (sql.js): ${dbPath}`);
  } else if (!isReadonly) {
    db = new SQL.Database();
    console.log(`[sqlite-wrapper] Created database (sql.js): ${dbPath}`);
  } else {
    throw new Error(`[sqlite-wrapper] Database not found: ${dbPath}`);
  }

  // Track the path for saving
  const _dbPath = dbPath;

  return {
    prepare(sql: string): Statement {
      return {
        get(...params: unknown[]): Record<string, unknown> | undefined {
          const stmt = db.prepare(sql);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row as Record<string, unknown>;
          }
          stmt.free();
          return undefined;
        },
        all(...params: unknown[]): Record<string, unknown>[] {
          const results: Record<string, unknown>[] = [];
          const stmt = db.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject() as Record<string, unknown>);
          }
          stmt.free();
          return results;
        },
        run(...params: unknown[]): RunResult {
          db.run(sql, params);
          return { changes: db.getRowsModified(), lastInsertRowid: BigInt(db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] || 0) };
        },
      };
    },
    run(sql: string, ...params: unknown[]): RunResult {
      db.run(sql, params as unknown[]);
      return { changes: db.getRowsModified(), lastInsertRowid: 0n };
    },
    pragma(cmd: string): unknown[] {
      const result = db.exec(`PRAGMA ${cmd}`);
      if (result.length > 0 && result[0].values) {
        return result[0].values.map(row => {
          const obj: Record<string, unknown> = {};
          result[0].columns.forEach((col, i) => {
            obj[col] = row[i];
          });
          return obj;
        });
      }
      return [];
    },
    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      return (...args: unknown[]) => {
        db.run("BEGIN TRANSACTION");
        try {
          const result = fn(...args);
          db.run("COMMIT");
          return result;
        } catch (e) {
          db.run("ROLLBACK");
          throw e;
        }
      };
    },
    close(): void {
      // Save before closing
      const data = db.export();
      const buffer = Buffer.from(data);
      writeFileSync(_dbPath, buffer);
      db.close();
    },
    save(): void {
      if (!isReadonly) {
        const data = db.export();
        const buffer = Buffer.from(data);
        writeFileSync(_dbPath, buffer);
      }
    },
  };
}
