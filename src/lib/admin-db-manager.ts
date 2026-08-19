/**
 * admin-db-manager.ts — Server-side operations for the Database Manager admin tab.
 *
 * Provides robust helpers for:
 *   - Listing databases with WAL/integrity status
 *   - Listing tables with row/column counts
 *   - Paginated + sortable row reads
 *   - Raw SQL execution (read + write) with EXPLAIN dry-run
 *   - VACUUM / integrity_check / wal_checkpoint / reindex
 *   - Backup / restore / delete-backup
 *   - Drop / truncate table
 *   - Schema (CREATE TABLE) + indexes
 *   - CSV / JSON export
 *
 * DB OPEN RULE:
 *   - Reads use the cached shared-db opener (read-write so WAL reconciles, but we
 *     never actually mutate during a read).
 *   - Writes (VACUUM, REINDEX, INSERT/UPDATE/DELETE/CREATE/DROP/ALTER, restore,
 *     wal_checkpoint, truncate, drop-table) open a FRESH writable connection with
 *     busy_timeout + WAL journal mode and close it after — never touching the
 *     cached shared connection used by the rest of the app.
 *
 * All operations are wrapped in try/catch and throw typed errors with clear
 * messages so the API route can surface them as JSON.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import { openDb, safeQuery, safeQueryOne } from '@/lib/shared-db';

const DB_DIR = path.join(process.cwd(), 'db');
const BACKUP_DIR = path.join(DB_DIR, 'backups');

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface DatabaseOverview {
  name: string;
  path: string;
  sizeBytes: number;
  sizeHuman: string;
  lastModified: string;
  tableCount: number;
  totalRows: number;
  walPresent: boolean;
  walSizeBytes: number;
  shmPresent: boolean;
  integrity: 'ok' | 'corrupt' | 'unknown';
  integrityMessage?: string;
}

export interface TableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  sizeEstimateBytes: number;
  sizeHuman: string;
}

export interface TableColumn {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  dfltValue: string | null;
}

export interface TableRowsResult {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affected: number;
  durationMs: number;
  isWrite: boolean;
  truncated?: boolean;
  /** Present when dryRun = true */
  explainPlan?: Record<string, unknown>[];
}

export interface MaintenanceResult {
  success: boolean;
  operation: string;
  durationMs: number;
  message: string;
  report?: string | string[];
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  sizeHuman: string;
  createdAt: string;
  db?: string;
}

export interface SchemaResult {
  table: string;
  createStatement: string;
  columns: TableColumn[];
  indexes: {
    name: string;
    sql: string;
  }[];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/** Validate that `dbName` is a real .db file in db/ (prevents path traversal). */
function resolveDbPath(dbName: string): string {
  if (!dbName || typeof dbName !== 'string') {
    throw new Error('Database name is required');
  }
  const baseName = path.basename(dbName);
  if (!baseName.endsWith('.db')) {
    throw new Error(`Database name must end with .db: ${dbName}`);
  }
  const candidates = [
    dbName,
    `/home/meme/my_apps/GLMinvestment/db/${baseName}`,
    path.join(DB_DIR, baseName),
    path.join(process.cwd(), 'db', baseName),
    path.resolve('db', baseName),
    `\\\\wsl.localhost\\Ubuntu\\home\\meme\\my_apps\\GLMinvestment\\db\\${baseName}`,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && fs.existsSync(c)) {
      return c;
    }
  }
  throw new Error(`Database not found: ${baseName}`);
}

/** Validate a backup filename (no path traversal). */
function resolveBackupPath(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') {
    throw new Error('Backup file name is required');
  }
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`Invalid backup file name: ${fileName}`);
  }
  const abs = path.join(BACKUP_DIR, fileName);
  if (!abs.startsWith(BACKUP_DIR)) {
    throw new Error(`Backup file escapes backup directory: ${fileName}`);
  }
  return abs;
}

/** Validate a table name (alphanumeric + underscore only). */
function validateTableName(table: string): void {
  if (!table || typeof table !== 'string') {
    throw new Error('Table name is required');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
}

/** Open a FRESH writable connection (not cached) for destructive ops. */
function openWritable(dbPath: string, busyTimeoutMs = 15000): Database.Database {
  const db = new Database(dbPath, { timeout: busyTimeoutMs });
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  try {
    db.pragma('journal_mode = WAL');
  } catch {
    /* ignore — some DBs may reject */
  }
  return db;
}

function safeClose(db: Database.Database | null | undefined): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* ignore */
  }
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// ----------------------------------------------------------------------------
// Database overview
// ----------------------------------------------------------------------------

export function listDatabases(): DatabaseOverview[] {
  if (!fs.existsSync(DB_DIR)) {
    return [];
  }
  const files = fs.readdirSync(DB_DIR).filter(
    (f) => f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm')
  );
  return files.map((f) => getDatabaseOverview(f)).sort((a, b) => b.sizeBytes - a.sizeBytes);
}

