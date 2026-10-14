import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { exec } from 'child_process';
import { promisify } from 'util';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

/**
 * /api/health — Deep Health Check (Directive P1)
 * ===============================================
 * Previously this route opened every SQLite DB directly
 * (`db/stocks.db`, `db/predictions.db`, `db/price_history.db`,
 * `db/data_engine.db`, `db/intraday.db`, `db/auth.db`) via
 * `new Database(p, { readonly: true, fileMustExist: true })` + `SELECT 1` +
 * `SELECT COUNT(*)` on the main table. That direct DB access has been removed
 * — Python owns the DBs and reports their status from its own `/health`
 * endpoint (Rule 4: Python = brain).
 *
 * The route now:
 *   1. Pings `PYTHON_BACKEND_URL/health` (with 127.0.0.1:8010 fallback).
 *   2. If Python responds with a `databases` field, relays it verbatim so the
 *      admin UI + the contract test (`health.test.ts`) see the same DB names.
 *   3. If Python is unreachable → returns `status:'degraded'`, `python:'down'`,
 *      `databases: { 'stocks.db': { status:'unknown' }, ... }` (honest empty
 *      — Rule 27 NO-FAKE-DATA).
 *
 * OS-level checks (disk usage + service ports) are kept — they don't touch
 * SQLite. They are run async in parallel.
 *
 * Status values per component:
 *   "ok"      — healthy
 *   "down"    — not running / unreachable / corrupted
 *   "degraded"— partially working
 *   "unknown" — Python is unreachable so we can't tell (honest fallback)
 *
 * Top-level `status`:
 *   "ok"       — every component ok
 *   "degraded" — Python down OR at least one non-critical component down
 *   "down"     — disk >95% full (we can't write anything)
 */

// 60s TTL — deep health check is expensive, don't run on every request.
const HEALTH_CACHE_TTL_MS = 60_000;

interface CachedHealth {
  ts: number;
  payload: unknown;
}
let cache: CachedHealth | null = null;

interface DbCheck {
  status: 'ok' | 'down' | 'unknown';
  size_mb?: number;
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
  python: 'up' | 'down';
  components: {
    nextjs: { status: 'ok' };
    'python-backend': ServiceCheck;
    databases: Record<string, DbCheck>;
    disk: DiskCheck;
  };
}

// DB names that the contract test (health.test.ts) + admin UI expect to find
// under components.databases. When Python is unreachable, each one is reported
// as `{ status: 'unknown' }` so consumers can see "we can't tell" instead of
// fabricating "ok" (Rule 27).
const EXPECTED_DB_NAMES = [
  'stocks.db',
  'predictions.db',
  'price_history.db',
  'data_engine.db',
];

/**
 * Fetch Python's `/health` response. Returns the parsed JSON body on success,
 * or null if Python is unreachable.
 */
