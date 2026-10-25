/**
 * metrics-db.ts
 * =============
 * better-sqlite3 wrapper for the resource-monitoring metrics database.
 *
 *   • Auto-creates `db/metrics.db` + tables on first use (idempotent)
 *   • Three-tier retention: raw (24h) → 5min aggregates (7d) → 1h aggregates (30d)
 *   • Per-process PM2 snapshots (24h)
 *   • Anomaly + alert log (30d) with spike / trend / memory-leak / threshold /
 *     recovery detection
 *
 * All public functions are SYNCHRONOUS (better-sqlite3 is sync) and wrap every
 * operation in try/catch — they never throw, they only log + return defaults.
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Re-export types from collector for convenience
// ---------------------------------------------------------------------------

import type { SnapshotData, Pm2Process } from '@/lib/metrics-collector';
export type { SnapshotData, Pm2Process };

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

const DB_DIR = path.join(process.cwd(), 'db');
const DB_PATH = path.join(DB_DIR, 'metrics.db');

let _db: DatabaseType | null = null;

function getDb(): DatabaseType | null {
  if (_db) return _db;
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    _db = new Database(DB_PATH, { timeout: 5000 });
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('busy_timeout = 5000');
    initSchema(_db);
    return _db;
  } catch (e) {
    logger.error('[metrics-db] failed to open DB', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

function initSchema(db: DatabaseType): void {
  db.exec(`
    -- Raw data (every 15s) — kept 24h
    CREATE TABLE IF NOT EXISTS resource_snapshot_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      cpu REAL,
      mem_pct REAL,
      mem_used_mb REAL,
      mem_total_mb REAL,
      disk_pct REAL,
      disk_used_gb REAL,
      disk_total_gb REAL,
      load1 REAL,
      load5 REAL,
      load15 REAL,
      pm2_online INTEGER,
      pm2_total INTEGER,
      pm2_total_cpu REAL,
      pm2_total_mem_mb REAL,
      node_rss_mb REAL,
      net_rx_kb REAL,
      net_tx_kb REAL
    );
    CREATE INDEX IF NOT EXISTS idx_raw_ts ON resource_snapshot_raw(ts);

    -- 5-min aggregates — kept 7d
    CREATE TABLE IF NOT EXISTS resource_snapshot_5min (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      cpu_avg REAL, cpu_min REAL, cpu_max REAL,
      mem_pct_avg REAL, mem_pct_min REAL, mem_pct_max REAL,
      disk_pct_avg REAL, disk_pct_max REAL,
      pm2_online_avg REAL, pm2_total_avg REAL,
      load1_avg REAL, load1_max REAL
    );
    CREATE INDEX IF NOT EXISTS idx_5min_ts ON resource_snapshot_5min(ts);

    -- 1-hour aggregates — kept 30d
    CREATE TABLE IF NOT EXISTS resource_snapshot_1h (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      cpu_avg REAL, cpu_min REAL, cpu_max REAL,
      mem_pct_avg REAL, mem_pct_min REAL, mem_pct_max REAL,
      disk_pct_avg REAL, disk_pct_max REAL,
      pm2_online_avg REAL, pm2_total_avg REAL,
      load1_avg REAL, load1_max REAL
    );
    CREATE INDEX IF NOT EXISTS idx_1h_ts ON resource_snapshot_1h(ts);

    -- Per-process snapshots — kept 24h
    CREATE TABLE IF NOT EXISTS pm2_process_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      pm_id INTEGER,
      name TEXT,
      status TEXT,
      pid INTEGER,
      cpu REAL,
      memory_mb REAL,
      restarts INTEGER,
      uptime_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pm2_ts ON pm2_process_snapshot(ts, name);

    -- Alerts log — kept 30d
    CREATE TABLE IF NOT EXISTS resource_alert (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      resource TEXT,
      severity TEXT,
      type TEXT,
      message TEXT,
      value REAL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_ts ON resource_alert(ts);
    CREATE INDEX IF NOT EXISTS idx_alert_resource_type ON resource_alert(resource, type, ts);
  `);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RangeKey = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

export interface HistoryPoint {
  ts: string;
  cpu: number | null;
  mem_pct: number | null;
  disk_pct: number | null;
  pm2_online: number | null;
  pm2_total: number | null;
  load1: number | null;
  net_rx_kb: number | null;
  net_tx_kb: number | null;
}

export interface ProcessHistoryPoint {
  ts: string;
  cpu: number | null;
  memory_mb: number | null;
  restarts: number | null;
  status: string | null;
}

export type AlertResource = 'cpu' | 'ram' | 'disk' | 'pm2' | 'memory_leak';
export type AlertSeverity = 'warning' | 'critical' | 'info';
export type AlertType =
  | 'spike'
  | 'trend'
  | 'threshold'
  | 'memory_leak'
  | 'recovered';

export interface Alert {
  id: number;
  ts: string;
  resource: AlertResource;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  value: number;
}

export interface RetentionStats {
  deleted_raw: number;
  aggregated_5min: number;
  aggregated_1h: number;
  deleted_old: number;
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

const insertRawStmt = (db: DatabaseType) =>
  db.prepare(`
    INSERT INTO resource_snapshot_raw
      (ts, cpu, mem_pct, mem_used_mb, mem_total_mb, disk_pct, disk_used_gb,
       disk_total_gb, load1, load5, load15, pm2_online, pm2_total,
       pm2_total_cpu, pm2_total_mem_mb, node_rss_mb, net_rx_kb, net_tx_kb)
    VALUES
      (@ts, @cpu, @mem_pct, @mem_used_mb, @mem_total_mb, @disk_pct, @disk_used_gb,
       @disk_total_gb, @load1, @load5, @load15, @pm2_online, @pm2_total,
       @pm2_total_cpu, @pm2_total_mem_mb, @node_rss_mb, @net_rx_kb, @net_tx_kb)
  `);

const insertPm2Stmt = (db: DatabaseType) =>
  db.prepare(`
    INSERT INTO pm2_process_snapshot
      (ts, pm_id, name, status, pid, cpu, memory_mb, restarts, uptime_ms)
    VALUES
      (@ts, @pm_id, @name, @status, @pid, @cpu, @memory_mb, @restarts, @uptime_ms)
  `);

export function insertSnapshot(data: SnapshotData, pm2Processes: Pm2Process[] = []): void {
  const db = getDb();
  if (!db) return;
  try {
    const tx = db.transaction(() => {
      insertRawStmt(db).run({
        ts: data.ts,
        cpu: data.cpu ?? null,
        mem_pct: data.mem_pct ?? null,
        mem_used_mb: data.mem_used_mb ?? null,
        mem_total_mb: data.mem_total_mb ?? null,
        disk_pct: data.disk_pct ?? null,
        disk_used_gb: data.disk_used_gb ?? null,
        disk_total_gb: data.disk_total_gb ?? null,
        load1: data.load1 ?? null,
        load5: data.load5 ?? null,
        load15: data.load15 ?? null,
        pm2_online: data.pm2_online ?? null,
        pm2_total: data.pm2_total ?? null,
        pm2_total_cpu: data.pm2_total_cpu ?? null,
        pm2_total_mem_mb: data.pm2_total_mem_mb ?? null,
        node_rss_mb: data.node_rss_mb ?? null,
        net_rx_kb: data.net_rx_kb ?? null,
        net_tx_kb: data.net_tx_kb ?? null,
      });
      const stmt = insertPm2Stmt(db);
      for (const p of pm2Processes) {
        stmt.run({
          ts: data.ts,
          pm_id: p.pm_id,
          name: p.name,
          status: p.status,
          pid: p.pid,
          cpu: p.cpu,
          memory_mb: p.memory_mb,
          restarts: p.restarts,
          uptime_ms: p.uptime_ms,
        });
      }
    });
    tx();
  } catch (e) {
    logger.error('[metrics-db] insertSnapshot failed', { err: e instanceof Error ? e.message : String(e) });
  }
}

// ---------------------------------------------------------------------------
// History query (auto table selection by range)
// ---------------------------------------------------------------------------

function rangeToMs(range: RangeKey): number {
  switch (range) {
    case '15m': return 15 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    default: return 60 * 60 * 1000;
  }
}

interface RawRow {
  ts: string;
  cpu: number | null;
  mem_pct: number | null;
  disk_pct: number | null;
  pm2_online: number | null;
  pm2_total: number | null;
  load1: number | null;
  net_rx_kb: number | null;
  net_tx_kb: number | null;
}

interface AggRow {
  ts: string;
  cpu_avg: number | null;
  mem_pct_avg: number | null;
  disk_pct_avg: number | null;
  pm2_online_avg: number | null;
  pm2_total_avg: number | null;
  load1_avg: number | null;
  // optional fields absent from 5min/1h
  net_rx_kb?: number | null;
  net_tx_kb?: number | null;
}

export function getHistory(range: RangeKey = '1h'): HistoryPoint[] {
  const db = getDb();
  if (!db) return [];
  try {
    const since = new Date(Date.now() - rangeToMs(range)).toISOString();

    // Table selection: raw for short ranges, 5min for 24h-7d, 1h for 30d
    let useTable: 'raw' | '5min' | '1h';
    if (range === '15m' || range === '1h' || range === '6h') {
      useTable = 'raw';
    } else if (range === '24h') {
      useTable = 'raw'; // 24h raw is exactly the retention window
    } else if (range === '7d') {
      useTable = '5min';
    } else {
      useTable = '1h';
    }

    if (useTable === 'raw') {
      const rows = db.prepare(`
        SELECT ts, cpu, mem_pct, disk_pct, pm2_online, pm2_total, load1, net_rx_kb, net_tx_kb
        FROM resource_snapshot_raw
        WHERE ts >= ?
        ORDER BY ts ASC
      `).all(since) as RawRow[];

      return rows.map(r => ({
        ts: r.ts,
        cpu: r.cpu,
        mem_pct: r.mem_pct,
        disk_pct: r.disk_pct,
        pm2_online: r.pm2_online,
        pm2_total: r.pm2_total,
        load1: r.load1,
        net_rx_kb: r.net_rx_kb,
        net_tx_kb: r.net_tx_kb,
      }));
    }

    // Aggregate tables — network not aggregated; emit null for rx/tx.
    const cols = useTable === '5min'
      ? `FROM resource_snapshot_5min`
      : `FROM resource_snapshot_1h`;

    const rows = db.prepare(`
      SELECT ts, cpu_avg, mem_pct_avg, disk_pct_avg, pm2_online_avg, pm2_total_avg, load1_avg
      ${cols}
      WHERE ts >= ?
      ORDER BY ts ASC
    `).all(since) as AggRow[];

    return rows.map(r => ({
      ts: r.ts,
      cpu: r.cpu_avg,
      mem_pct: r.mem_pct_avg,
      disk_pct: r.disk_pct_avg,
      pm2_online: r.pm2_online_avg !== null ? Math.round(r.pm2_online_avg) : null,
      pm2_total: r.pm2_total_avg !== null ? Math.round(r.pm2_total_avg) : null,
      load1: r.load1_avg,
      net_rx_kb: null,
      net_tx_kb: null,
    }));
  } catch (e) {
    logger.error('[metrics-db] getHistory failed', { err: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-process history
// ---------------------------------------------------------------------------

export function getProcessHistory(name: string, range: '1h' | '6h' | '24h' | '7d' = '1h'): ProcessHistoryPoint[] {
  const db = getDb();
  if (!db) return [];
  try {
    const since = new Date(Date.now() - rangeToMs(range)).toISOString();
    const rows = db.prepare(`
      SELECT ts, cpu, memory_mb, restarts, status
      FROM pm2_process_snapshot
      WHERE name = ? AND ts >= ?
      ORDER BY ts ASC
    `).all(name, since) as ProcessHistoryPoint[];
    return rows;
  } catch (e) {
    logger.error('[metrics-db] getProcessHistory failed', { err: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

const insertAlertStmt = (db: DatabaseType) =>
  db.prepare(`
    INSERT INTO resource_alert (ts, resource, severity, type, message, value)
    VALUES (@ts, @resource, @severity, @type, @message, @value)
  `);

export function insertAlert(alert: Omit<Alert, 'id' | 'ts'>): void {
  const db = getDb();
  if (!db) return;
  try {
    insertAlertStmt(db).run({
      ts: new Date().toISOString(),
      resource: alert.resource,
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      value: alert.value ?? 0,
    });
  } catch (e) {
    logger.error('[metrics-db] insertAlert failed', { err: e instanceof Error ? e.message : String(e) });
  }
}

export function getAlerts(limit = 50): Alert[] {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, ts, resource, severity, type, message, value
      FROM resource_alert
      ORDER BY ts DESC
      LIMIT ?
    `).all(limit) as Alert[];
  } catch (e) {
    logger.error('[metrics-db] getAlerts failed', { err: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Retention + aggregation
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

interface RawAggSource {
  ts: string;
  cpu: number | null;
  mem_pct: number | null;
  disk_pct: number | null;
  pm2_online: number | null;
  pm2_total: number | null;
  load1: number | null;
}

function aggregateRawTo5min(rows: RawAggSource[], bucketTs: string) {
  if (rows.length === 0) return null;
  const nums = (sel: (r: RawAggSource) => number | null) => {
    const vals = rows.map(sel).filter((v): v is number => v !== null && !Number.isNaN(v));
    if (vals.length === 0) return { avg: null, min: null, max: null };
    const sum = vals.reduce((a, b) => a + b, 0);
    return { avg: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
  };
  const cpu = nums(r => r.cpu);
  const mem = nums(r => r.mem_pct);
  const disk = nums(r => r.disk_pct);
  const pm2Online = nums(r => r.pm2_online);
  const pm2Total = nums(r => r.pm2_total);
  const load1 = nums(r => r.load1);
  return {
    ts: bucketTs,
    cpu_avg: cpu.avg, cpu_min: cpu.min, cpu_max: cpu.max,
    mem_pct_avg: mem.avg, mem_pct_min: mem.min, mem_pct_max: mem.max,
    disk_pct_avg: disk.avg, disk_pct_max: disk.max,
    pm2_online_avg: pm2Online.avg, pm2_total_avg: pm2Total.avg,
    load1_avg: load1.avg, load1_max: load1.max,
  };
}

interface FiveMinAggSource {
  ts: string;
  cpu_avg: number | null;
  cpu_min: number | null;
  cpu_max: number | null;
  mem_pct_avg: number | null;
  mem_pct_min: number | null;
  mem_pct_max: number | null;
  disk_pct_avg: number | null;
  disk_pct_max: number | null;
  pm2_online_avg: number | null;
  pm2_total_avg: number | null;
  load1_avg: number | null;
  load1_max: number | null;
}

function aggregate5minTo1h(rows: FiveMinAggSource[], bucketTs: string) {
  if (rows.length === 0) return null;
  const nums = (sel: (r: FiveMinAggSource) => number | null) => {
    const vals = rows.map(sel).filter((v): v is number => v !== null && !Number.isNaN(v));
    if (vals.length === 0) return { avg: null, min: null, max: null };
    const sum = vals.reduce((a, b) => a + b, 0);
    return { avg: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
  };
  const numsMax = (sel: (r: FiveMinAggSource) => number | null) => {
    const vals = rows.map(sel).filter((v): v is number => v !== null && !Number.isNaN(v));
    if (vals.length === 0) return null;
    return Math.max(...vals);
  };
  const cpuAvg = nums(r => r.cpu_avg);
  const cpuMin = nums(r => r.cpu_min);
  const cpuMax = nums(r => r.cpu_max);
  const memAvg = nums(r => r.mem_pct_avg);
  const memMin = nums(r => r.mem_pct_min);
  const memMax = nums(r => r.mem_pct_max);
  const diskAvg = nums(r => r.disk_pct_avg);
  const diskMax = numsMax(r => r.disk_pct_max);
  const pm2OnlineAvg = nums(r => r.pm2_online_avg);
  const pm2TotalAvg = nums(r => r.pm2_total_avg);
  const load1Avg = nums(r => r.load1_avg);
  const load1Max = numsMax(r => r.load1_max);
  return {
    ts: bucketTs,
    cpu_avg: cpuAvg.avg, cpu_min: cpuMin.min, cpu_max: cpuMax.max,
    mem_pct_avg: memAvg.avg, mem_pct_min: memMin.min, mem_pct_max: memMax.max,
    disk_pct_avg: diskAvg.avg, disk_pct_max: diskMax,
    pm2_online_avg: pm2OnlineAvg.avg, pm2_total_avg: pm2TotalAvg.avg,
    load1_avg: load1Avg.avg, load1_max: load1Max,
  };
}

export function runRetention(): RetentionStats {
  const db = getDb();
  if (!db) return { deleted_raw: 0, aggregated_5min: 0, aggregated_1h: 0, deleted_old: 0 };
  const stats: RetentionStats = { deleted_raw: 0, aggregated_5min: 0, aggregated_1h: 0, deleted_old: 0 };
  try {
    const tx = db.transaction(() => {
      const now = isoNow();
      const H24 = 24 * 60 * 60 * 1000;
      const D7 = 7 * 24 * 60 * 60 * 1000;
      const D30 = 30 * 24 * 60 * 60 * 1000;

      // 1. 5-min aggregation: if last 5min row is older than 5 min, take all raw rows
      // from the [last-5min-aggregate-ts, 5-min-ago] window and roll them up.
      const last5minRow = db.prepare(`SELECT MAX(ts) AS ts FROM resource_snapshot_5min`).get() as { ts: string | null };
      const last5minTs = last5minRow?.ts || isoAgo(60 * 60 * 1000); // default to 1h ago on first run
      const aggBoundary = isoAgo(5 * 60 * 1000); // everything older than 5 min ago can be aggregated

      if (last5minTs < aggBoundary) {
        const rawRows = db.prepare(`
          SELECT ts, cpu, mem_pct, disk_pct, pm2_online, pm2_total, load1
          FROM resource_snapshot_raw
          WHERE ts > ? AND ts <= ?
          ORDER BY ts ASC
        `).all(last5minTs, aggBoundary) as RawAggSource[];

        if (rawRows.length > 0) {
          // Group into 5-min buckets by floor(ts to 5 min)
          const buckets = new Map<string, RawAggSource[]>();
          for (const r of rawRows) {
            const d = new Date(r.ts);
            const bucketMs = Math.floor(d.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000);
            const bucketTs = new Date(bucketMs).toISOString();
            if (!buckets.has(bucketTs)) buckets.set(bucketTs, []);
            buckets.get(bucketTs)!.push(r);
          }
          const insert5min = db.prepare(`
            INSERT INTO resource_snapshot_5min
              (ts, cpu_avg, cpu_min, cpu_max, mem_pct_avg, mem_pct_min, mem_pct_max,
               disk_pct_avg, disk_pct_max, pm2_online_avg, pm2_total_avg, load1_avg, load1_max)
            VALUES
              (@ts, @cpu_avg, @cpu_min, @cpu_max, @mem_pct_avg, @mem_pct_min, @mem_pct_max,
               @disk_pct_avg, @disk_pct_max, @pm2_online_avg, @pm2_total_avg, @load1_avg, @load1_max)
          `);
          for (const [bucketTs, rows] of buckets) {
            const agg = aggregateRawTo5min(rows, bucketTs);
            if (agg) {
              insert5min.run(agg);
              stats.aggregated_5min += rows.length;
            }
          }
          // Delete aggregated raw rows (anything older than the 5-min boundary)
          const del = db.prepare(`DELETE FROM resource_snapshot_raw WHERE ts <= ?`).run(aggBoundary);
          stats.deleted_raw += del.changes;
        }
      }

      // 2. 1-hour aggregation: if last 1h row is older than 1 hour, roll up 5min rows
      const last1hRow = db.prepare(`SELECT MAX(ts) AS ts FROM resource_snapshot_1h`).get() as { ts: string | null };
      const last1hTs = last1hRow?.ts || isoAgo(2 * 60 * 60 * 1000); // default 2h ago on first run
      const agg1hBoundary = isoAgo(60 * 60 * 1000);

      if (last1hTs < agg1hBoundary) {
        const fiveminRows = db.prepare(`
          SELECT ts, cpu_avg, cpu_min, cpu_max, mem_pct_avg, mem_pct_min, mem_pct_max,
                 disk_pct_avg, disk_pct_max, pm2_online_avg, pm2_total_avg, load1_avg, load1_max
          FROM resource_snapshot_5min
          WHERE ts > ? AND ts <= ?
          ORDER BY ts ASC
        `).all(last1hTs, agg1hBoundary) as FiveMinAggSource[];

        if (fiveminRows.length > 0) {
          const buckets = new Map<string, FiveMinAggSource[]>();
          for (const r of fiveminRows) {
            const d = new Date(r.ts);
            const bucketMs = Math.floor(d.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000);
            const bucketTs = new Date(bucketMs).toISOString();
            if (!buckets.has(bucketTs)) buckets.set(bucketTs, []);
            buckets.get(bucketTs)!.push(r);
          }
          const insert1h = db.prepare(`
            INSERT INTO resource_snapshot_1h
              (ts, cpu_avg, cpu_min, cpu_max, mem_pct_avg, mem_pct_min, mem_pct_max,
               disk_pct_avg, disk_pct_max, pm2_online_avg, pm2_total_avg, load1_avg, load1_max)
            VALUES
              (@ts, @cpu_avg, @cpu_min, @cpu_max, @mem_pct_avg, @mem_pct_min, @mem_pct_max,
               @disk_pct_avg, @disk_pct_max, @pm2_online_avg, @pm2_total_avg, @load1_avg, @load1_max)
          `);
          for (const [bucketTs, rows] of buckets) {
            const agg = aggregate5minTo1h(rows, bucketTs);
            if (agg) {
              insert1h.run(agg);
              stats.aggregated_1h += rows.length;
            }
          }
          // Delete aggregated 5min rows
          const del = db.prepare(`DELETE FROM resource_snapshot_5min WHERE ts <= ?`).run(agg1hBoundary);
          stats.deleted_old += del.changes;
        }
      }

      // 3. Hard deletes (per retention policy)
      // 5min rows older than 7d
      const d1 = db.prepare(`DELETE FROM resource_snapshot_5min WHERE ts < ?`).run(isoAgo(D7));
      stats.deleted_old += d1.changes;
      // 1h rows older than 30d
      const d2 = db.prepare(`DELETE FROM resource_snapshot_1h WHERE ts < ?`).run(isoAgo(D30));
      stats.deleted_old += d2.changes;
      // pm2 process snapshots older than 24h
      const d3 = db.prepare(`DELETE FROM pm2_process_snapshot WHERE ts < ?`).run(isoAgo(H24));
      stats.deleted_old += d3.changes;
      // alerts older than 30d
      const d4 = db.prepare(`DELETE FROM resource_alert WHERE ts < ?`).run(isoAgo(D30));
      stats.deleted_old += d4.changes;

      // Also belt-and-suspenders: any raw rows older than 24h that weren't aggregated
      // (covers race / first-run scenarios)
      const d5 = db.prepare(`DELETE FROM resource_snapshot_raw WHERE ts < ?`).run(isoAgo(H24));
      stats.deleted_raw += d5.changes;

      // touch `now` so TS doesn't complain
      void now;
    });
    tx();
  } catch (e) {
    logger.error('[metrics-db] runRetention failed', { err: e instanceof Error ? e.message : String(e) });
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

interface RawHistRow {
  ts: string;
  cpu: number | null;
  mem_pct: number | null;
  disk_pct: number | null;
  pm2_online: number | null;
  pm2_total: number | null;
}

function recentAlertWithinMinutes(db: DatabaseType, resource: AlertResource, type: AlertType, minutes: number): boolean {
  const since = isoAgo(minutes * 60 * 1000);
  const row = db.prepare(`
    SELECT id FROM resource_alert
    WHERE resource = ? AND type = ? AND ts >= ?
    LIMIT 1
  `).get(resource, type, since) as { id: number } | undefined;
  return !!row;
}

function wasRecentlyCritical(db: DatabaseType, resource: AlertResource, minutes: number): boolean {
  const since = isoAgo(minutes * 60 * 1000);
  const row = db.prepare(`
    SELECT id FROM resource_alert
    WHERE resource = ? AND severity = 'critical' AND ts >= ?
    LIMIT 1
  `).get(resource, since) as { id: number } | undefined;
  return !!row;
}

/**
 * Linear regression slope (per index step).
 * Returns 0 if not enough points.
 */
