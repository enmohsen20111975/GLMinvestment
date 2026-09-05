import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300; // V40.2 can take 60-90s on the full 272-ticker universe

const PROJECT_ROOT = process.cwd();
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'vps-service', 'jobs', 'v40_2_daily_generator.py');
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

/**
 * Resolve python binary — 100% portable, NO absolute paths.
 * Same logic as radar-cache.ts — see that file for full docs.
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
  // 3. Project-local .venv / venv
  const projectVenvs = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
  ];
  for (const c of projectVenvs) {
    if (existsSync(c)) return c;
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
      if (existsSync(c)) return c;
    }
    dir = parent;
  }
  // 5. Fallback to PATH
  return 'python3';
}

function readStatus(): V40Status {
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
    if (!existsSync(STATUS_FILE)) return def;
    return { ...def, ...JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) };
  } catch {
    return def;
  }
}

function writeStatus(s: Partial<V40Status>): void {
  try {
    const dir = path.dirname(STATUS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const cur = readStatus();
    writeFileSync(STATUS_FILE, JSON.stringify({ ...cur, ...s }, null, 2));
  } catch {
    // silent
  }
}

function isV40Running(): boolean {
  if (v40InMemory) return true;
  const status = readStatus();
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

  if (!existsSync(SCRIPT_PATH)) {
    return NextResponse.json(
      { success: false, error: `Script not found: ${SCRIPT_PATH}` },
      { status: 500 }
    );
  }

  if (isV40Running()) {
    return NextResponse.json({
      success: false,
      already_running: true,
      error: 'V40.2 generator is already running — wait for it to finish',
      status: readStatus(),
    }, { status: 409 });
  }

  const python = resolvePython();
  const args: string[] = [SCRIPT_PATH];
  if (mode === 'today') args.push('--today-only');
  else if (mode === 'yesterday') args.push('--yesterday-only');
  // mode === 'full' → no date flag

  v40InMemory = true;
  const startedAt = new Date().toISOString();
  const startedMonotonic = Date.now();
  writeStatus({
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
      try { child.kill('SIGKILL'); } catch {}
      v40InMemory = false;
      const status: V40Status = {
        ...readStatus(),
        last_run_finished_at: new Date().toISOString(),
        last_run_duration_ms: Date.now() - startedMonotonic,
        last_run_status: 'failed',
        last_error: `timeout after ${timeoutMs}ms`,
        raw_output_tail: (stdout + '\n---STDERR---\n' + stderr).slice(-3000),
      };
      writeStatus(status);
      resolve(NextResponse.json({ success: false, error: 'timeout', status }, { status: 504 }));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      v40InMemory = false;
      const status: V40Status = {
        ...readStatus(),
        last_run_finished_at: new Date().toISOString(),
        last_run_duration_ms: Date.now() - startedMonotonic,
        last_run_status: 'failed',
        last_error: `spawn error: ${err.message}`,
      };
      writeStatus(status);
      resolve(NextResponse.json({ success: false, error: err.message, status }, { status: 500 }));
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      v40InMemory = false;
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMonotonic;
      const { totalPredictions, scanDates } = parseV40Output(stdout, stderr);

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
        writeStatus(status);
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
          ...readStatus(),
          last_run_finished_at: finishedAt,
          last_run_duration_ms: durationMs,
          last_run_status: 'failed',
          last_error: errMsg,
          raw_output_tail: (stdout + '\n---STDERR---\n' + stderr).slice(-3000),
        };
        writeStatus(status);
        resolve(NextResponse.json({
          success: false,
          error: `script exited with code ${code}`,
          status,
          stdout_tail: stdout.slice(-1500),
          stderr_tail: stderr.slice(-1500),
        }, { status: 500 }));
      }
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
    running: isV40Running(),
    status: readStatus(),
  });
}
