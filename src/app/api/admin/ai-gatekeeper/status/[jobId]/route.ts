import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
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
    const logFile = `/tmp/lgbm_train_${jobId}.log`;

    try {
      await access(logFile);
    } catch {
      return NextResponse.json({
        success: true,
        data: { status: 'unknown', message: 'Job not found', log_tail: [] },
      });
    }

    const content = await readFile(logFile, 'utf-8');
    const lines = content.split('\n');
    const logTail = lines.slice(-25).filter(l => l.trim());

    let running = false;
    try {
      const { stdout } = await execFileAsync('pgrep', ['-f', 'train_signal_classifier_lgbm'], { timeout: 3000 });
      running = stdout.trim().length > 0;
    } catch {
      running = false;
    }

    const completed = content.includes('LIGHTGBM SIGNAL GATEKEEPER TRAINING COMPLETE') ||
                      content.includes('Model artifact saved');

    const stats = await stat(logFile);
    const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
    const status = completed ? 'completed' : (running ? 'running' : (ageSeconds > 60 ? 'completed' : 'stopped'));

    return NextResponse.json({
      success: true,
      data: {
        status,
        completed,
        running,
        log_tail: logTail,
        age_seconds: Math.round(ageSeconds),
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
