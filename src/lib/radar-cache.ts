/**
 * radar-cache.ts — Production-safe Maker Radar cache layer
 * ====================================================================
 * PROBLEM (production):
 *   - Production DB = 1.8GB (1M+ rows) → Python script slow on cold start
 *   - Next.js kills request after 30s → 500 error
 *   - Concurrent DB access from data_engine sync → contention
 *
 * SOLUTION:
 *   - API ONLY reads cached JSON (instant <50ms) — never blocks on Python
 *   - Background warmup keeps cache fresh (fire-and-forget spawn)
 *   - Mutex prevents concurrent warmup runs
 *   - Status file tracks freshness + last error for UI visibility
 *
 * Flow:
 *   1. GET /api/maker-radar → read cache (instant) + trigger bg warmup if stale
 *   2. Background warmup → spawn `python3 scripts/maker_radar.py --json-only`
 *   3. POST /api/maker-radar/warmup → synchronous warmup (for cron/manual)
 */
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'scripts', 'output');
const STATUS_FILE = path.join(PROJECT_ROOT, 'db', 'radar_cache_status.json');
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'scripts', 'maker_radar.py');

// Cache staleness threshold (15 min). If older → trigger background warmup.
const STALE_THRESHOLD_MS = 15 * 60 * 1000;
// Warmup mutex TTL — if a warmup started but never finished, allow retry after this.
const WARMUP_MUTEX_TTL_MS = 5 * 60 * 1000;

export interface RadarCacheStatus {
  last_warmup_started_at: string | null;
  last_warmup_finished_at: string | null;
  last_warmup_duration_ms: number | null;
  last_warmup_status: 'idle' | 'running' | 'success' | 'failed';
  last_error: string | null;
  cache_file: string | null;
  cache_generated_at: string | null;
  cache_age_seconds: number | null;
  total_scanned: number | null;
  under_microscope_count: number | null;
  db_source: string | null;
}

let warmupInMemory = false; // process-level mutex (extra safety)

/** Find the most recent maker_radar_*.json file in scripts/output/ */
export function findLatestRadarFile(): string | null {
  try {
    if (!existsSync(OUTPUT_DIR)) return null;
    const files = readdirSync(OUTPUT_DIR)
      .filter((f) => f.startsWith('maker_radar_') && f.endsWith('.json'))
      .sort()
      .reverse();
    return files.length > 0 ? path.join(OUTPUT_DIR, files[0]) : null;
  } catch {
    return null;
  }
}

/** Read the status file (or return default idle status). */
export function readStatus(): RadarCacheStatus {
  const def: RadarCacheStatus = {
    last_warmup_started_at: null,
    last_warmup_finished_at: null,
    last_warmup_duration_ms: null,
    last_warmup_status: 'idle',
    last_error: null,
    cache_file: null,
    cache_generated_at: null,
    cache_age_seconds: null,
    total_scanned: null,
    under_microscope_count: null,
    db_source: null,
  };
  try {
    if (!existsSync(STATUS_FILE)) return def;
    const raw = readFileSync(STATUS_FILE, 'utf-8');
    return { ...def, ...JSON.parse(raw) };
  } catch {
    return def;
  }
}

/** Write the status file. */
function writeStatus(s: Partial<RadarCacheStatus>): void {
  try {
    const dir = path.dirname(STATUS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const cur = readStatus();
    const next = { ...cur, ...s };
    writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2));
  } catch {
    // silent — status file is best-effort
  }
}

/**
 * Read the cached radar JSON. Instant (<50ms). Never blocks on Python.
 * Returns null if no cache file exists yet.
 */
export function readRadarCache(): { data: any; filePath: string } | null {
  const fp = findLatestRadarFile();
  if (!fp || !existsSync(fp)) return null;
  try {
    const raw = readFileSync(fp, 'utf-8');
    const data = JSON.parse(raw);
    return { data, filePath: fp };
  } catch {
    return null;
  }
}

