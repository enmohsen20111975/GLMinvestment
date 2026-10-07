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
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, renameSync, unlinkSync, openSync, closeSync } from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'scripts', 'output');
const STATUS_FILE = path.join(PROJECT_ROOT, 'db', 'radar_cache_status.json');
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'scripts', 'maker_radar.py');
// P1-8 FIX (RADAR-AUDIT-UI R2): cross-process lock file — يمنع تنفيذين متزامنين
// لـ Python script على نفس JSON file في multi-worker Next.js production.
const WARMUP_LOCK_FILE = path.join(PROJECT_ROOT, 'db', 'radar_warmup.lock');

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

/**
 * P1-8 FIX (RADAR-AUDIT-UI R2): Cross-process lock file.
 * يضمن أن عملية Python واحدة فقط تشتغل في نفس الوقت عبر كل workers Next.js.
 * الـ lock file يحوي PID + timestamp — يُعتبر "stale" لو أقدم من WARMUP_MUTEX_TTL_MS.
 */
function acquireLockFile(): boolean {
  try {
    const dir = path.dirname(WARMUP_LOCK_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // تحقق من lock موجود + valid
    if (existsSync(WARMUP_LOCK_FILE)) {
      try {
        const raw = readFileSync(WARMUP_LOCK_FILE, 'utf-8');
        const lock = JSON.parse(raw);
        const ageMs = Date.now() - new Date(lock.acquired_at).getTime();
        if (ageMs < WARMUP_MUTEX_TTL_MS) {
          return false; // lock صالح بواسطة process آخر
        }
        // lock stale — يمكن استبداله
      } catch {
        // lock file تالف — اعتبره stale
      }
    }

    // atomic acquire: استخدم O_EXCL (exclusive create) لمنع race condition
    // لو processين حاولا في نفس اللحظة، واحد فقط سينجح.
    try {
      const fd = openSync(WARMUP_LOCK_FILE, 'wx'); // 'wx' = O_CREAT|O_EXCL|O_WRONLY
      const lockContent = JSON.stringify({
        pid: process.pid,
        acquired_at: new Date().toISOString(),
      });
      writeFileSync(fd, lockContent);
      closeSync(fd);
      return true;
    } catch {
      // O_EXCL failed = process آخر أكد قبلك
      return false;
    }
  } catch {
    return false;
  }
}

function releaseLockFile(): void {
  try {
    if (existsSync(WARMUP_LOCK_FILE)) {
      unlinkSync(WARMUP_LOCK_FILE);
    }
  } catch {
    // silent — best-effort
  }
}

/**
 * Normalize a market code so cache file lookups are stable.
 * The Python maker_radar.py script accepts `--market EGX|TADAWUL|KSE|QSE|...`
 * and embeds that exact string in the output filename, so we just uppercase +
 * trim here — Arabic names should be normalized upstream via `normalizeMarket()`
 * before reaching the cache layer.
 */
function normalizeMarketCode(market?: string | null): string {
  const m = (market || 'EGX').trim().toUpperCase();
  // Strip anything that isn't a letter / digit / underscore / hyphen —
  // guards against file-system path traversal via ../ in the market param.
  return m.replace(/[^A-Z0-9_-]/g, '') || 'EGX';
}

/**
 * Find the most recent maker_radar cache JSON file in scripts/output/.
 *
 * FIX-P3-P5-P6 (Group P5 — Fix 5):
 *   Cache files are now keyed by market: `maker_radar_{MARKET}_{YYYYMMDD}.json`.
 *   When `market` is provided, only files for THAT market are considered.
 *   For backward compatibility with old cache files (pre-multi-market),
 *   if no market-keyed files exist for the requested market, the function
 *   falls back to the legacy pattern `maker_radar_{YYYYMMDD}.json` (which
 *   was always EGX-only).
 */
export function findLatestRadarFile(market?: string): string | null {
  const marketCode = normalizeMarketCode(market);
  try {
    if (!existsSync(OUTPUT_DIR)) return null;
    const allFiles = readdirSync(OUTPUT_DIR)
      .filter((f) => f.startsWith('maker_radar_') && f.endsWith('.json'));

    // Pattern 1: market-keyed (NEW): maker_radar_{MARKET}_{YYYYMMDD}.json
    const prefix = `maker_radar_${marketCode}_`;
    const marketFiles = allFiles
      .filter((f) => f.startsWith(prefix))
      .sort()
      .reverse();
    if (marketFiles.length > 0) {
      return path.join(OUTPUT_DIR, marketFiles[0]);
    }

    // Pattern 2: legacy (no market in filename) — only valid for EGX.
    // If the caller asked for EGX (or left market blank), fall back to the
    // legacy maker_radar_{YYYYMMDD}.json files. For any other market we
    // return null (no cache yet) so the caller can trigger a fresh warmup.
    if (marketCode === 'EGX') {
      const legacyFiles = allFiles
        .filter((f) => /^maker_radar_\d{8}\.json$/.test(f))
        .sort()
        .reverse();
      if (legacyFiles.length > 0) {
        return path.join(OUTPUT_DIR, legacyFiles[0]);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * L2-ALERTS-EXIT-RADAR: find the most recent exit_radar_*.json file.
 * Used by the exit-radar API endpoint + the radar-alerts scheduler
 * (to fire `radar_exit_signal` alerts when a tracked stock enters an
 * exit path). Returns null if no exit_radar file exists yet — the
 * scheduler silently skips exit-signal detection in that case.
 */
export function findLatestExitRadarFile(): string | null {
  try {
    if (!existsSync(OUTPUT_DIR)) return null;
    const files = readdirSync(OUTPUT_DIR)
      .filter((f) => f.startsWith('exit_radar_') && f.endsWith('.json'))
      .sort()
      .reverse();
    return files.length > 0 ? path.join(OUTPUT_DIR, files[0]) : null;
  } catch {
    return null;
  }
}

/**
 * L2-ALERTS-EXIT-RADAR: read the cached exit radar JSON.
 * Instant (<50ms). Returns null if no cache file exists yet.
 */
export function readExitRadarCache(): { data: any; filePath: string } | null {
  const fp = findLatestExitRadarFile();
  if (!fp || !existsSync(fp)) return null;
  try {
    const raw = readFileSync(fp, 'utf-8');
    const data = JSON.parse(raw);
    return { data, filePath: fp };
  } catch {
    return null;
  }
}

/**
 * P1-8 FIX (RADAR-AUDIT-UI R3): Safe read مع retry على parse error.
 * لو Python script في منتصف كتابة الـ cache file في اللحظة التي يقرأ فيها Node،
 * JSON.parse يرمي SyntaxError. هذا الـ wrapper يعيد المحاولة مرة واحدة بعد 50ms.
 */
function safeReadJson(fp: string): any | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = readFileSync(fp, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      if (attempt === 0) {
        // انتظر 50ms (busy-wait قصير — يتجنب execSync overhead)
        const end = Date.now() + 50;
        while (Date.now() < end) { /* spin */ }
        continue;
      }
      return null;
    }
  }
  return null;
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
    const parsed = safeReadJson(STATUS_FILE);
    return parsed ? { ...def, ...parsed } : def;
  } catch {
    return def;
  }
}

/**
 * P1-8 FIX (RADAR-AUDIT-UI R1): Atomic write عبر temp file + rename.
 * يمنع read-modify-write race condition في multi-worker Next.js.
 * Pattern: اكتب temp file ثم atomic rename (POSIX guarantee).
 */
function writeStatus(s: Partial<RadarCacheStatus>): void {
  try {
    const dir = path.dirname(STATUS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const cur = readStatus();
    const next = { ...cur, ...s };
    // Atomic write: temp file + rename (POSIX atomic guarantee)
    const tempFile = `${STATUS_FILE}.${process.pid}.tmp`;
    writeFileSync(tempFile, JSON.stringify(next, null, 2));
    renameSync(tempFile, STATUS_FILE); // atomic on POSIX systems
  } catch {
    // silent — status file is best-effort
  }
}

/**
 * Read the cached radar JSON. Instant (<50ms). Never blocks on Python.
 * Returns null if no cache file exists yet.
 *
 * FIX-P3-P5-P6 (Group P5 — Fix 5): now accepts an optional `market` so
 * each market has its own cache file (e.g. maker_radar_EGX_20260927.json,
 * maker_radar_TADAWUL_20260927.json).
 */
export function readRadarCache(market?: string): { data: any; filePath: string } | null {
  const fp = findLatestRadarFile(market);
  if (!fp || !existsSync(fp)) return null;
  // P1-8 FIX (R3): استخدم safeReadJson بدل readFileSync مباشرة
  const data = safeReadJson(fp);
  return data ? { data, filePath: fp } : null;
}

/** Is the cache stale (older than threshold)? */
export function isCacheStale(market?: string): boolean {
  const cache = readRadarCache(market);
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

/**
 * Resolve python binary — 100% portable, NO absolute paths.
 *
 * Resolution order:
 *   1. process.env.PYTHON          (explicit override — highest priority)
 *   2. process.env.VIRTUAL_ENV/bin/python3  (set when venv is activated)
 *   3. PROJECT_ROOT/.venv/bin/python3      (project-local venv)
 *   4. Walk up parents looking for .venv    (user-global venv at parent dirs)
 *   5. 'python3'                            (fallback to PATH)
 *
 * This works everywhere because every path is derived from PROJECT_ROOT
 * or environment variables — never hardcoded.
 */
function resolvePython(): string {
  // 1. Explicit override
  if (process.env.PYTHON && existsSync(process.env.PYTHON)) {
    return process.env.PYTHON;
  }

  // 2. VIRTUAL_ENV env var (set by `source venv/bin/activate`)
  if (process.env.VIRTUAL_ENV) {
    const venvPython = path.join(process.env.VIRTUAL_ENV, 'bin', 'python3');
    if (existsSync(venvPython)) return venvPython;
    const venvPythonAlt = path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (existsSync(venvPythonAlt)) return venvPythonAlt;
  }

  // 3. Project-local .venv
  const projectVenvs = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
  ];
  for (const c of projectVenvs) {
    if (existsSync(c)) return c;
  }

  // 4. Walk up parent directories looking for .venv (covers user-global venv)
  let dir = PROJECT_ROOT;
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    const venvInParent = [
      path.join(parent, '.venv', 'bin', 'python3'),
      path.join(parent, '.venv', 'bin', 'python'),
      path.join(parent, 'venv', 'bin', 'python3'),
      path.join(parent, 'venv', 'bin', 'python'),
    ];
    for (const c of venvInParent) {
      if (existsSync(c)) return c;
    }
    dir = parent;
  }

  // 5. Fallback to PATH (system python — may or may not have the deps)
  return 'python3';
}

/**
 * Trigger a background warmup (fire-and-forget). Safe to call multiple times —
 * the mutex prevents concurrent runs. Returns true if a warmup was started,
 * false if one is already running (or failed to start).
 */
export function triggerBackgroundWarmup(market = 'EGX'): boolean {
  if (isWarmupRunning()) return false;
  if (!existsSync(SCRIPT_PATH)) return false;

  // P1-8 FIX (R2): اكتسب cross-process lock قبل بدء Python
  if (!acquireLockFile()) return false;

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
    releaseLockFile(); // P1-8 FIX (R2): حرر الـ cross-process lock
    writeStatus({
      last_warmup_finished_at: new Date().toISOString(),
      last_warmup_duration_ms: Date.now() - startedMonotonic,
      last_warmup_status: 'failed',
      last_error: `spawn error: ${err.message}`,
    });
  });

  child.on('exit', (code) => {
    warmupInMemory = false;
    releaseLockFile(); // P1-8 FIX (R2): حرر الـ cross-process lock
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedMonotonic;

    if (code === 0) {
      // Read the freshly-generated file to extract metadata
      const cache = readRadarCache(market);
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

      // Fire-and-forget: trigger smart radar alerts after a successful warmup
      import('@/lib/schedulers/radar-alerts')
        .then((mod) => mod.runRadarAlertsCheck())
        .catch(() => {/* silent — alerts are best-effort */})
        .finally(() => {/* no-op */});
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

  // P1-8 FIX (R2): اكتسب cross-process lock قبل بدء Python
  if (!acquireLockFile()) {
    throw new Error('Another warmup is running (cross-process lock held)');
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
      releaseLockFile(); // P1-8 FIX (R2)
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
      releaseLockFile(); // P1-8 FIX (R2)
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
      releaseLockFile(); // P1-8 FIX (R2): حرر الـ cross-process lock
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMonotonic;
      const cache = readRadarCache(market);

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

        // Fire-and-forget: trigger smart radar alerts after a successful warmup
        import('@/lib/schedulers/radar-alerts')
          .then((mod) => mod.runRadarAlertsCheck())
          .catch(() => {/* silent — alerts are best-effort */})
          .finally(() => {/* no-op */});

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
export function getLiveStatus(market?: string): RadarCacheStatus {
  const status = readStatus();
  const cache = readRadarCache(market);
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
