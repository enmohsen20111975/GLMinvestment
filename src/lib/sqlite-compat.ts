/**
 * SQLite Universal Compatibility Layer
 * ====================================
 * Auto-detects runtime and provides a better-sqlite3-compatible API:
 *   - Bun runtime → uses bun:sqlite (fastest, native)
 *   - Node.js runtime → uses better-sqlite3 (native C++ addon)
 *
 * CRITICAL: Uses eval('require') to prevent webpack from tracing
 * bun:sqlite and better-sqlite3 imports. Webpack cannot statically
 * analyze eval() calls, so it won't try to bundle these modules.
 *
 * Usage: Replace `import Database from 'better-sqlite3'` with
 *        `import { Database } from '@/lib/sqlite-compat'`
 */

// ===========================================================================
// RUNTIME DETECTION
// ===========================================================================

const isBun = typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined';

// ===========================================================================
// DATABASE CLASS
// ===========================================================================

export class Database {
  private _db: any;
  private _isBun: boolean;

  constructor(filename: string, options?: { readonly?: boolean; timeout?: number; create?: boolean }) {
    this._isBun = isBun;

    if (isBun) {
      // ── Bun path: use bun:sqlite ──
      // eval('require') prevents webpack from seeing "bun:sqlite"
      const BunDB = eval('require')('bun:sqlite').Database;
      const opts: { readonly?: boolean; create?: boolean } = {};
      if (options?.readonly) opts.readonly = true;
      if (options?.create !== false) opts.create = true;

      this._db = new BunDB(filename, opts);

      if (options?.timeout) {
        this._db.exec(`PRAGMA busy_timeout = ${options.timeout}`);
      }
    } else {
      // ── Node.js path: use better-sqlite3 ──
      // eval('require') prevents webpack from tracing this as a dependency
      // (it's resolved at runtime from node_modules)
      const BetterDB = eval('require')('better-sqlite3');
      this._db = new BetterDB(filename, options);
    }
  }

  /**
   * Prepare a statement — returns an object with get/all/run/bind methods.
   * bun:sqlite uses db.query(sql), better-sqlite3 uses db.prepare(sql).
   * Both return a Statement object with compatible get/all/run APIs.
   */
  prepare(sql: string): any {
    if (this._isBun) {
      return this._db.query(sql);
    }
    return this._db.prepare(sql);
  }

  /**
   * Execute raw SQL (no return value).
   */
  exec(sql: string): void {
    this._db.exec(sql);
  }

  /**
   * Execute a PRAGMA statement.
   * better-sqlite3: db.pragma('journal_mode = WAL') returns result array
   * bun:sqlite: no .pragma() method, so we use exec() + return empty array
   */
  pragma(pragmaStr: string): any[] {
    if (this._isBun) {
      this._db.exec(`PRAGMA ${pragmaStr}`);
      return [];
    }
    return this._db.pragma(pragmaStr);
  }

  /**
   * Force-save to disk (no-op in bun:sqlite, auto-flushes).
   */
  save(): void {
    // no-op — both runtimes auto-flush
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this._db.close();
  }

  /**
   * Get the underlying database for direct access.
   */
  get raw(): any {
    return this._db;
  }

  /**
   * Transaction support — delegates to the underlying DB.
   */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return this._db.transaction(fn) as (...args: unknown[]) => T;
  }

  /**
   * Open a backup — delegates to better-sqlite3, no-op in Bun.
   */
  backup(): any {
    if (this._isBun) {
      console.warn('[sqlite-compat] backup() not implemented in bun:sqlite');
      return this;
    }
    return this._db.backup();
  }

  /**
   * Database name (for debugging).
   */
  get name(): string {
    return this._isBun ? 'bun:sqlite' : 'better-sqlite3';
  }

  /**
   * Whether the database is open.
   */
  get open(): boolean {
    if (this._isBun) return true;
    return this._db.open;
  }
}

export default Database;