/** Is the cache stale (older than threshold)? */
export function isCacheStale(): boolean {
  const cache = readRadarCache();
  if (!cache) return true;
  const generatedAt = cache.data?.generated_at;
  if (!generatedAt) return true;
  const ageMs = Date.now() - new Date(generatedAt).getTime();
  return ageMs > STALE_THRESHOLD_MS;
}

/** Is a warmup currently running (mutex check)? */
export function isWarmupRunning(): boolean {
  if (warmupInMemory) return true;
  const status = readStatus();
  if (status.last_warmup_status !== 'running') return false;
  // Stale mutex check: if a "running" status is older than TTL, treat as dead
  if (status.last_warmup_started_at) {
    const ageMs = Date.now() - new Date(status.last_warmup_started_at).getTime();
    if (ageMs > WARMUP_MUTEX_TTL_MS) return false;
  }
  return true;
}

/** Resolve python binary — prefer venv if present.
 *  Checks multiple venv locations (project-local + user-global). */
function resolvePython(): string {
  const candidates = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),       // project-local venv
    '/home/z/.venv/bin/python3',                                 // user-global venv (sandbox)
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),          // alt name
    '/home/z/.venv/bin/python',                                  // alt name (sandbox)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'python3'; // fallback to PATH
}

/**
 * Trigger a background warmup (fire-and-forget). Safe to call multiple times —
 * the mutex prevents concurrent runs. Returns true if a warmup was started,
 * false if one is already running (or failed to start).
 */