async function fetchPythonHealth(): Promise<{
  ok: boolean;
  data: Record<string, unknown> | null;
  latency: number;
}> {
  const start = Date.now();
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/health`,
    'http://127.0.0.1:8010/health',
  ];
  for (const url of targetUrls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        return { ok: true, data, latency: Date.now() - start };
      }
    } catch { // silent fallback (safe-by-design) → try next URL
      // Try next fallback URL.
    }
  }
  return { ok: false, data: null, latency: Date.now() - start };
}

/**
 * Check if a TCP port has a listener via `ss -ltn` (fast, no PII).
 * Returns { reachable, pid } or { reachable: false } on any error.
 */
async function checkPort(port: number): Promise<{ reachable: boolean; pid?: number }> {
  try {
    const { stdout } = await execAsync(`ss -ltnp 2>/dev/null | grep ':${port} ' || true`);
    if (!stdout.trim()) return { reachable: false };
    const m = stdout.match(/pid=(\d+)/);
    return { reachable: true, pid: m ? +m[1] : undefined };
  } catch { // silent fallback (safe-by-design)
    return { reachable: false };
  }
}

/**
 * Get disk usage of the project directory via `df -B 1G`.
 */
async function checkDisk(): Promise<DiskCheck> {
  try {
    const projectPath = process.cwd();
    const { stdout } = await execAsync(
      `df -BG --output=size,used,avail,pcent "${projectPath}" | tail -1`
    );
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 4) {
      return { status: 'down', free_gb: 0, total_gb: 0, used_pct: 0, error: 'df parse failed' };
    }
    const totalGb = +parts[0].replace('G', '');
    const usedGb = +parts[1].replace('G', '');
    const availGb = +parts[2].replace('G', '');
    const usedPct = +parts[3].replace('%', '');
    const status: 'ok' | 'down' = usedPct >= 95 ? 'down' : 'ok';
    return { status, free_gb: availGb, total_gb: totalGb, used_pct: usedPct };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'down', free_gb: 0, total_gb: 0, used_pct: 0, error: message };
  }
}

/**
 * Normalise Python's reported DB statuses into our DbCheck shape. If Python
 * didn't report a particular DB (or Python is unreachable), fall back to
 * `status: 'unknown'` for each expected DB name (Rule 27 honest fallback).
 */
function buildDatabasesFromPython(pythonData: Record<string, unknown> | null): Record<string, DbCheck> {
  const out: Record<string, DbCheck> = {};
  const components = (pythonData?.components ?? {}) as Record<string, unknown>;
  const pythonDbs = (pythonData?.databases ?? components?.databases ?? {}) as
    | Record<string, DbCheck>
    | undefined;

  for (const name of EXPECTED_DB_NAMES) {
    const reported = pythonDbs?.[name];
    if (reported && typeof reported === 'object' && 'status' in reported) {
      out[name] = {
        status: (reported.status as DbCheck['status']) || 'unknown',
        size_mb: reported.size_mb,
        rows: reported.rows,
        latest_date: reported.latest_date,
        error: reported.error,
      };
    } else {
      out[name] = { status: 'unknown' };
    }
  }
  return out;
}

async function runHealthChecks(): Promise<HealthReport> {
  // ── Run all checks in parallel ──────────────────────────────────────
  const [pythonHealth, disk] = await Promise.all([
    fetchPythonHealth(),
    checkDisk(),
    // Port check for python-backend (informational — fetchPythonHealth is the
    // authoritative probe).
    checkPort(8010),
  ]);

  const pythonReachable = pythonHealth.ok;
  const pythonPidMatch = await (async () => {
    // Re-use the port check already run in parallel — extract pid from it.
    try {
      const { stdout } = await execAsync(`ss -ltnp 2>/dev/null | grep ':8010 ' || true`);
      const m = stdout.match(/pid=(\d+)/);
      return m ? +m[1] : undefined;
    } catch { // silent fallback (safe-by-design)
      return undefined;
    }
  })();

  const databases = buildDatabasesFromPython(pythonHealth.data);

  // ── Compute aggregate status ─────────────────────────────────────────
  let status: 'ok' | 'degraded' | 'down';
  if (disk.status === 'down') {
    status = 'down';
  } else if (!pythonReachable) {
    // Python down → degraded (we can still serve cached/static content).
    status = 'degraded';
  } else {
    const dbStatuses = Object.values(databases).map((d) => d.status);
    const criticalDown = ['stocks.db', 'predictions.db'].some(
      (n) => databases[n]?.status === 'down'
    );
    if (criticalDown) {
      status = 'down';
    } else if (dbStatuses.every((s) => s === 'ok')) {
      status = 'ok';
    } else {
      status = 'degraded';
    }
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    python: pythonReachable ? 'up' : 'down',
    components: {
      nextjs: { status: 'ok' }, // we're responding, so Next.js is up
      'python-backend': {
        status: pythonReachable ? 'ok' : 'down',
        port: 8010,
        reachable: pythonReachable,
        pid: pythonPidMatch,
      },
      databases,
      disk,
    },
  };
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
      python: payload.python,
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
        python: 'down',
        error: message,
        components: {
          nextjs: { status: 'ok' },
          'python-backend': { status: 'down', reachable: false },
          databases: Object.fromEntries(
            EXPECTED_DB_NAMES.map((n) => [n, { status: 'unknown' as const }])
          ),
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
