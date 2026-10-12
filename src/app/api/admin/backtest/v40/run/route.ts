/**
 * POST /api/admin/backtest/v40/run — SAFE Institutional Backtest Runner
 * ====================================================================
 *
 * Runs the read-only Institutional Backtest engine (Rule 1 + Rule 20 compliant).
 * NEVER deletes predictions table. Uses read-only mode `file:...?mode=ro`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { spawn } from 'child_process';
import { openSync, closeSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const jobId = randomUUID().slice(0, 12);
  const logPath = `/tmp/v40_backtest_${jobId}.log`;

  try {
    const projectRoot = process.cwd();
    const scriptPath = join(projectRoot, 'scripts', 'institutional_multi_market_backtest.py');

    const logFd = openSync(logPath, 'a');

    // Spawn Python institutional backtest in background (read-only, 100% safe)
    const child = spawn('python3', [scriptPath], {
      cwd: projectRoot,
      env: { ...process.env, PROJECT_ROOT: projectRoot },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });

    child.on('close', (code) => {
      try {
        closeSync(logFd);
      } catch {}
    });

    child.unref();

    return NextResponse.json({
      success: true,
      jobId,
      message: 'تم إطلاق الباك-تست المؤسسي الآمن في الخلفية بنجاح.',
      logFile: logPath,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message || 'فشل تشغيل الباك-تست',
    }, { status: 500 });
  }
}