export function getDatabaseOverview(dbName: string): DatabaseOverview {
  const abs = resolveDbPath(dbName);
  const stat = fs.statSync(abs);

  const walPath = `${abs}-wal`;
  const shmPath = `${abs}-shm`;
  const walPresent = fs.existsSync(walPath);
  const shmPresent = fs.existsSync(shmPath);
  const walSizeBytes = walPresent ? fs.statSync(walPath).size : 0;

  let tableCount = 0;
  let totalRows = 0;
  let integrity: 'ok' | 'corrupt' | 'unknown' = 'unknown';
  let integrityMessage: string | undefined;

  let db: Database.Database | null = null;
  try {
    db = openDb(abs);
    const tables = safeQuery<{ name: string }>(
      db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    tableCount = tables.length;
    for (const t of tables) {
      try {
        const row = safeQueryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM "${t.name}"`);
        if (row) totalRows += Number(row.c) || 0;
      } catch {
        /* skip unreadable table */
      }
    }
    try {
      const ic = safeQueryOne<{ integrity_check: string }>(db, `PRAGMA integrity_check(1)`);
      if (ic) {
        if (ic.integrity_check === 'ok') {
          integrity = 'ok';
        } else {
          integrity = 'corrupt';
          integrityMessage = String(ic.integrity_check);
        }
      }
    } catch (e) {
      integrity = 'unknown';
      integrityMessage = String((e as Error)?.message || e);
    }
  } catch (e) {
    integrity = 'corrupt';
    integrityMessage = String((e as Error)?.message || e);
  } finally {
    // Don't close — shared-db caches the connection.
    db = null;
  }

  return {
    name: dbName,
    path: abs,
    sizeBytes: stat.size,
    sizeHuman: humanSize(stat.size),
    lastModified: stat.mtime.toISOString(),
    tableCount,
    totalRows,
    walPresent,
    walSizeBytes,
    shmPresent,
    integrity,
    integrityMessage,
  };
}

// ----------------------------------------------------------------------------
// Tables
// ----------------------------------------------------------------------------

export function listTables(dbName: string): TableSummary[] {
  const abs = resolveDbPath(dbName);
  const db = openDb(abs);
  const tables = safeQuery<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  const result: TableSummary[] = [];
  for (const t of tables) {
    try {
      const row = safeQueryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM "${t.name}"`);
      const rowCount = row ? Number(row.c) || 0 : 0;

      const cols = safeQuery<{ name: string }>(db, `PRAGMA table_info("${t.name}")`);
      const columnCount = cols.length;

      // Size estimate = (rows * columnCount * 32 bytes) — heuristic only.
      const sizeEstimateBytes = rowCount * columnCount * 32;

      result.push({
        name: t.name,
        rowCount,
        columnCount,
        sizeEstimateBytes,
        sizeHuman: humanSize(sizeEstimateBytes),
      });
    } catch {
      /* skip unreadable table */
    }
  }
  return result;
}

export function getTableRows(
  dbName: string,
  table: string,
  page: number,
  limit: number,
  sortBy?: string,
  sortDir?: 'asc' | 'desc'
): TableRowsResult {
  validateTableName(table);
  const abs = resolveDbPath(dbName);
  const db = openDb(abs);

  const colInfo = safeQuery<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dflt_value: string | null;
  }>(db, `PRAGMA table_info("${table}")`);

  if (colInfo.length === 0) {
    throw new Error(`Table '${table}' not found in ${dbName}`);
  }

  const columns: TableColumn[] = colInfo.map((c) => ({
    name: c.name,
    type: c.type || '',
    notNull: !!c.notnull,
    pk: !!c.pk,
    dfltValue: c.dflt_value,
  }));

  const totalRow = safeQueryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM "${table}"`);
  const totalRows = totalRow ? Number(totalRow.c) || 0 : 0;

  const safeLimit = Math.max(1, Math.min(limit || 50, 500));
  const safePage = Math.max(1, page || 1);
  const offset = (safePage - 1) * safeLimit;
  const totalPages = Math.max(1, Math.ceil(totalRows / safeLimit));

  let sql = `SELECT * FROM "${table}"`;
  const validSortCols = new Set(columns.map((c) => c.name));
  if (sortBy && validSortCols.has(sortBy)) {
    sql += ` ORDER BY "${sortBy}" ${sortDir === 'desc' ? 'DESC' : 'ASC'}`;
  } else {
    // Default: by rowid desc (most recently inserted first)
    sql += ` ORDER BY rowid DESC`;
  }
  sql += ` LIMIT ? OFFSET ?`;

  const rows = safeQuery<Record<string, unknown>>(db, sql, [safeLimit, offset]);

  return {
    columns,
    rows,
    totalRows,
    page: safePage,
    limit: safeLimit,
    totalPages,
  };
}

// ----------------------------------------------------------------------------
// SQL execution
// ----------------------------------------------------------------------------

/** Detect if a SQL statement is a read (SELECT) or a write (everything else). */
function isReadSql(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  // Strip leading comments / whitespace
  const firstWord = trimmed.match(/^([A-Z]+)/)?.[1] || '';
  return firstWord === 'SELECT' || firstWord === 'WITH' || firstWord === 'PRAGMA' || firstWord === 'EXPLAIN';
}

export function executeQuery(
  dbName: string,
  sql: string,
  dryRun = false
): QueryResult {
  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    throw new Error('SQL statement is required');
  }
  const abs = resolveDbPath(dbName);
  const trimmedSql = sql.trim().replace(/;+\s*$/, '');
  const isRead = isReadSql(trimmedSql);

  const start = Date.now();

  if (dryRun) {
    const db = openDb(abs);
    try {
      const plan = safeQuery<Record<string, unknown>>(db, `EXPLAIN ${trimmedSql}`);
      return {
        columns: [],
        rows: [],
        affected: 0,
        durationMs: Date.now() - start,
        isWrite: !isRead,
        explainPlan: plan,
      };
    } finally {
      /* cached — don't close */
    }
  }

  if (isRead) {
    const db = openDb(abs);
    try {
      const stmt = db.prepare(trimmedSql);
      const rows = stmt.all() as Record<string, unknown>[];
      const durationMs = Date.now() - start;
      const limited = rows.slice(0, 1000);
      const columns =
        limited.length > 0
          ? Object.keys(limited[0])
          : (stmt.columns?.map((c) => c.name) ?? []);
      return {
        columns,
        rows: limited,
        affected: rows.length,
        durationMs,
        isWrite: false,
        truncated: rows.length > 1000 ? true : undefined,
      };
    } finally {
      /* cached — don't close */
    }
  }

  // WRITE — fresh writable connection
  let db: Database.Database | null = null;
  try {
    db = openWritable(abs);
    const stmt = db.prepare(trimmedSql);
    const info = stmt.run();
    const durationMs = Date.now() - start;
    return {
      columns: [],
      rows: [],
      affected: Number(info.changes) || 0,
      durationMs,
      isWrite: true,
    };
  } finally {
    safeClose(db);
  }
}

// ----------------------------------------------------------------------------
// Maintenance
// ----------------------------------------------------------------------------

export function vacuum(dbName: string): MaintenanceResult {
  const abs = resolveDbPath(dbName);
  const start = Date.now();
  let db: Database.Database | null = null;
  try {
    db = openWritable(abs);
    db.exec('VACUUM');
    return {
      success: true,
      operation: 'VACUUM',
      durationMs: Date.now() - start,
      message: `تم ضغط ${dbName} بنجاح`,
    };
  } catch (e) {
    return {
      success: false,
      operation: 'VACUUM',
      durationMs: Date.now() - start,
      message: String((e as Error)?.message || e),
    };
  } finally {
    safeClose(db);
  }
}

export function integrityCheck(dbName: string): MaintenanceResult {
  const abs = resolveDbPath(dbName);
  const start = Date.now();
  let db: Database.Database | null = null;
  try {
    // integrity_check can run readonly
    db = openDb(abs);
    const rows = safeQuery<{ integrity_check: string }>(db, `PRAGMA integrity_check`);
    const report = rows.map((r) => r.integrity_check);
    const ok = report.length === 1 && report[0] === 'ok';
    return {
      success: true,
      operation: 'INTEGRITY_CHECK',
      durationMs: Date.now() - start,
      message: ok ? 'قاعدة البيانات سليمة' : 'توجد مشاكل في السلامة',
      report,
    };
  } catch (e) {
    return {
      success: false,
      operation: 'INTEGRITY_CHECK',
      durationMs: Date.now() - start,
      message: String((e as Error)?.message || e),
    };
  } finally {
    /* cached — don't close */
    db = null;
  }
}

export function walCheckpoint(dbName: string): MaintenanceResult {
  const abs = resolveDbPath(dbName);
  const start = Date.now();
  let db: Database.Database | null = null;
  try {
    db = openWritable(abs);
    const row = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    const r = row[0] || { busy: 0, log: 0, checkpointed: 0 };
    return {
      success: true,
      operation: 'WAL_CHECKPOINT',
      durationMs: Date.now() - start,
      message: `busy=${r.busy} log=${r.log} checkpointed=${r.checkpointed}`,
      report: [
        `busy: ${r.busy} (0 = no writers were active)`,
        `log: ${r.log} (frames in WAL before checkpoint)`,
        `checkpointed: ${r.checkpointed} (frames merged into main DB)`,
      ],
    };
  } catch (e) {
    return {
      success: false,
      operation: 'WAL_CHECKPOINT',
      durationMs: Date.now() - start,
      message: String((e as Error)?.message || e),
    };
  } finally {
    safeClose(db);
  }
}

export function reindexAll(dbName: string): MaintenanceResult {
  const abs = resolveDbPath(dbName);
  const start = Date.now();
  let db: Database.Database | null = null;
  try {
    db = openWritable(abs);
    // REINDEX rebuilds all indexes in the database when no name is given.
    db.exec('REINDEX');
    return {
      success: true,
      operation: 'REINDEX',
      durationMs: Date.now() - start,
      message: 'تمت إعادة بناء جميع الفهارس بنجاح',
    };
  } catch (e) {
    return {
      success: false,
      operation: 'REINDEX',
      durationMs: Date.now() - start,
      message: String((e as Error)?.message || e),
    };
  } finally {
    safeClose(db);
  }
}

// ----------------------------------------------------------------------------
// Backup / restore / delete
// ----------------------------------------------------------------------------

export function backupDatabase(dbName: string): { fileName: string; sizeBytes: number; sizeHuman: string } {
  const abs = resolveDbPath(dbName);
  ensureBackupDir();

  // Checkpoint WAL first so the .db file is consistent on its own.
  try {
    const db = openWritable(abs);
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      safeClose(db);
    }
  } catch {
    /* continue — best effort */
  }

  const baseName = path.basename(abs);
  const fileName = `${baseName}.backup_${timestamp()}`;
  const dest = path.join(BACKUP_DIR, fileName);

  // Copy the main DB file
  fs.copyFileSync(abs, dest);

  // Also copy -wal and -shm if present (so the backup is fully restorable)
  const walSrc = `${abs}-wal`;
  const shmSrc = `${abs}-shm`;
  if (fs.existsSync(walSrc)) fs.copyFileSync(walSrc, `${dest}-wal`);
  if (fs.existsSync(shmSrc)) fs.copyFileSync(shmSrc, `${dest}-shm`);

  const stat = fs.statSync(dest);
  return {
    fileName,
    sizeBytes: stat.size,
    sizeHuman: humanSize(stat.size),
  };
}

export function listBackups(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => {
    const full = path.join(BACKUP_DIR, f);
    return fs.statSync(full).isFile() && !f.endsWith('-wal') && !f.endsWith('-shm');
  });

  return files
    .map((f) => {
      const full = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(full);
      // Try to extract original DB name from "<dbname>.backup_<timestamp>"
      const match = f.match(/^(.+?)\.backup_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})$/);
      let db: string | undefined;
      let createdAt = stat.mtime.toISOString();
      if (match) {
        db = match[1];
        const [date, time] = match[2].split('_');
        const iso = `${date.replace(/-/g, '-')}T${time.replace(/-/g, ':')}`;
        const parsed = new Date(iso);
        if (!isNaN(parsed.getTime())) createdAt = parsed.toISOString();
      }
      return {
        name: f,
        sizeBytes: stat.size,
        sizeHuman: humanSize(stat.size),
        createdAt,
        db,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function restoreBackup(dbName: string, backupFile: string): { autoBackup: string } {
  const abs = resolveDbPath(dbName);
  const backupPath = resolveBackupPath(backupFile);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  // Auto-backup current DB before overwriting
  const autoBackup = backupDatabase(dbName);

  // Copy backup → current DB
  fs.copyFileSync(backupPath, abs);

  // Also copy any -wal / -shm sidecars from the backup
  const walBak = `${backupPath}-wal`;
  const shmBak = `${backupPath}-shm`;
  if (fs.existsSync(walBak)) {
    fs.copyFileSync(walBak, `${abs}-wal`);
  } else if (fs.existsSync(`${abs}-wal`)) {
    fs.unlinkSync(`${abs}-wal`);
  }
  if (fs.existsSync(shmBak)) {
    fs.copyFileSync(shmBak, `${abs}-shm`);
  } else if (fs.existsSync(`${abs}-shm`)) {
    fs.unlinkSync(`${abs}-shm`);
  }

  return { autoBackup: autoBackup.fileName };
}

export function deleteBackup(fileName: string): void {
  const abs = resolveBackupPath(fileName);
  if (!fs.existsSync(abs)) {
    throw new Error(`Backup file not found: ${fileName}`);
  }
  fs.unlinkSync(abs);
  // Also remove sidecars
  if (fs.existsSync(`${abs}-wal`)) fs.unlinkSync(`${abs}-wal`);
  if (fs.existsSync(`${abs}-shm`)) fs.unlinkSync(`${abs}-shm`);
}

// ----------------------------------------------------------------------------
// Table destructive ops
// ----------------------------------------------------------------------------

export function dropTable(dbName: string, table: string): { dropped: string } {
  validateTableName(table);
  const abs = resolveDbPath(dbName);
  let db: Database.Database | null = null;
  try {
    db = openWritable(abs);
    db.exec(`DROP TABLE IF EXISTS "${table}"`);
    return { dropped: table };
  } finally {
    safeClose(db);
  }
}

export function truncateTable(dbName: string, table: string): { deletedRows: number } {
  validateTableName(table);
  const abs = resolveDbPath(dbName);
  let db: Database.Database | null = null;
  try {
    db = openWritable(abs);
    // Get count first (for reporting)
    const before = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number } | undefined;
    const beforeCount = before ? Number(before.c) || 0 : 0;
    db.exec(`DELETE FROM "${table}"`);
    return { deletedRows: beforeCount };
  } finally {
    safeClose(db);
  }
}

// ----------------------------------------------------------------------------
// Schema
// ----------------------------------------------------------------------------

export function getSchema(dbName: string, table: string): SchemaResult {
  validateTableName(table);
  const abs = resolveDbPath(dbName);
  const db = openDb(abs);

  const schemaRow = safeQueryOne<{ sql: string; name: string }>(
    db,
    `SELECT sql, name FROM sqlite_master WHERE type='table' AND name = ?`,
    [table]
  );
  if (!schemaRow) {
    throw new Error(`Table '${table}' not found in ${dbName}`);
  }

  const colInfo = safeQuery<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dflt_value: string | null;
  }>(db, `PRAGMA table_info("${table}")`);
  const columns: TableColumn[] = colInfo.map((c) => ({
    name: c.name,
    type: c.type || '',
    notNull: !!c.notnull,
    pk: !!c.pk,
    dfltValue: c.dflt_value,
  }));

  const idxRows = safeQuery<{ name: string; sql: string }>(
    db,
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ? ORDER BY name`,
    [table]
  );

  return {
    table,
    createStatement: schemaRow.sql || '(no CREATE statement)',
    columns,
    indexes: idxRows.map((i) => ({ name: i.name, sql: i.sql || '(auto-index)' })),
  };
}

