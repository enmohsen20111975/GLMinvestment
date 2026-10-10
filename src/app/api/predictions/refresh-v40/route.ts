import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync/readFileSync/
// writeFileSync/mkdirSync with async fs/promises equivalents so the
// refresh-v40 POST+GET handlers never block the event loop on status JSON I/O.
// Note: writeStatus / readStatus are also called from spawn callbacks — these
// callbacks are async so awaiting fs/promises is safe there too.
import { access, readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300; // V40.2 can take 60-90s on the full 272-ticker universe

const PROJECT_ROOT = process.cwd();
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'vps-service', 'jobs', 'daily_predictor.py');
const STATUS_FILE = path.join(PROJECT_ROOT, 'db', 'v40_generation_status.json');

interface V40Status {
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_duration_ms: number | null;
  last_run_status: 'idle' | 'running' | 'success' | 'failed';
  last_error: string | null;
  total_predictions: number | null;
  scan_dates: string[];
  raw_output_tail: string | null;
}

let v40InMemory = false;
const V40_MUTEX_TTL_MS = 10 * 60 * 1000; // 10 min — V40.2 can be slow on big DBs

// P0-14-ASYNC fix (2026-09-27): async helper to check file existence.
async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { /* safe-by-design */ return false; }
}

/**
 * Resolve python binary — 100% portable, NO absolute paths.
 * Same logic as radar-cache.ts — see that file for full docs.
 */
// P0-14-ASYNC fix (2026-09-27): resolvePython is now async — uses access().
async function resolvePython(): Promise<string> {
  // 1. Explicit override
  if (process.env.PYTHON && await pathExists(process.env.PYTHON)) {
    return process.env.PYTHON;
  }
  // 2. VIRTUAL_ENV env var (set by `source venv/bin/activate`)
  if (process.env.VIRTUAL_ENV) {
    const venvPython = path.join(process.env.VIRTUAL_ENV, 'bin', 'python3');
    if (await pathExists(venvPython)) return venvPython;
    const venvPythonAlt = path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (await pathExists(venvPythonAlt)) return venvPythonAlt;
  }
  // 3. Project-local .venv / venv
  const projectVenvs = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
  ];
  for (const c of projectVenvs) {
    if (await pathExists(c)) return c;
  }
  // 4. Walk up parent directories looking for .venv (user-global venv)
  let dir = PROJECT_ROOT;
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    const venvInParent = [
      path.join(parent, '.venv', 'bin', 'python3'),
      path.join(parent, '.venv', 'bin', 'python'),
      path.join(parent, 'venv', 'bin', 'python3'),
      path.join(parent, 'venv', 'bin', 'python'),
    ];
    for (const c of venvInParent) {
      if (await pathExists(c)) return c;
    }
    dir = parent;
  }
  // 5. Fallback to PATH
  return 'python3';
}

// P0-14-ASYNC fix (2026-09-27): readStatus is now async.
async function readStatus(): Promise<V40Status> {
  const def: V40Status = {
    last_run_started_at: null,
    last_run_finished_at: null,
    last_run_duration_ms: null,
    last_run_status: 'idle',
    last_error: null,
    total_predictions: null,
    scan_dates: [],
    raw_output_tail: null,
  };
  try {
    if (!(await pathExists(STATUS_FILE))) return def;
    const raw = await readFile(STATUS_FILE, 'utf-8');
    return { ...def, ...JSON.parse(raw) };
  } catch { // silent fallback (safe-by-design)
    return def;
  }
}

