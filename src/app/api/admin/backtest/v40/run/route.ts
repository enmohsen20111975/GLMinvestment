import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { spawn } from 'child_process';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync with async access from
// fs/promises so the POST handler never blocks the event loop on file checks.
import { access } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RunBody {
  start_date?: string;
  end_date?: string;
  max_picks?: number;
  clear_existing?: boolean;
}

// P0-14-ASYNC fix (2026-09-27): async helper to check file existence.
async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { /* safe-by-design */ return false; }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = await req.json() as RunBody;
    const startDate = body.start_date || '2025-12-01';
    const endDate = body.end_date || '2026-08-27';
    const maxPicks = body.max_picks || 5;
    const clearExisting = body.clear_existing !== false; // default true

    const projectRoot = process.cwd();
    const predsDbPath = join(projectRoot, 'db', 'predictions.db');

    // Clear predictions if requested
    if (clearExisting && await pathExists(predsDbPath)) {
      try {
        const db = new Database(predsDbPath);
        db.prepare('DELETE FROM predictions').run();
        db.close();
      } catch { // silent fallback (safe-by-design)
        // Table might not exist — ignore
      }
    }

    // Generate job ID + log file
    const jobId = randomUUID().slice(0, 8);
    const logFile = `/tmp/v40_backtest_${jobId}.log`;
    const generatorPath = join(projectRoot, 'vps-service', 'jobs', 'daily_predictor.py');

    if (!(await pathExists(generatorPath))) {
      return NextResponse.json({
        success: false,
        error: 'Prediction generator not found',
        path: generatorPath,
      }, { status: 500 });
    }

    // Spawn V40.2 generator as subprocess (non-blocking)
    // After V40.2 finishes, run daily_closer to close all pending predictions
    // (so stats include actual returns)
    const args = [
      generatorPath,
      '--start', startDate,
      '--end', endDate,
      '--scan-interval', '3',
      '--max-picks', String(maxPicks),
      '--force',
    ];

    const closerPath = join(projectRoot, 'vps-service', 'jobs', 'daily_closer.py');

    const logStream = createWriteStream(logFile, { flags: 'w' });
    const child = spawn('python3', args, {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Pipe output to log file
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    // When V40.2 generator finishes, run daily_closer to close all pending
    child.on('exit', (code) => {
      logStream.write(`\n[V40.2 GENERATOR] exited with code ${code}\n`);
      if (code === 0) {
        logStream.write(`[DAILY_CLOSER] Starting daily_closer to close all pending predictions...\n`);
        const closerArgs = [closerPath];
        const closerLogStream = createWriteStream(logFile, { flags: 'a' });
        const closerChild = spawn('python3', closerArgs, {
          cwd: projectRoot,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        closerChild.stdout?.pipe(closerLogStream);
        closerChild.stderr?.pipe(closerLogStream);
        closerChild.on('exit', (closerCode) => {
          closerLogStream.write(`\n[DAILY_CLOSER] exited with code ${closerCode}\n`);
          closerLogStream.write(`[BACKTEST JOB ${jobId}] COMPLETED at ${new Date().toISOString()}\n`);
          closerLogStream.end();
        });
        closerChild.unref();
      } else {
        logStream.write(`[BACKTEST JOB ${jobId}] FAILED (generator exited with code ${code}) at ${new Date().toISOString()}\n`);
        logStream.end();
      }
    });

    // Detach so it survives the request
    child.unref();

    // Write initial log entry
    logStream.write(`[BACKTEST JOB ${jobId}] Started at ${new Date().toISOString()}\n`);
    logStream.write(`  start_date: ${startDate}\n  end_date: ${endDate}\n  max_picks: ${maxPicks}\n`);
    logStream.write(`  pid: ${child.pid}\n  log_file: ${logFile}\n\n`);

    console.log(`[V40 Backtest] Job ${jobId} started (pid=${child.pid})`);

    return NextResponse.json({
      success: true,
      data: {
        job_id: jobId,
        pid: child.pid,
        message: `Backtest started (job ${jobId}). Check status with /api/admin/backtest/v40/status/${jobId}`,
        log_file: logFile,
        start_date: startDate,
        end_date: endDate,
        max_picks: maxPicks,
      },
    });
  } catch (e) {
    console.error('[admin:backtest:v40:run]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