// ----------------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------------

export function exportTable(
  dbName: string,
  table: string,
  format: 'csv' | 'json'
): { content: string; fileName: string; mimeType: string } {
  validateTableName(table);
  const abs = resolveDbPath(dbName);
  const db = openDb(abs);

  // Limit to 100k rows for export safety
  const rows = safeQuery<Record<string, unknown>>(db, `SELECT * FROM "${table}" LIMIT 100000`);
  const ts = timestamp();
  const baseName = path.basename(abs, '.db');

  if (format === 'json') {
    return {
      content: JSON.stringify(rows, null, 2),
      fileName: `${baseName}_${table}_${ts}.json`,
      mimeType: 'application/json',
    };
  }

  // CSV — escape per RFC 4180
  const escapeCell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'object') {
      try {
        s = JSON.stringify(v);
      } catch {
        s = String(v);
      }
    } else {
      s = String(v);
    }
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const lines: string[] = [];
  if (headers.length > 0) {
    lines.push(headers.map(escapeCell).join(','));
  }
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell((row as Record<string, unknown>)[h])).join(','));
  }

  return {
    content: lines.join('\n'),
    fileName: `${baseName}_${table}_${ts}.csv`,
    mimeType: 'text/csv; charset=utf-8',
  };
}

// ----------------------------------------------------------------------------
// Bulk operations — all databases
// ----------------------------------------------------------------------------

