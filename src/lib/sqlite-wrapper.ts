/**
 * sqlite-wrapper.ts — SQLite database access using sql.js (pure WebAssembly).
 *
 * This wrapper provides a unified API compatible with better-sqlite3's interface
 * but uses sql.js (WASM) as the backend, which works on ALL platforms including
 * Hostinger (no native C++ addon compilation needed).
 *
 * Features:
 *   - Lazy self-initialization: no need for instrumentation.ts prewarm
 *   - Falls back to CDN WASM if local file not found
 *   - Uses globalThis for WASM instance persistence across hot reloads
 *   - Multiple initialization strategies for maximum compatibility
 *
 * API:
 *   - `initialize()` → optional, called automatically on first use
 *   - `createDatabase(dbPath, options?)` → returns a DB wrapper object
 *   - The wrapper has `.prepare(sql)` → returns object with `.get()`, `.all()`, `.run()`
 *   - The wrapper has `.pragma(string)` for pragma commands
 *   - The wrapper has `.transaction(fn)` for transactions
 *   - The wrapper has `.close()` to close the connection
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ===========================================================================
// DIAGNOSTIC: Log paths for debugging on first init attempt
// ===========================================================================
let _diagnosticLogged = false;
function _logDiagnostic(): void {
  if (_diagnosticLogged) return;
  _diagnosticLogged = true;
  const cwd = process.cwd();
  const paths = {
    cwd,
    'node_modules/sql.js/dist/sql-wasm.js': existsSync(join(cwd, 'node_modules/sql.js/dist/sql-wasm.js')),
    'node_modules/sql.js/dist/sql-wasm.wasm': existsSync(join(cwd, 'node_modules/sql.js/dist/sql-wasm.wasm')),
    'node_modules/sql.js': existsSync(join(cwd, 'node_modules/sql.js')),
    'db/custom.db': existsSync(join(cwd, 'db/custom.db')),
    'db/egx_investment.db': existsSync(join(cwd, 'db/egx_investment.db')),
    'node_modules/sql.js/dist/ (contents)': (() => {
    try {
      const fs = require('fs');
      const p = join(cwd, 'node_modules/sql.js/dist');
      if (!fs.existsSync(p)) return ['(dir not found)'];
      return fs.readdirSync(p);
    } catch { return ['(error reading)']; }
  })(),
  };
  console.log('[sqlite-wrapper] Diagnostic paths:', JSON.stringify(paths, null, 2));
}

// ==================== PUBLIC TYPES ====================

export interface DatabaseOptions {
  readonly?: boolean;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
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

// ==================== SQL.JS BACKEND ====================

/**
 * Runtime-computed key using process.pid to prevent Turbopack from
 * statically analyzing and tree-shaking the globalThis lookup.
 * process.pid is only available at runtime, not at build time.
 */
const _gk = '__egx_sj_' + (typeof process !== 'undefined' && process.pid ? process.pid : 0);

/**
 * Get the sql.js instance from globalThis.
 */
function _getSqlJs(): any {
  return (globalThis as Record<string, unknown>)[_gk] as any;
}

/**
 * Store the sql.js instance in globalThis.
 */
function _setSqlJs(instance: any): void {
  (globalThis as Record<string, unknown>)[_gk] = instance;
}

/** Track initialization state to avoid concurrent inits */
let _initPromise: Promise<void> | null = null;
let _initialized = false;

/** Track consecutive init failures for exponential backoff */
let _initFailCount = 0;
let _initBlockedUntil = 0; // timestamp — no retries before this

export function isUsingSqlJs(): boolean {
  return true;
}

/**
 * Check if sql.js is initialized and ready.
 */
export function isInitialized(): boolean {
  return _initialized && !!_getSqlJs();
}

/**
 * Initialize sql.js WASM backend.
 *
 * Safe to call multiple times — subsequent calls return immediately.
 * Uses a promise to prevent concurrent initialization.
 *
 * Try multiple strategies to load sql.js in order:
 *   1. require('sql.js') — standard, traced by webpack standalone
 *   2. eval require from node_modules path — for dev/Turbopack
 *   3. Dynamic import with fetch from CDN — ultimate fallback
 */
