import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { spawn } from 'child_process';
import path from 'path';
import { readFileSync, existsSync, writeFileSync } from 'fs';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const STATUS_FILE = path.join(PROJECT_ROOT, 'db', 'v40_engine_status.json');

interface V40EngineStatus {
  running: boolean;
  pid: number | null;
  started_at: string | null;
  last_run_at: string | null;
  last_run_status: 'success' | 'failed' | 'timeout' | null;
  last_run_duration_ms: number | null;
  last_picks_generated: number | null;
  last_error: string | null;
  total_runs: number;
  total_picks: number;
}

function readStatus(): V40EngineStatus {
  const def: V40EngineStatus = {
    running: false, pid: null, started_at: null, last_run_at: null,
    last_run_status: null, last_run_duration_ms: null, last_picks_generated: null,
    last_error: null, total_runs: 0, total_picks: 0,
  };
  try {
    if (!existsSync(STATUS_FILE)) return def;
    return { ...def, ...JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) };
  } catch { return def; }
}

function writeStatus(s: Partial<V40EngineStatus>): void {
  try {
    const cur = readStatus();
    const next = { ...cur, ...s };
    writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2));
  } catch {}
}

function resolvePython(): string {
  // Same resolver as radar-cache.ts
  const candidates = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
    path.join(process.env.HOME || '/root', '.venv', 'bin', 'python3'),
    'python3',
  ];
  for (const c of candidates) {
    if (c === 'python3') return c;
    try { if (existsSync(c)) return c; } catch {}
  }
  return 'python3';
}

// GET /api/admin/v40-control — returns current V40.2 engine status
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const status = readStatus();

    // Also check predictions DB for latest prediction
    let latestPrediction: { date: string; count: number } | null = null;
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(PROJECT_ROOT, 'db', 'predictions.db');
      const db = new Database(dbPath, { readonly: true });
      const count = db.prepare('SELECT COUNT(*) as c FROM predictions').get().c;
      const latest = db.prepare('SELECT MAX(prediction_date) as m FROM predictions').get();
      latestPrediction = { date: latest?.m || 'N/A', count };
      db.close();
    } catch {}

    // Check stored_analyses
    let storedAnalysesCount = 0;
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(PROJECT_ROOT, 'db', 'predictions.db');
      const db = new Database(dbPath, { readonly: true });
      storedAnalysesCount = db.prepare('SELECT COUNT(*) as c FROM stored_analyses').get().c;
      db.close();
    } catch {}

    // Check cron config
    let cronConfig = 'not_found';
    try {
      const cronPath = path.join(PROJECT_ROOT, 'crontab.txt');
      if (existsSync(cronPath)) {
        const cronContent = readFileSync(cronPath, 'utf-8');
        const v40Lines = cronContent.split('\n').filter(l => l.includes('daily_predictor'));
        cronConfig = v40Lines.length > 0 ? v40Lines.join('\n') : 'no_v40_cron';
      }
    } catch {}

    return NextResponse.json({
      success: true,
      engine: 'V40.2',
      status,
      predictions: latestPrediction,
      stored_analyses: storedAnalysesCount,
      cron: cronConfig,
      script_path: path.join(PROJECT_ROOT, 'vps-service', 'jobs', 'daily_predictor.py'),
    });
  } catch (error: any) {
    console.error('[admin:v40-control]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

// POST /api/admin/v40-control — trigger V40.2 run
// Body: { action: 'run_today' | 'run_yesterday' | 'run_range', start?, end?, force?, keep_old?, max_tickers? }
export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const { action, start, end, force, keep_old, max_tickers } = body;

    const python = resolvePython();
    const scriptPath = path.join(PROJECT_ROOT, 'vps-service', 'jobs', 'daily_predictor.py');

    // Build args
    const args: string[] = [scriptPath];
    if (action === 'run_today') args.push('--today-only');
    else if (action === 'run_yesterday') args.push('--yesterday-only');
    else if (action === 'run_range' && start && end) { args.push('--start', start, '--end', end); }
    if (keep_old) args.push('--keep-old');
    if (force) args.push('--force');
    if (max_tickers && max_tickers > 0) { args.push('--max-tickers', String(max_tickers)); }

    // Set env vars for sandbox testing
    const env = { ...process.env, PYTHONUNBUFFERED: '1' };
    if (force) env.FORCE_NORMAL_REGIME = '1';

    // Update status to running
    writeStatus({ running: true, started_at: new Date().toISOString(), last_error: null });

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    return new Promise<NextResponse>((resolve) => {
      // Use spawn with timeout
      const child = spawn(python, args, {
        cwd: PROJECT_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000, // 2 minutes max
      });

      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        const status = readStatus();
        writeStatus({
          running: false,
          last_run_at: new Date().toISOString(),
          last_run_status: 'timeout',
          last_run_duration_ms: Date.now() - startTime,
          last_error: 'timeout after 120s',
          total_runs: status.total_runs + 1,
        });
        resolve(NextResponse.json({
          success: false,
          error: 'timeout',
          error_ar: 'انتهت المهلة (120 ثانية) — جرّب --max-tickers لتقليل عدد الأسهم',
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-1000),
        }, { status: 504 }));
      }, 120000);

      child.on('exit', (code) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;

        // Parse picks from stdout
        const picksMatch = stdout.match(/Total predictions:\s*(\d+)/);
        const picks = picksMatch ? parseInt(picksMatch[1]) : 0;

        const status = readStatus();
        writeStatus({
          running: false,
          last_run_at: new Date().toISOString(),
          last_run_status: code === 0 ? 'success' : 'failed',
          last_run_duration_ms: duration,
          last_picks_generated: picks,
          last_error: code !== 0 ? stderr.slice(-500) : null,
          total_runs: status.total_runs + 1,
          total_picks: status.total_picks + picks,
        });

        resolve(NextResponse.json({
          success: code === 0,
          exit_code: code,
          duration_ms: duration,
          picks_generated: picks,
          stdout: stdout.slice(-3000),
          stderr: stderr.slice(-1000),
          status: 'completed',
        }));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const status = readStatus();
        writeStatus({
          running: false,
          last_run_at: new Date().toISOString(),
          last_run_status: 'failed',
          last_error: `spawn: ${err.message}`,
          total_runs: status.total_runs + 1,
        });
        resolve(NextResponse.json({
          success: false,
          error: 'internal_error',
          status: 'spawn_error',
        }, { status: 500 }));
      });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