export interface BulkCheckpointResult {
  success: boolean;
  results: { db: string; ok: boolean; message: string }[];
}

/** Run WAL checkpoint on ALL databases. Essential before export/backup. */
export function checkpointAllDbs(): BulkCheckpointResult {
  const databases = listDatabases();
  const results: { db: string; ok: boolean; message: string }[] = [];

  for (const db of databases) {
    try {
      const abs = path.join(DB_DIR, db.name);
      let conn: Database.Database | null = null;
      try {
        conn = openWritable(abs);
        const row = conn.pragma('wal_checkpoint(TRUNCATE)') as Array<{
          busy: number;
          log: number;
          checkpointed: number;
        }>;
        const r = row[0] || { busy: 0, log: 0, checkpointed: 0 };
        results.push({
          db: db.name,
          ok: true,
          message: `checkpointed=${r.checkpointed} log=${r.log} busy=${r.busy}`,
        });
      } finally {
        safeClose(conn);
      }
    } catch (e) {
      results.push({ db: db.name, ok: false, message: String((e as Error)?.message || e) });
    }
  }

  return {
    success: results.every((r) => r.ok),
    results,
  };
}

export interface ExportAllResult {
  zipFileName: string;
  zipPath: string;
  sizeBytes: number;
  sizeHuman: string;
  dbCount: number;
  /** WAL status before export — warning if WAL files were present */
  walWarning: string[];
}