function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}

function isMonotonicIncreasing(values: number[]): boolean {
  if (values.length < 2) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) return false;
  }
  return true;
}

export function detectAnomalies(): Alert[] {
  const db = getDb();
  if (!db) return [];
  const newAlerts: Alert[] = [];
  try {
    // Pull last 40 raw rows (~10 min @ 15s interval)
    const rows = db.prepare(`
      SELECT ts, cpu, mem_pct, disk_pct, pm2_online, pm2_total
      FROM resource_snapshot_raw
      ORDER BY ts DESC
      LIMIT 40
    `).all() as RawHistRow[];

    if (rows.length === 0) return []; // no data at all

    // rows come DESC (newest first); reverse for trend analysis (oldest → newest)
    const ordered = [...rows].reverse();
    const current = ordered[ordered.length - 1];
    const last10 = ordered.slice(-10);
    const last20 = ordered.slice(-20);
    const hasEnoughForTrend = rows.length >= 5;

    // ----- Threshold + Recovery -----
    const checkThreshold = (
      resource: AlertResource,
      value: number | null,
    ) => {
      if (value === null || Number.isNaN(value)) return;
      const sev: AlertSeverity | null =
        value >= 85 ? 'critical' : value >= 70 ? 'warning' : null;
      if (sev) {
        if (!recentAlertWithinMinutes(db, resource, 'threshold', 5)) {
          const msg =
            resource === 'cpu'
              ? `CPU usage high at ${value.toFixed(1)}%`
              : resource === 'ram'
              ? `RAM usage high at ${value.toFixed(1)}%`
              : `Disk usage high at ${value.toFixed(1)}%`;
          insertAlert({
            resource,
            severity: sev,
            type: 'threshold',
            message: msg,
            value,
          });
          newAlerts.push({
            id: 0,
            ts: isoNow(),
            resource,
            severity: sev,
            type: 'threshold',
            message: msg,
            value,
          });
        }
      } else {
        // Below 60% AND was recently critical → recovered
        if (value < 60 && wasRecentlyCritical(db, resource, 15)) {
          if (!recentAlertWithinMinutes(db, resource, 'recovered', 10)) {
            const msg = `${resource.toUpperCase()} recovered to ${value.toFixed(1)}%`;
            insertAlert({
              resource,
              severity: 'info',
              type: 'recovered',
              message: msg,
              value,
            });
            newAlerts.push({
              id: 0,
              ts: isoNow(),
              resource,
              severity: 'info',
              type: 'recovered',
              message: msg,
              value,
            });
          }
        }
      }
    };

    checkThreshold('cpu', current.cpu);
    checkThreshold('ram', current.mem_pct);
    checkThreshold('disk', current.disk_pct);

    // ----- PM2 process down (online < total) — only needs current reading -----
    if (current.pm2_total !== null && current.pm2_online !== null && current.pm2_total > 0) {
      if (current.pm2_online < current.pm2_total) {
        if (!recentAlertWithinMinutes(db, 'pm2', 'threshold', 5)) {
          const msg = `PM2: ${current.pm2_total - current.pm2_online} process(es) offline (${current.pm2_online}/${current.pm2_total})`;
          insertAlert({
            resource: 'pm2',
            severity: 'warning',
            type: 'threshold',
            message: msg,
            value: current.pm2_total - current.pm2_online,
          });
          newAlerts.push({
            id: 0,
            ts: isoNow(),
            resource: 'pm2',
            severity: 'warning',
            type: 'threshold',
            message: msg,
            value: current.pm2_total - current.pm2_online,
          });
        }
      }
    }

    // ----- Spike / trend / leak detection needs enough history -----
    if (!hasEnoughForTrend) return newAlerts;

    // ----- Spike detection (current > 2× avg of last 10) -----
    const spikeDetect = (
      resource: AlertResource,
      values: (number | null)[],
    ) => {
      const cur = values[values.length - 1];
      if (cur === null || cur <= 5) return;
      const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v));
      if (valid.length < 5) return;
      const avgExclCurrent = valid.slice(0, -1).reduce((a, b) => a + b, 0) / (valid.length - 1);
      if (avgExclCurrent <= 0) return;
      if (cur > 2 * avgExclCurrent && cur >= 30) {
        if (!recentAlertWithinMinutes(db, resource, 'spike', 5)) {
          const msg = `${resource.toUpperCase()} spike detected: ${cur.toFixed(1)} (avg ${avgExclCurrent.toFixed(1)})`;
          insertAlert({
            resource,
            severity: cur >= 85 ? 'critical' : 'warning',
            type: 'spike',
            message: msg,
            value: cur,
          });
          newAlerts.push({
            id: 0,
            ts: isoNow(),
            resource,
            severity: cur >= 85 ? 'critical' : 'warning',
            type: 'spike',
            message: msg,
            value: cur,
          });
        }
      }
    };

    spikeDetect('cpu', last10.map(r => r.cpu));
    spikeDetect('ram', last10.map(r => r.mem_pct));

    // ----- Trend detection (linear regression slope over last 10) -----
    // CPU increasing > 1%/min over 10 min → ~0.25%/15s step over 10 steps
    const trendDetect = (
      resource: AlertResource,
      values: (number | null)[],
      slopeThresholdPerStep: number,
    ) => {
      const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v));
      if (valid.length < 8) return;
      const s = slope(valid);
      if (s > slopeThresholdPerStep) {
        if (!recentAlertWithinMinutes(db, resource, 'trend', 10)) {
          const msg = `${resource.toUpperCase()} usage increasing continuously (${(s * 4 * 60).toFixed(1)}%/min)`;
          insertAlert({
            resource,
            severity: 'warning',
            type: 'trend',
            message: msg,
            value: s,
          });
          newAlerts.push({
            id: 0,
            ts: isoNow(),
            resource,
            severity: 'warning',
            type: 'trend',
            message: msg,
            value: s,
          });
        }
      }
    };
    // 1%/min over 10 readings (each ~15s apart → 4 readings/min → 10 readings = 2.5 min)
    // slope threshold = 0.25 per step → 0.25 * 4 = 1%/min
    trendDetect('cpu', last10.map(r => r.cpu), 0.25);

    // ----- Memory leak detection (RAM monotonically increasing for 20+ readings) -----
    const memLast20 = last20.map(r => r.mem_pct).filter((v): v is number => v !== null && !Number.isNaN(v));
    if (memLast20.length >= 20 && isMonotonicIncreasing(memLast20)) {
      if (!recentAlertWithinMinutes(db, 'memory_leak', 'memory_leak', 30)) {
        const delta = memLast20[memLast20.length - 1] - memLast20[0];
        if (delta > 0.5) {
          const msg = `Possible memory leak detected — RAM increased ${delta.toFixed(1)}% over ${(memLast20.length * 15 / 60).toFixed(1)} min`;
          insertAlert({
            resource: 'memory_leak',
            severity: 'critical',
            type: 'memory_leak',
            message: msg,
            value: delta,
          });
          newAlerts.push({
            id: 0,
            ts: isoNow(),
            resource: 'memory_leak',
            severity: 'critical',
            type: 'memory_leak',
            message: msg,
            value: delta,
          });
        }
      }
    }
  } catch (e) {
    logger.error('[metrics-db] detectAnomalies failed', { err: e instanceof Error ? e.message : String(e) });
  }
  return newAlerts;
}

// ---------------------------------------------------------------------------
// Health check / manual close (mostly for tests)
// ---------------------------------------------------------------------------

export function closeMetricsDb(): void {
  try {
    _db?.close();
  } catch {
    // ignore
  }
  _db = null;
}