export function triggerBackgroundWarmup(market = 'EGX'): boolean {
  if (isWarmupRunning()) return false;
  if (!existsSync(SCRIPT_PATH)) return false;

  const python = resolvePython();
  warmupInMemory = true;
  const startedAt = new Date().toISOString();
  writeStatus({
    last_warmup_started_at: startedAt,
    last_warmup_status: 'running',
    last_error: null,
  });

  const args = [
    SCRIPT_PATH,
    '--market', market,
    '--min-quiet-signals', '5',
    '--min-price', '1.0',
    '--json-only',
  ];

  const child = spawn(python, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

  const startedMonotonic = Date.now();

  child.on('error', (err) => {
    warmupInMemory = false;
    writeStatus({
      last_warmup_finished_at: new Date().toISOString(),
      last_warmup_duration_ms: Date.now() - startedMonotonic,
      last_warmup_status: 'failed',
      last_error: `spawn error: ${err.message}`,
    });
  });

  child.on('exit', (code) => {
    warmupInMemory = false;
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedMonotonic;

    if (code === 0) {
      // Read the freshly-generated file to extract metadata
      const cache = readRadarCache();
      writeStatus({
        last_warmup_finished_at: finishedAt,
        last_warmup_duration_ms: durationMs,
        last_warmup_status: 'success',
        last_error: null,
        cache_file: cache?.filePath || null,
        cache_generated_at: cache?.data?.generated_at || null,
        cache_age_seconds: cache?.data?.generated_at
          ? Math.round((Date.now() - new Date(cache.data.generated_at).getTime()) / 1000)
          : null,
        total_scanned: cache?.data?.total_scanned ?? null,
        under_microscope_count: cache?.data?.under_microscope_count ?? null,
        db_source: cache?.data?.db_source ?? extractDbSource(stdout) ?? null,
      });
    } else {
      // Failed — but keep the old cache file intact (don't delete it)
      const errMsg = stderr.trim().slice(0, 1000) || `exit code ${code}`;
      writeStatus({
        last_warmup_finished_at: finishedAt,
        last_warmup_duration_ms: durationMs,
        last_warmup_status: 'failed',
        last_error: errMsg,
      });
    }
  });

  // Detach so the child can outlive the API request handler
  child.unref();
  return true;
}

/**
 * Synchronous warmup — blocks until the script finishes (or times out).
 * Used by the /warmup endpoint (for cron / manual trigger).
 */
export async function runWarmupSync(market = 'EGX', timeoutMs = 90_000): Promise<RadarCacheStatus> {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`Script not found: ${SCRIPT_PATH}`);
  }
  // Wait if a warmup is already running (up to timeoutMs)
  const waitStart = Date.now();
  while (isWarmupRunning() && Date.now() - waitStart < timeoutMs) {
    await new Promise((r) => setTimeout(r, 500));
  }

  const python = resolvePython();
  warmupInMemory = true;
  const startedAt = new Date().toISOString();
  const startedMonotonic = Date.now();
  writeStatus({
    last_warmup_started_at: startedAt,
    last_warmup_status: 'running',
    last_error: null,
  });

  return new Promise((resolve) => {
    const args = [
      SCRIPT_PATH,
      '--market', market,
      '--min-quiet-signals', '5',
      '--min-price', '1.0',
      '--json-only',
    ];
    const child = spawn(python, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      warmupInMemory = false;
      const status: RadarCacheStatus = {
        ...readStatus(),
        last_warmup_finished_at: new Date().toISOString(),
        last_warmup_duration_ms: Date.now() - startedMonotonic,
        last_warmup_status: 'failed',
        last_error: `timeout after ${timeoutMs}ms`,
      };
      writeStatus(status);
      resolve(status);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      warmupInMemory = false;
      const status: RadarCacheStatus = {
        ...readStatus(),
        last_warmup_finished_at: new Date().toISOString(),
        last_warmup_duration_ms: Date.now() - startedMonotonic,
        last_warmup_status: 'failed',
        last_error: `spawn error: ${err.message}`,
      };
      writeStatus(status);
      resolve(status);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      warmupInMemory = false;
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMonotonic;
      const cache = readRadarCache();

      if (code === 0) {
        const status: RadarCacheStatus = {
          last_warmup_started_at: startedAt,
          last_warmup_finished_at: finishedAt,
          last_warmup_duration_ms: durationMs,
          last_warmup_status: 'success',
          last_error: null,
          cache_file: cache?.filePath || null,
          cache_generated_at: cache?.data?.generated_at || null,
          cache_age_seconds: cache?.data?.generated_at
            ? Math.round((Date.now() - new Date(cache.data.generated_at).getTime()) / 1000)
            : null,
          total_scanned: cache?.data?.total_scanned ?? null,
          under_microscope_count: cache?.data?.under_microscope_count ?? null,
          db_source: cache?.data?.db_source ?? extractDbSource(stdout) ?? null,
        };
        writeStatus(status);
        resolve(status);
      } else {
        const errMsg = stderr.trim().slice(0, 1000) || `exit code ${code}`;
        const status: RadarCacheStatus = {
          ...readStatus(),
          last_warmup_finished_at: finishedAt,
          last_warmup_duration_ms: durationMs,
          last_warmup_status: 'failed',
          last_error: errMsg,
        };
        writeStatus(status);
        resolve(status);
      }
    });
  });
}

/** Parse the script stdout to extract the DB source name (best-effort). */
function extractDbSource(stdout: string): string | null {
  // The script logs: "  DB: <name> (table: <table>)"
  const m = stdout.match(/DB:\s*(\S+)\s*\(table:\s*(\w+)\)/);
  return m ? `${m[1]}::${m[2]}` : null;
}

/** Build the full status object including live cache_age. */
export function getLiveStatus(): RadarCacheStatus {
  const status = readStatus();
  const cache = readRadarCache();
  if (cache?.data?.generated_at) {
    status.cache_file = cache.filePath;
    status.cache_generated_at = cache.data.generated_at;
    status.cache_age_seconds = Math.round(
      (Date.now() - new Date(cache.data.generated_at).getTime()) / 1000
    );
    status.total_scanned = cache.data.total_scanned ?? status.total_scanned;
    status.under_microscope_count =
      cache.data.under_microscope_count ?? status.under_microscope_count;
    if (!status.db_source && cache.data.db_source) {
      status.db_source = cache.data.db_source;
    }
  }
  return status;
}