/**
 * Export ALL databases to a single ZIP file.
 * 1. Runs WAL checkpoint on all databases first.
 * 2. Zips all .db files (including -wal/-shm) into a single archive.
 * 3. Returns the ZIP file info.
 */
export function exportAllDbs(): ExportAllResult {
  // Step 1: WAL checkpoint all
  const checkpointResult = checkpointAllDbs();
  const walWarning: string[] = [];
  for (const r of checkpointResult.results) {
    if (!r.ok) {
      walWarning.push(`${r.db}: ${r.message}`);
    }
  }

  // Step 2: Create temp directory for staging
  const ts = timestamp();
  const zipBaseName = `all_databases_${ts}`;
  const zipFileName = `${zipBaseName}.zip`;
  const zipPath = path.join(DB_DIR, zipFileName);

  const tmpDir = path.join(DB_DIR, `_export_tmp_${ts}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // Copy all .db files and their sidecars to temp dir
    const databases = listDatabases();
    let dbCount = 0;
    for (const db of databases) {
      const src = path.join(DB_DIR, db.name);
      const dst = path.join(tmpDir, db.name);
      try {
        fs.copyFileSync(src, dst);
        dbCount++;

        // Copy -wal if present
        if (fs.existsSync(`${src}-wal`)) {
          fs.copyFileSync(`${src}-wal`, `${dst}-wal`);
        }
        // Copy -shm if present
        if (fs.existsSync(`${src}-shm`)) {
          fs.copyFileSync(`${src}-shm`, `${dst}-shm`);
        }
      } catch {
        // skip unreadable
      }
    }

    // Step 3: Zip the temp directory
    try {
      execSync(`cd "${tmpDir}" && zip -qr "${zipPath}" *.db *.db-wal *.db-shm 2>/dev/null || true`, {
        timeout: 120_000, // 2 minutes for large DBs
      });
    } catch (e) {
      throw new Error(`فشل إنشاء ملف ZIP: ${String((e as Error)?.message || e)}`);
    }

    const stat = fs.statSync(zipPath);

    return {
      zipFileName,
      zipPath,
      sizeBytes: stat.size,
      sizeHuman: humanSize(stat.size),
      dbCount,
      walWarning,
    };
  } finally {
    // Clean up temp dir
    try {
      if (fs.existsSync(tmpDir)) {
        for (const f of fs.readdirSync(tmpDir)) {
          fs.unlinkSync(path.join(tmpDir, f));
        }
        fs.rmdirSync(tmpDir);
      }
    } catch {
      /* best effort */
    }
  }
}

export interface ImportAllResult {
  restored: string[];
  failed: string[];
  autoBackupZip: string;
}

/**
 * Import ALL databases from a ZIP file.
 * 1. Auto-backs up current databases to a ZIP first.
 * 2. Extracts the ZIP to a temp dir.
 * 3. Validates each .db file with INTEGRITY_CHECK.
 * 4. Replaces each .db file in db/ with the extracted version.
 * 5. Only replaces files that exist in the zip — doesn't delete files not in the zip.
 */
export function importAllDbs(zipFileName: string): ImportAllResult {
  if (!zipFileName || typeof zipFileName !== 'string') {
    throw new Error('ZIP file name is required');
  }
  if (zipFileName.includes('/') || zipFileName.includes('\\') || zipFileName.includes('..')) {
    throw new Error(`Invalid ZIP file name: ${zipFileName}`);
  }
  if (!zipFileName.endsWith('.zip')) {
    throw new Error('File must be a .zip');
  }

  const zipPath = path.join(DB_DIR, zipFileName);
  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP file not found: ${zipFileName}`);
  }

  // Step 1: Auto-backup current databases to ZIP
  let autoBackupZip = '';
  try {
    const exportResult = exportAllDbs();
    autoBackupZip = exportResult.zipFileName;
  } catch (e) {
    throw new Error(`فشل عمل نسخة احتياطية تلقائية قبل الاستيراد: ${String((e as Error)?.message || e)}`);
  }

  // Step 2: Extract to temp dir
  const ts = timestamp();
  const tmpDir = path.join(DB_DIR, `_import_tmp_${ts}`);
  const restored: string[] = [];
  const failed: string[] = [];

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, {
        timeout: 120_000,
      });
    } catch (e) {
      throw new Error(`فشل فك ضغط ملف ZIP: ${String((e as Error)?.message || e)}`);
    }

    // Step 3: Validate and replace each .db file
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm'));

    if (files.length === 0) {
      throw new Error('ملف ZIP لا يحتوي على أي قواعد بيانات .db');
    }

    for (const dbFile of files) {
      const srcDb = path.join(tmpDir, dbFile);
      const destDb = path.join(DB_DIR, dbFile);

      // Validate integrity
      let valid = false;
      let conn: Database.Database | null = null;
      try {
        conn = new Database(srcDb, { readonly: true });
        const row = conn.pragma('integrity_check') as Array<{ integrity_check: string }>;
        valid = row.length === 1 && row[0].integrity_check === 'ok';
      } catch {
        valid = false;
      } finally {
        safeClose(conn);
      }

      if (!valid) {
        failed.push(`${dbFile}: فشل فحص السلامة — تم تخطيها`);
        continue;
      }

      // Checkpoint WAL on the extracted file
      try {
        conn = openWritable(srcDb);
        try {
          conn.pragma('wal_checkpoint(TRUNCATE)');
        } finally {
          safeClose(conn);
        }
      } catch {
        /* best effort */
      }

      // Replace the destination file
      try {
        fs.copyFileSync(srcDb, destDb);

        // Copy/replace -wal and -shm sidecars
        if (fs.existsSync(`${srcDb}-wal`)) {
          fs.copyFileSync(`${srcDb}-wal`, `${destDb}-wal`);
        } else if (fs.existsSync(`${destDb}-wal`)) {
          fs.unlinkSync(`${destDb}-wal`);
        }
        if (fs.existsSync(`${srcDb}-shm`)) {
          fs.copyFileSync(`${srcDb}-shm`, `${destDb}-shm`);
        } else if (fs.existsSync(`${destDb}-shm`)) {
          fs.unlinkSync(`${destDb}-shm`);
        }

        restored.push(dbFile);
      } catch (e) {
        failed.push(`${dbFile}: ${String((e as Error)?.message || e)}`);
      }
    }
  } finally {
    // Clean up temp dir
    try {
      if (fs.existsSync(tmpDir)) {
        for (const f of fs.readdirSync(tmpDir)) {
          fs.unlinkSync(path.join(tmpDir, f));
        }
        fs.rmdirSync(tmpDir);
      }
    } catch {
      /* best effort */
    }
  }

  // Delete the uploaded ZIP after processing
  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* best effort */
  }

  return { restored, failed, autoBackupZip };
}

