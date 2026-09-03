import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const { jobId } = await params;
    const logFile = `/tmp/v40_backtest_${jobId}.log`;

    if (!existsSync(logFile)) {
      return NextResponse.json({
        success: true,
        data: { status: 'unknown', message: 'Job not found', log_tail: [] },
      });
    }

    // Read log file
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    const logTail = lines.slice(-25).filter(l => l.trim());

    // Check if process is still running
    let running = false;
    try {
      const psOutput = execSync(`ps aux | grep "v40_2_daily_generator" | grep -v grep`, {
        encoding: 'utf-8',
        timeout: 3000,
      });
      running = psOutput.length > 0;
    } catch {
      running = false;
    }

    // Check if completed
    const completed = content.includes('GENERATION COMPLETE') ||
                      content.includes('Total predictions:');

    // Get log file modification time
    const stats = statSync(logFile);
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
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
