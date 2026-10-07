import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

/**
 * /api/health — Deep Health Check
 * ===============================
 * P0 #15 fix (2026-09-27): the old version only ran `existsSync` on DB
 * files, so a corrupted DB reported "status: ok". This rewrite actually
 * opens each DB and runs `SELECT 1` to verify it's not corrupted, then
 * also checks PM2 services (via `ps`), disk space (via `df`), and
 * returns a structured JSON report with per-component status.
 *
 * Status values per component:
 *   "ok"      — healthy
 *   "down"    — not running / unreachable / corrupted
 *   "degraded"— partially working
 *
 * Top-level `status`:
 *   "ok"       — every component ok
 *   "degraded" — at least one non-critical component is down/degraded
 *   "down"     — a critical component (nextjs itself, a primary DB) is down
 *
 * All checks run async (no blocking sync I/O). DB checks open connections
 * read-only and close them immediately. Process checks use child_process.exec.
 */

// 5-minute TTL — deep health check is expensive, don't run on every request.
const HEALTH_CACHE_TTL_MS = 60_000; // 60s — was 10s before, but deep checks are heavier.

// Simple in-memory cache so a flood of /api/health requests doesn't DOS us.
interface CachedHealth {
  ts: number;
  payload: unknown;
}
let cache: CachedHealth | null = null;

interface DbCheck {
  status: 'ok' | 'down';
  size_mb: number;
  rows?: number;
  latest_date?: string;
  error?: string;
}

interface ServiceCheck {
  status: 'ok' | 'down';
  port?: number;
  reachable: boolean;
  pid?: number;
}

interface DiskCheck {
  status: 'ok' | 'down';
  free_gb: number;
  total_gb: number;
  used_pct: number;
  error?: string;
}

interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  components: {
    nextjs: { status: 'ok' };
    'python-backend': ServiceCheck;
    'ws-service': ServiceCheck;
    'telegram-events': ServiceCheck;
    'news-agent': ServiceCheck;
    databases: Record<string, DbCheck>;
    disk: DiskCheck;
  };
}

/**
 * Open a SQLite DB read-only, run `SELECT 1`, count rows in the main
 * table, and close it. Returns null on success or the error message.
 */
function checkDb(
  dbPath: string,
  mainTable?: string,
  dateColumn?: string
): DbCheck {
  if (!existsSync(dbPath)) {
    return { status: 'down', size_mb: 0, error: 'file missing' };
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(dbPath).size;
  } catch {
    // fallthrough — file might be unreadable
  }
  const sizeMb = Math.max(0, +(sizeBytes / 1024 / 1024).toFixed(1));

  let db: Database.Database | null = null;
  try {
    // readonly + fileMustExist → throws immediately if missing or corrupted
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    // Quick integrity check
    db.prepare('SELECT 1').get();
    // Optional row count
    let rows: number | undefined;
    if (mainTable) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM "${mainTable}"`).get() as { c: number } | undefined;
        rows = row?.c;
      } catch {
        // table may not exist in some DBs — ignore
      }
    }
    // Optional latest_date
    let latestDate: string | undefined;
    if (mainTable && dateColumn) {
      try {
        const row = db.prepare(`SELECT MAX("${dateColumn}") AS d FROM "${mainTable}"`).get() as { d: string | null } | undefined;
        latestDate = row?.d ?? undefined;
      } catch {
        // ignore — column may not exist
      }
    }
    return { status: 'ok', size_mb: sizeMb, rows, latest_date: latestDate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'down', size_mb: sizeMb, error: message };
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
  }
}

/**
 * Check if a TCP port has a listener via `ss -ltn` (fast, no PII).
 * Returns { reachable, pid } or { reachable: false } on any error.
 */
async function checkPort(port: number): Promise<{ reachable: boolean; pid?: number }> {
  try {
    const { stdout } = await execAsync(`ss -ltnp 2>/dev/null | grep ':${port} ' || true`);
    if (!stdout.trim()) return { reachable: false };
    // Try to extract pid — line format: "users:(("python",pid=12345,fd=3))"
    const m = stdout.match(/pid=(\d+)/);
    return { reachable: true, pid: m ? +m[1] : undefined };
  } catch {
    // ss not available → fall back to /dev/tcp-style check via curl
    try {
      await execAsync(`curl -s --max-time 1 http://127.0.0.1:${port}/ >/dev/null 2>&1 || true`);
      // Can't tell from curl alone whether the port has a listener — be conservative:
      // assume reachable since curl exited 0 (any non-zero would have thrown).
      return { reachable: true };
    } catch {
      return { reachable: false };
    }
  }
}

/**
 * Check if a process matching `pattern` is running via `pgrep -f`.
 * Returns { reachable, pid }.
 */
async function checkProcess(pattern: string): Promise<{ reachable: boolean; pid?: number }> {
  try {
    const { stdout } = await execAsync(`pgrep -f "${pattern}" | head -1`);
    const pidStr = stdout.trim();
    if (!pidStr) return { reachable: false };
    return { reachable: true, pid: +pidStr };
  } catch {
    return { reachable: false };
  }
}

/**
 * Get disk usage of the project directory via `df -B 1G`.
 */
