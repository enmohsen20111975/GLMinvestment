import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, readFileSync } from 'fs';
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
    if (clearExisting && existsSync(predsDbPath)) {
      try {
        const db = new Database(predsDbPath);
        db.prepare('DELETE FROM predictions').run();
        db.close();
      } catch {
        // Table might not exist — ignore
      }
    }

    // Generate job ID + log file
    const jobId = randomUUID().slice(0, 8);
    const logFile = `/tmp/v40_backtest_${jobId}.log`;
    const generatorPath = join(projectRoot, 'vps-service', 'jobs', 'v40_2_daily_generator.py');

    if (!existsSync(generatorPath)) {
      return NextResponse.json({
        success: false,
        error: 'V40.2 generator not found',
        path: generatorPath,
      }, { status: 500 });
    }

    // Spawn V40.2 generator as subprocess (non-blocking)
    const args = [
      generatorPath,
      '--start', startDate,
      '--end', endDate,
      '--scan-interval', '3',
      '--max-picks', String(maxPicks),
      '--force',
    ];

    const logStream = createWriteStream(logFile, { flags: 'w' });
    const child = spawn('python3', args, {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Pipe output to log file
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

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
        message: `V40.2 backtest started (job ${jobId}). Check status with /api/admin/backtest/v40/status/${jobId}`,
        log_file: logFile,
        start_date: startDate,
        end_date: endDate,
        max_picks: maxPicks,
      },
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