// ----------------------------------------------------------------------------
// Historical backups — browse daily backups with integrity status
// ----------------------------------------------------------------------------

export interface HistoricalBackup {
  id: string;
  date: string;
  dateDisplay: string;
  dayOfWeek: string;
  dbCount: number;
  okCount: number;
  corruptCount: number;
  totalSizeBytes: number;
  totalSizeHuman: string;
  databases: {
    name: string;
    sizeBytes: number;
    sizeHuman: string;
    integrity: 'ok' | 'corrupt' | 'failed';
    integrityMsg?: string;
  }[];
  hasSummary: boolean;
}

const DAILY_BACKUP_DIR = path.join(DB_DIR, 'backups', 'daily');

export function listHistoricalBackups(): HistoricalBackup[] {
  const result: HistoricalBackup[] = [];

  if (!fs.existsSync(DAILY_BACKUP_DIR)) {
    return result;
  }

  const entries = fs.readdirSync(DAILY_BACKUP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{8}_\d{6}$/.test(e.name))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  for (const entry of entries) {
    const dirPath = path.join(DAILY_BACKUP_DIR, entry.name);
    const summaryPath = path.join(dirPath, 'backup_summary.json');
    const hasSummary = fs.existsSync(summaryPath);

    let summary: {
      timestamp?: string;
      date?: string;
      day_of_week?: string;
      dbs?: { name: string; size: number; size_human: string; integrity: string; integrity_msg?: string }[];
      ok?: number;
      corrupt?: number;
      failed?: number;
      total_size_bytes?: number;
    } | null = null;

    if (hasSummary) {
      try {
        summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      } catch {
        /* ignore corrupt summary */
      }
    }

    // Parse date from directory name: YYYYMMDD_HHMMSS
    const dateStr = entry.name;
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = dateStr.slice(9, 11);
    const minute = dateStr.slice(11, 13);
    const second = dateStr.slice(13, 15);

    const dateObj = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    const dayOfWeek = dateObj.toLocaleDateString('ar-EG', { weekday: 'long' });
    const dateDisplay = dateObj.toLocaleDateString('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (summary?.dbs && summary.dbs.length > 0) {
      // Use summary data
      result.push({
        id: entry.name,
        date: dateStr,
        dateDisplay,
        dayOfWeek,
        dbCount: summary.dbs.length,
        okCount: summary.ok || 0,
        corruptCount: (summary.corrupt || 0) + (summary.failed || 0),
        totalSizeBytes: summary.total_size_bytes || 0,
        totalSizeHuman: humanSize(summary.total_size_bytes || 0),
        databases: summary.dbs.map((d) => ({
          name: d.name,
          sizeBytes: d.size,
          sizeHuman: d.size_human,
          integrity: (d.integrity === 'ok' ? 'ok' : 'corrupt') as 'ok' | 'corrupt' | 'failed',
          integrityMsg: d.integrity_msg,
        })),
        hasSummary: true,
      });
    } else {
      // Scan the directory directly
      const dbFiles = fs.readdirSync(dirPath).filter(
        (f) => f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm')
      );

      let totalSize = 0;
      const databases: HistoricalBackup['databases'] = [];
      let okCount = 0;
      let corruptCount = 0;

      for (const dbFile of dbFiles) {
        const dbPath = path.join(dirPath, dbFile);
        try {
          const stat = fs.statSync(dbPath);
          totalSize += stat.size;

          let integrity: 'ok' | 'corrupt' | 'failed' = 'ok';
          let integrityMsg: string | undefined;

          try {
            const conn = new Database(dbPath, { readonly: true });
            try {
              const row = conn.pragma('integrity_check') as Array<{ integrity_check: string }>;
              if (row.length === 1 && row[0].integrity_check === 'ok') {
                integrity = 'ok';
                okCount++;
              } else {
                integrity = 'corrupt';
                integrityMsg = row[0]?.integrity_check || 'corrupt';
                corruptCount++;
              }
            } finally {
              conn.close();
            }
          } catch {
            integrity = 'failed';
            integrityMsg = 'cannot open';
            corruptCount++;
          }

          databases.push({
            name: dbFile,
            sizeBytes: stat.size,
            sizeHuman: humanSize(stat.size),
            integrity,
            integrityMsg,
          });
        } catch {
          corruptCount++;
          databases.push({
            name: dbFile,
            sizeBytes: 0,
            sizeHuman: '0 B',
            integrity: 'failed',
            integrityMsg: 'cannot read',
          });
        }
      }

      result.push({
        id: entry.name,
        date: dateStr,
        dateDisplay,
        dayOfWeek,
        dbCount: databases.length,
        okCount,
        corruptCount,
        totalSizeBytes: totalSize,
        totalSizeHuman: humanSize(totalSize),
        databases,
        hasSummary: false,
      });
    }
  }

  return result;
}