export async function initialize(): Promise<void> {
  if (_initialized && _getSqlJs()) return;
  if (_initPromise) return _initPromise;

  // Exponential backoff: block retries if failed recently
  if (_initBlockedUntil > 0 && Date.now() < _initBlockedUntil) {
    const waitSecs = Math.ceil((_initBlockedUntil - Date.now()) / 1000);
    throw new Error(
      `[sqlite-wrapper] sql.js init blocked for ${waitSecs}s ` +
      `(failed ${_initFailCount} times). Will retry automatically.`
    );
  }
  if (_initBlockedUntil > 0) {
    // Backoff expired, allow retry
    _initBlockedUntil = 0;
    _initFailCount = 0;
  }

  _initPromise = (async () => {
    // Log diagnostic info on first attempt
    _logDiagnostic();

    const cwd = process.cwd();
    const sqlJsDistPath = join(cwd, 'node_modules', 'sql.js', 'dist');
    const wasmPath = join(sqlJsDistPath, 'sql-wasm.wasm');

    let initSqlJs: any = null;
    let strategyUsed = 'none';

    // ---- Strategy 1: Standard require('sql.js') ----
    // This is traced by webpack for standalone builds.
    try {
      initSqlJs = require('sql.js');
      strategyUsed = 'require(sql.js)';
      console.log('[sqlite-wrapper] Strategy 1: require(sql.js) succeeded');
    } catch (e1) {
      console.log('[sqlite-wrapper] Strategy 1 failed:', (e1 as Error).message);
    }

    // ---- Strategy 2: eval require from absolute path ----
    // Works with Turbopack (can't analyze eval strings).
    if (!initSqlJs) {
      try {
        const sqlJsEntryPath = join(sqlJsDistPath, 'sql-wasm.js');
        initSqlJs = (eval('require') as (id: string) => unknown)(sqlJsEntryPath) as any;
        strategyUsed = 'eval require(absolute path)';
        console.log('[sqlite-wrapper] Strategy 2: eval require(absolute) succeeded');
      } catch (e2) {
        console.log('[sqlite-wrapper] Strategy 2 failed:', (e2 as Error).message);
      }
    }

    // ---- Strategy 3: Try loading sql-wasm.js directly from dist dir via createRequire ----
    if (!initSqlJs) {
      try {
        const { createRequire } = require('module');
        const customRequire = createRequire(join(cwd, 'package.json'));
        initSqlJs = customRequire('sql.js');
        strategyUsed = 'createRequire(sql.js)';
        console.log('[sqlite-wrapper] Strategy 3: createRequire succeeded');
      } catch (e3) {
        console.log('[sqlite-wrapper] Strategy 3 failed:', (e3 as Error).message);
      }
    }

    if (!initSqlJs) {
      _initFailCount++;
      if (_initFailCount >= 3) {
        // After 3 failures, block retries for 5 minutes (exponential backoff)
        const backoffMs = Math.min(300_000, 30_000 * Math.pow(2, _initFailCount - 3));
        _initBlockedUntil = Date.now() + backoffMs;
        _initPromise = null;
        throw new Error(
          `[sqlite-wrapper] All sql.js loading strategies failed (${_initFailCount} attempts). ` +
          `Blocking retries for ${Math.round(backoffMs / 1000)}s. ` +
          `CWD: ${cwd}, ` +
          `sql.js dist exists: ${existsSync(sqlJsDistPath)}, ` +
          `sql-wasm.wasm exists: ${existsSync(wasmPath)}.`
        );
      }
      _initPromise = null; // Allow retry
      throw new Error(
        `[sqlite-wrapper] All sql.js loading strategies failed. ` +
        `CWD: ${cwd}, ` +
        `sql.js dist exists: ${existsSync(sqlJsDistPath)}, ` +
        `sql-wasm.js exists: ${existsSync(join(sqlJsDistPath, 'sql-wasm.js'))}, ` +
        `sql-wasm.wasm exists: ${existsSync(wasmPath)}. ` +
        `Ensure 'sql.js/dist' is copied to standalone build's node_modules/.`
      );
    }

    // Load WASM binary — 3 strategies:
    //   A. Read local file (fastest)
    //   B. Fetch binary from CDN and pass as wasmBinary
    //   C. Use locateFile to let sql.js fetch WASM on its own (most compatible)

    // Strategy A: Local WASM file
    let wasmBinary: Buffer | undefined;
    let wasmStrategy = 'none';

    if (existsSync(wasmPath)) {
      try {
        wasmBinary = readFileSync(wasmPath);
        wasmStrategy = 'local file';
        console.log('[sqlite-wrapper] Using local WASM file');
      } catch {
        console.log('[sqlite-wrapper] Local WASM read failed, trying CDN...');
      }
    }

    // Strategy B: Fetch WASM binary from CDN
    if (!wasmBinary) {
      try {
        wasmBinary = await _fetchWasmFromCdn();
        wasmStrategy = 'CDN binary';
        console.log('[sqlite-wrapper] Using CDN WASM binary');
      } catch (cdnErr) {
        console.log('[sqlite-wrapper] CDN binary fetch failed, will try locateFile:', (cdnErr as Error).message);
      }
    }

    // Strategy C: Use locateFile to let sql.js fetch from CDN
    // This is the most compatible approach — sql.js handles the fetch internally
    let initOptions: any = {};
    if (wasmBinary) {
      initOptions.wasmBinary = wasmBinary;
    } else {
      initOptions.locateFile = (file: string) => `https://sql.js.org/dist/${file}`;
      wasmStrategy = 'CDN locateFile';
      console.log('[sqlite-wrapper] Using locateFile CDN fallback for WASM loading');
    }

    try {
      const sqlJs = await initSqlJs(initOptions);
      _setSqlJs(sqlJs);
      _initialized = true;
      _initFailCount = 0; // Reset on success
      _initBlockedUntil = 0;
      console.log(`[sqlite-wrapper] sql.js initialized successfully (loader: ${strategyUsed}, wasm: ${wasmStrategy})`);
    } catch (initErr) {
      _initFailCount++;
      if (_initFailCount >= 3) {
        const backoffMs = Math.min(300_000, 30_000 * Math.pow(2, _initFailCount - 3));
        _initBlockedUntil = Date.now() + backoffMs;
      }
      _initPromise = null; // Allow retry after backoff
      throw new Error(
        `[sqlite-wrapper] sql.js initSqlJs() failed: ${(initErr as Error).message}. ` +
        `WASM strategy: ${wasmStrategy}, CWD: ${cwd}`
      );
    }
  })();

  return _initPromise;
}