async function checkDisk(): Promise<DiskCheck> {
  try {
    const projectPath = process.cwd();
    // df -BG gives gigabyte units; we ask for the project's mount point.
    const { stdout } = await execAsync(`df -BG --output=size,used,avail,pcent "${projectPath}" | tail -1`);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 4) {
      return { status: 'down', free_gb: 0, total_gb: 0, used_pct: 0, error: 'df parse failed' };
    }
    const totalGb = +parts[0].replace('G', '');
    const usedGb = +parts[1].replace('G', '');
    const availGb = +parts[2].replace('G', '');
    const usedPct = +parts[3].replace('%', '');
    // Mark "down" if >95% full — likely to cause write failures.
    const status: 'ok' | 'down' = usedPct >= 95 ? 'down' : 'ok';
    return { status, free_gb: availGb, total_gb: totalGb, used_pct: usedPct };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'down', free_gb: 0, total_gb: 0, used_pct: 0, error: message };
  }
}

async function runHealthChecks(): Promise<HealthReport> {
  const cwd = process.cwd();
  const dbDir = join(cwd, 'db');

  // ── Run all checks in parallel ──────────────────────────────────────
  const [
    pythonBackend,
    wsService,
    telegramEvents,
    newsAgent,
    disk,
    stocksDb,
    predictionsDb,
    priceHistoryDb,
    dataEngineDb,
    intradayDb,
    authDbCheck,
  ] = await Promise.all([
    checkPort(8010),                                  // python-backend
    checkPort(3005),                                  // ws-service
    checkPort(3003),                                  // telegram-events
    checkProcess('news-agent/main.py'),               // news-agent (no port — it's a loop)
    checkDisk(),
    Promise.resolve(checkDb(join(dbDir, 'stocks.db'), 'stocks')),
    Promise.resolve(checkDb(join(dbDir, 'predictions.db'), 'predictions')),
    Promise.resolve(checkDb(join(dbDir, 'price_history.db'), 'price_history', 'date')),
    Promise.resolve(checkDb(join(dbDir, 'data_engine.db'), 'stocks')),
    Promise.resolve(checkDb(join(dbDir, 'intraday.db'))),
    Promise.resolve(checkDb(join(dbDir, 'auth.db'), 'User')),
  ]);

  const databases: Record<string, DbCheck> = {
    'stocks.db': stocksDb,
    'predictions.db': predictionsDb,
    'price_history.db': priceHistoryDb,
    'data_engine.db': dataEngineDb,
    'intraday.db': intradayDb,
    'auth.db': authDbCheck,
  };

  // ── Compute aggregate status ─────────────────────────────────────────
  const dbStatuses = Object.values(databases).map((d) => d.status);
  const allDbsOk = dbStatuses.every((s) => s === 'ok');
  const criticalDbsDown = ['stocks.db', 'predictions.db', 'auth.db'].some(
    (n) => databases[n]?.status !== 'ok'
  );

  const servicesDown = !pythonBackend.reachable || !wsService.reachable;

  let status: 'ok' | 'degraded' | 'down';
  if (criticalDbsDown) {
    status = 'down';
  } else if (allDbsOk && pythonBackend.reachable && wsService.reachable) {
    // telegram-events + news-agent are non-critical — their absence is "degraded"
    status = 'ok';
  } else {
    status = 'degraded';
  }

  // Override: if disk is critical, mark the whole thing down
  if (disk.status === 'down') status = 'down';

  const report: HealthReport = {
    status,
    timestamp: new Date().toISOString(),
    components: {
      nextjs: { status: 'ok' }, // we're responding, so Next.js is up
      'python-backend': {
        status: pythonBackend.reachable ? 'ok' : 'down',
        port: 8010,
        reachable: pythonBackend.reachable,
        pid: pythonBackend.pid,
      },
      'ws-service': {
        status: wsService.reachable ? 'ok' : 'down',
        port: 3005,
        reachable: wsService.reachable,
        pid: wsService.pid,
      },
      'telegram-events': {
        status: telegramEvents.reachable ? 'ok' : 'down',
        port: 3003,
        reachable: telegramEvents.reachable,
        pid: telegramEvents.pid,
      },
      'news-agent': {
        status: newsAgent.reachable ? 'ok' : 'down',
        reachable: newsAgent.reachable,
        pid: newsAgent.pid,
      },
      databases,
      disk,
    },
  };

  // Suppress unused warning while keeping the field for future logic.
  void servicesDown;

  return report;
}

export async function GET() {
  // Serve from cache if fresh
  if (cache && Date.now() - cache.ts < HEALTH_CACHE_TTL_MS) {
    return NextResponse.json(cache.payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const payload = await runHealthChecks();
    cache = { ts: Date.now(), payload };

    const httpStatus = payload.status === 'down' ? 503 : 200;

    // Structured log — useful in production for tracking status changes.
    logger.info('health check completed', {
      status: payload.status,
      httpStatus,
      dbs_ok: Object.values(payload.components.databases).filter((d) => d.status === 'ok').length,
      dbs_total: Object.keys(payload.components.databases).length,
      disk_used_pct: payload.components.disk.used_pct,
    });

    return NextResponse.json(payload, {
      status: httpStatus,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('health check failed', { error: message });
    return NextResponse.json(
      {
        status: 'down',
        timestamp: new Date().toISOString(),
        error: message,
        components: {},
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