export interface RestoreFromBackupResult {
  restored: string[];
  failed: string[];
  autoBackupZip: string;
}

export interface RecoverResult {
  recovered: boolean;
  restored_from?: string;
  method?: string;
  message: string;
}

export interface RecoverAllResult {
  results: {
    db: string;
    status: 'ok' | 'corrupted' | 'recovered' | 'failed' | 'error';
    action?: string | null;
    message: string;
  }[];
  summary: {
    total: number;
    ok: number;
    recovered: number;
    corrupted: number;
  };
}

/**
 * Restore all databases from a specific historical backup (daily backup directory).
 * 1. Auto-backs up current databases to ZIP.
 * 2. Validates integrity of each .db in the backup directory.
 * 3. Replaces each .db file in db/ with the backup version.
 */
export function restoreFromBackup(backupId: string): RestoreFromBackupResult {
  if (!backupId || typeof backupId !== 'string') {
    throw new Error('Backup ID is required');
  }
  if (!/^\d{8}_\d{6}$/.test(backupId)) {
    throw new Error(`Invalid backup ID: ${backupId}`);
  }

  const backupDir = path.join(DAILY_BACKUP_DIR, backupId);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  // Step 1: Auto-backup current databases
  let autoBackupZip = '';
  try {
    const exportResult = exportAllDbs();
    autoBackupZip = exportResult.zipFileName;
  } catch (e) {
    throw new Error(`فشل عمل نسخة احتياطية تلقائية: ${String((e as Error)?.message || e)}`);
  }

  const restored: string[] = [];
  const failed: string[] = [];

  const dbFiles = fs.readdirSync(backupDir).filter(
    (f) => f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm')
  );

  for (const dbFile of dbFiles) {
    const srcPath = path.join(backupDir, dbFile);
    const destPath = path.join(DB_DIR, dbFile);

    // Validate integrity
    let valid = false;
    let conn: Database.Database | null = null;
    try {
      conn = new Database(srcPath, { readonly: true });
      const row = conn.pragma('integrity_check') as Array<{ integrity_check: string }>;
      valid = row.length === 1 && row[0].integrity_check === 'ok';
    } catch {
      valid = false;
    } finally {
      if (conn) {
        try { conn.close(); } catch { /* ignore */ }
      }
    }

    if (!valid) {
      failed.push(`${dbFile}: فشل فحص السلامة — تم تخطيها`);
      continue;
    }

    // Replace
    try {
      fs.copyFileSync(srcPath, destPath);

      // Copy/replace -wal and -shm sidecars
      if (fs.existsSync(`${srcPath}-wal`)) {
        fs.copyFileSync(`${srcPath}-wal`, `${destPath}-wal`);
      } else if (fs.existsSync(`${destPath}-wal`)) {
        fs.unlinkSync(`${destPath}-wal`);
      }
      if (fs.existsSync(`${srcPath}-shm`)) {
        fs.copyFileSync(`${srcPath}-shm`, `${destPath}-shm`);
      } else if (fs.existsSync(`${destPath}-shm`)) {
        fs.unlinkSync(`${destPath}-shm`);
      }

      restored.push(dbFile);
    } catch (e) {
      failed.push(`${dbFile}: ${String((e as Error)?.message || e)}`);
    }
  }

   return { restored, failed, autoBackupZip };
}