// P0-14-ASYNC fix (2026-09-27): writeStatus is now async.
async function writeStatus(s: Partial<V40Status>): Promise<void> {
  try {
    const dir = path.dirname(STATUS_FILE);
    if (!(await pathExists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    const cur = await readStatus();
    await writeFile(STATUS_FILE, JSON.stringify({ ...cur, ...s }, null, 2));
  } catch { // silent fallback (safe-by-design)
    // silent
  }
}

// P0-14-ASYNC fix (2026-09-27): isV40Running is now async (uses readStatus).
async function isV40Running(): Promise<boolean> {
  if (v40InMemory) return true;
  const status = await readStatus();
  if (status.last_run_status !== 'running') return false;
  if (status.last_run_started_at) {
    const ageMs = Date.now() - new Date(status.last_run_started_at).getTime();
    if (ageMs > V40_MUTEX_TTL_MS) return false;
  }
  return false;
}

function parseV40Output(stdout: string, stderr: string): { totalPredictions: number; scanDates: string[] } {
  // The script prints: "✅ Processed N tickers. Signals found on M dates."
  // and "📊 Predictions in: /path/db/predictions.db"
  // and "📅 Scan dates: ['2026-09-03']"
  let totalPredictions = 0;
  const scanDates: string[] = [];

  const m1 = stdout.match(/Total predictions:\s*(\d+)/);
  if (m1) totalPredictions = parseInt(m1[1], 10);

  const m2 = stdout.match(/Scan dates:\s*\[([^\]]+)\]/);
  if (m2) {
    scanDates.push(...m2[1].match(/'(\d{4}-\d{2}-\d{2})'/g)?.map((s) => s.replace(/'/g, '')) || []);
  }

  return { totalPredictions, scanDates };
}

/**
 * POST /api/predictions/refresh-v40?mode=today
 *
 * Runs the V40.2 daily generator directly via subprocess (bypasses the
 * Python service on port 8010 — which is often down on production).
 *
 * Modes:
 *   - today      (default) → --today-only
 *   - yesterday            → --yesterday-only
 *   - full                 → no date flag (full historical run — SLOW)
 *
 * Returns when the generator finishes (or times out at 240s).
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'today';
  const timeoutMs = Math.min(parseInt(url.searchParams.get('timeout') || '240000', 10), 240_000);

  if (!(await pathExists(SCRIPT_PATH))) {
    return NextResponse.json(
      { success: false, error: `Script not found: ${SCRIPT_PATH}` },
      { status: 500 }
    );
  }

  if (await isV40Running()) {
    return NextResponse.json({
      success: false,
      already_running: true,
      error: 'Prediction generator is already running — wait for it to finish',
      status: await readStatus(),
    }, { status: 409 });
  }

  const python = await resolvePython();
  const args: string[] = [SCRIPT_PATH];
  if (mode === 'today') args.push('--today-only');
  else if (mode === 'yesterday') args.push('--yesterday-only');
  // mode === 'full' → no date flag

  v40InMemory = true;
  const startedAt = new Date().toISOString();
  const startedMonotonic = Date.now();
  await writeStatus({
    last_run_started_at: startedAt,
    last_run_status: 'running',
    last_error: null,
    raw_output_tail: null,
  });

  return new Promise((resolve) => {
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
      try { child.kill('SIGKILL'); } catch { /* safe-by-design */ }
      v40InMemory = false;
      // P0-14-ASYNC fix (2026-09-27): readStatus/writeStatus are now async; use
      // an async IIFE to await them inside the setTimeout callback.
      (async () => {
        const status: V40Status = {
          ...await readStatus(),
          last_run_finished_at: new Date().toISOString(),
          last_run_duration_ms: Date.now() - startedMonotonic,
          last_run_status: 'failed',
          last_error: `timeout after ${timeoutMs}ms`,
          raw_output_tail: (stdout + '\n---STDERR---\n' + stderr).slice(-3000),
        };
        await writeStatus(status);
        resolve(NextResponse.json({ success: false, error: 'timeout', status }, { status: 504 }));
      })();
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      v40InMemory = false;
      (async () => {
        const status: V40Status = {
          ...await readStatus(),
          last_run_finished_at: new Date().toISOString(),
          last_run_duration_ms: Date.now() - startedMonotonic,
          last_run_status: 'failed',
          last_error: `spawn error: ${err.message}`,
        };
        await writeStatus(status);
        resolve(NextResponse.json({ success: false, error: 'internal_error', status }, { status: 500 }));
      })();
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      v40InMemory = false;
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMonotonic;
      const { totalPredictions, scanDates } = parseV40Output(stdout, stderr);

      (async () => {
        if (code === 0) {
          const status: V40Status = {
            last_run_started_at: startedAt,
            last_run_finished_at: finishedAt,
            last_run_duration_ms: durationMs,
            last_run_status: 'success',
            last_error: null,
            total_predictions: totalPredictions,
            scan_dates: scanDates,
            raw_output_tail: stdout.slice(-2000),
          };
          await writeStatus(status);
          resolve(NextResponse.json({
            success: true,
            status,
            elapsed_ms: durationMs,
            total_predictions: totalPredictions,
            scan_dates: scanDates,
          }));
        } else {
          const errMsg = stderr.trim().slice(0, 2000) || `exit code ${code}`;
          const status: V40Status = {
            ...await readStatus(),
            last_run_finished_at: finishedAt,
            last_run_duration_ms: durationMs,
            last_run_status: 'failed',
            last_error: errMsg,
            raw_output_tail: (stdout + '\n---STDERR---\n' + stderr).slice(-3000),
          };
          await writeStatus(status);
          resolve(NextResponse.json({
            success: false,
            error: `script exited with code ${code}`,
            status,
            stdout_tail: stdout.slice(-1500),
            stderr_tail: stderr.slice(-1500),
          }, { status: 500 }));
        }
      })();
    });
  });
}

/**
 * GET /api/predictions/refresh-v40
 * Returns the current V40.2 generation status (no run).
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    running: await isV40Running(),
    status: await readStatus(),
  });
}
