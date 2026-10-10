import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';

// GET /api/admin/telegram-report?dry_run=1 — preview report
// POST /api/admin/telegram-report — send to Telegram
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const send = !dryRun;

  try {
    const python = 'python3';
    const scriptPath = path.join(process.cwd(), 'scripts', 'telegram_comprehensive_report.py');
    const args = [scriptPath, send ? '--send' : '--dry-run'];

    return new Promise<NextResponse>((resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(python, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });

      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        resolve(NextResponse.json({ success: false, error: 'timeout' }, { status: 504 }));
      }, 30000);

      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(NextResponse.json({
          success: code === 0,
          report: stdout,
          sent: send,
          stderr: stderr.slice(-500),
        }));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 }));
      });
    });
  } catch (error: any) {
    console.error('[admin:telegram-report]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const python = 'python3';
    const scriptPath = path.join(process.cwd(), 'scripts', 'telegram_comprehensive_report.py');
    const args = [scriptPath, '--send'];

    return new Promise<NextResponse>((resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(python, args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });

      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        resolve(NextResponse.json({ success: false, error: 'timeout' }, { status: 504 }));
      }, 30000);

      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(NextResponse.json({
          success: code === 0,
          report: stdout,
          sent: true,
          stderr: stderr.slice(-500),
        }));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 }));
      });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
