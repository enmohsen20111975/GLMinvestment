import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync/readFileSync/statSync/execSync
// with async fs/promises equivalents and promisified execFile so the event loop
// is not blocked while reading job logs or running `ps`.
import { access, readFile, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const { jobId } = await params;
    const logFile = `/tmp/v40_backtest_${jobId}.log`;

    // P0-14-ASYNC fix (2026-09-27): existsSync → access (async).
    try {
      await access(logFile);
    } catch {
      return NextResponse.json({
        success: true,
        data: { status: 'unknown', message: 'Job not found', log_tail: [] },
      });
    }

    // Read log file (async)
    const content = await readFile(logFile, 'utf-8');
    const lines = content.split('\n');
    const logTail = lines.slice(-25).filter(l => l.trim());

    // Check if process is still running (async execFile instead of execSync)
    let running = false;
    try {
      // pgrep returns exit code 1 when no matches; execFile throws on non-zero exit.
      const { stdout } = await execFileAsync('pgrep', ['-f', 'daily_predictor'], { timeout: 3000 });
      running = stdout.trim().length > 0;
    } catch {
      running = false;
    }

    // Check if completed
    const completed = content.includes('GENERATION COMPLETE') ||
                      content.includes('Total predictions:');

    // Get log file modification time (async)
    const stats = await stat(logFile);
    const lastModified = stats.mtime.toISOString();
    const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;

    // If process not running and not completed but log is old → likely finished
    const status = completed ? 'completed' : (running ? 'running' : (ageSeconds > 60 ? 'completed' : 'stopped'));

    return NextResponse.json({
      success: true,
      data: {
        status,
        completed,
        running,
        log_tail: logTail,
        log_file: logFile,
        last_modified: lastModified,
        age_seconds: Math.round(ageSeconds),
      },
    });
  } catch (e) {
    console.error('[admin:backtest:v40:status:[jobId]]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