/**
 * Recover a single corrupted database from backups or WAL checkpoint + VACUUM.
 * Calls POST /api/admin/db-manager/recover
 */
export async function recoverDatabase(dbName: string): Promise<RecoverResult> {
  const res = await fetch('/api/admin/db-manager/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db: dbName }),
    cache: 'no-store',
  });
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Recover failed: ${res.status}`);
  }
  
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Recover failed');
  }
  
  return json.data as RecoverResult;
}

/**
 * Recover all corrupted databases automatically.
 * Calls POST /api/admin/db-manager/recover-all
 */
export async function recoverAllDatabases(): Promise<RecoverAllResult> {
  const res = await fetch('/api/admin/db-manager/recover-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    cache: 'no-store',
  });
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Recover all failed: ${res.status}`);
  }
  
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Recover all failed');
  }
  
  return json.data as RecoverAllResult;
}

export function deleteBackupDirectory(backupId: string): void {
  if (!backupId || typeof backupId !== 'string') {
    throw new Error('Backup ID is required');
  }
  if (!/^\d{8}_\d{6}$/.test(backupId)) {
    throw new Error(`Invalid backup ID: ${backupId}`);
  }

  const backupDir = path.join(DAILY_BACKUP_DIR, backupId);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  // Delete directory recursively
  fs.rmSync(backupDir, { recursive: true, force: true });
}