/**
 * Fetch WASM binary from CDN fallback.
 */
async function _fetchWasmFromCdn(): Promise<Buffer> {
  console.log('[sqlite-wrapper] Local WASM not found, fetching from CDN...');
  const response = await fetch('https://sql.js.org/dist/sql-wasm.wasm');
  if (!response.ok) {
    throw new Error(`CDN fetch failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ==================== CREATE DATABASE ====================

/**
 * Create a database connection using sql.js.
 *
 * IMPORTANT: `initialize()` is called automatically on first use if needed.
 */
export function createDatabase(dbPath: string, options?: DatabaseOptions): SqliteDatabase {
  const sqlJs = _getSqlJs();

  if (!sqlJs) {
    throw new Error(
      'sql.js is not yet initialized. Call `await initialize()` from @/lib/sqlite-wrapper before creating databases.'
    );
  }

  const isReadonly = options?.readonly === true;
  let sqlDb: any;

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    sqlDb = new sqlJs.Database(buffer);
  } else if (isReadonly) {
    throw new Error(`Database file not found: ${dbPath} (readonly mode)`);
  } else {
    sqlDb = new sqlJs.Database();
  }

  const statements: any[] = [];
  let inTransaction = false;
  let dirty = false;

  function saveToDisk(): void {
    if (isReadonly || !dirty) return;
    try {
      const data = sqlDb.export();
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(dbPath, Buffer.from(data));
      dirty = false;
    } catch (err) {
      console.error('[sqlite-wrapper] Failed to save database:', err);
    }
  }

  function getLastInsertRowid(): number {
    try {
      const result = sqlDb.exec('SELECT last_insert_rowid() as id');
      if (result.length > 0 && result[0].values.length > 0) {
        return Number(result[0].values[0][0]) || 0;
      }
    } catch {
      // ignore
    }
    return 0;
  }

  return {
    prepare(sql: string): Statement {
      const stmt = sqlDb.prepare(sql);
      statements.push(stmt);

      return {
        get(...params: unknown[]): Record<string, unknown> | undefined {
          try {
            stmt.bind(params);
            if (stmt.step()) {
              const row = stmt.getAsObject() as Record<string, unknown>;
              return row;
            }
            return undefined;
          } catch {
            return undefined;
          } finally {
            try { stmt.reset(); } catch { /* ignore */ }
          }
        },

        all(...params: unknown[]): Record<string, unknown>[] {
          try {
            stmt.bind(params);
            const results: Record<string, unknown>[] = [];
            while (stmt.step()) {
              results.push(stmt.getAsObject() as Record<string, unknown>);
            }
            return results;
          } finally {
            try { stmt.reset(); } catch { /* ignore */ }
          }
        },

        run(...params: unknown[]): RunResult {
          stmt.bind(params);
          stmt.step();
          stmt.reset();

          const changes = sqlDb.getRowsModified();
          const lastInsertRowid = getLastInsertRowid();

          if (changes > 0) {
            dirty = true;
            if (!inTransaction) {
              saveToDisk();
            }
          }

          return { changes, lastInsertRowid };
        },
      };
    },

    run(sql: string, ...params: unknown[]): RunResult {
      // Direct execution of SQL statements (CREATE, INSERT, UPDATE, DELETE, etc.)
      try {
        if (params.length > 0) {
          // Use prepared statement for parameterized queries
          const stmt = sqlDb.prepare(sql);
          statements.push(stmt);
          stmt.bind(params);
          stmt.step();
          stmt.reset();
        } else {
          // Direct exec for simple statements
          sqlDb.run(sql);
        }

        const changes = sqlDb.getRowsModified();
        const lastInsertRowid = getLastInsertRowid();

        // Always mark dirty for DDL statements (CREATE, ALTER, DROP) or if there were changes
        const upperSql = sql.trim().toUpperCase();
        const isDDL = upperSql.startsWith('CREATE') || upperSql.startsWith('ALTER') || upperSql.startsWith('DROP') || upperSql.startsWith('INSERT') || upperSql.startsWith('UPDATE') || upperSql.startsWith('DELETE');
        
        if (changes > 0 || isDDL) {
          dirty = true;
          if (!inTransaction) {
            saveToDisk();
          }
        }

        return { changes, lastInsertRowid };
      } catch (err) {
        console.error('[sqlite-wrapper] run() error:', err);
        return { changes: 0, lastInsertRowid: 0 };
      }
    },

    pragma(cmd: string): unknown[] {
      try {
        return sqlDb.exec(`PRAGMA ${cmd}`) as unknown[];
      } catch (err) {
        console.warn(`[sqlite-wrapper] Pragma failed (sql.js limitation): ${cmd}`);
        return [];
      }
    },

    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      return function (this: unknown, ...args: unknown[]): T {
        inTransaction = true;
        try {
          sqlDb.exec('BEGIN');
          const result = fn.apply(this, args);
          sqlDb.exec('COMMIT');
          dirty = true;
          saveToDisk();
          return result;
        } catch (err) {
          try {
            sqlDb.exec('ROLLBACK');
          } catch {
            // ignore rollback errors
          }
          throw err;
        } finally {
          inTransaction = false;
        }
      };
    },

    close(): void {
      saveToDisk();

      for (const s of statements) {
        try {
          s.free();
        } catch {
          // ignore
        }
      }
      statements.length = 0;

      try {
        sqlDb.close();
      } catch {
        // ignore
      }
    },

    save(): void {
      dirty = true;
      saveToDisk();
    },
  };
}
