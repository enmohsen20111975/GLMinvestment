/**
 * POST /api/admin/close-predictions
 * ================================
 * محرك إغلاق التوقعات — يشغّل سكريبت Python اللي يقارن الأسعار
 * بـ target/stop ويحدّث الـ status + P&L.
 *
 * Body: { table?: 'persona'|'master'|'all', expireDays?: number, dryRun?: boolean }
 * Returns: { success, output, stats, elapsedMs }
 */
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { existsSync } from 'fs';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 minutes

const SCRIPT_PATH = path.join(process.cwd(), 'vps-service', 'scripts', 'close_predictions.py');

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json().catch(() => ({}));
    const table = body.table || 'all'; // 'persona' | 'master' | 'all'
    const expireDays = parseInt(body.expireDays || '30', 10);
    const dryRun = Boolean(body.dryRun);

    if (!existsSync(SCRIPT_PATH)) {
      return NextResponse.json(
        { success: false, error: 'close_predictions.py not found', path: SCRIPT_PATH },
        { status: 500 }
      );
    }

    const args = [
      SCRIPT_PATH,
      '--table', table,
      '--expire-days', String(expireDays),
    ];
    if (dryRun) args.push('--dry-run');

    const start = Date.now();
    const { stdout, stderr } = await execFileAsync('python3', args, {
      cwd: process.cwd(),
      timeout: 100000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env },
    });
    const elapsedMs = Date.now() - start;

    // Parse the JSON summary from stdout
    let summary = null;
    try {
      const lines = stdout.trim().split('\n');
      const jsonLine = lines.find((l) => l.trim().startsWith('{') && l.includes('"success"'));
      if (jsonLine) summary = JSON.parse(jsonLine);
    } catch {}

    return NextResponse.json({
      success: true,
      dryRun,
      table,
      expireDays,
      elapsedMs,
      summary,
      output: stdout.slice(-4000),
      stderr: stderr ? stderr.slice(-2000) : '',
    });
  } catch (error: any) {
    console.error('[close-predictions] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: String(error?.message || error),
        stderr: error?.stderr ? String(error.stderr).slice(-2000) : '',
        stdout: error?.stdout ? String(error.stdout).slice(-2000) : '',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/close-predictions
 * Returns current prediction status distribution (for the admin UI badge).
 */
export async function GET(request: Request) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const { openDb } = await import('@/lib/shared-db');
    const db = openDb('predictions.db');
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'predictions.db not available' },
        { status: 503 }
      );
    }

    try {
      const personaStats = db.prepare(
        "SELECT status, COUNT(*) as c FROM persona_predictions GROUP BY status"
      ).all();
      const masterOpen = db.prepare(
        "SELECT COUNT(*) as c FROM predictions WHERE outcome_date IS NULL"
      ).get() as { c: number };
      const masterClosed = db.prepare(
        "SELECT COUNT(*) as c FROM predictions WHERE outcome_date IS NOT NULL"
      ).get() as { c: number };
      const masterHitTarget = db.prepare(
        "SELECT COUNT(*) as c FROM predictions WHERE hit_target = 1"
      ).get() as { c: number };

      return NextResponse.json({
        success: true,
        persona_predictions: personaStats,
        master: {
          open: masterOpen.c,
          closed: masterClosed.c,
          hit_target: masterHitTarget.c,
        },
        scriptPath: SCRIPT_PATH,
      });
    } finally {
      db.close();
    }
  } catch (error: any) {
    console.error('[close-predictions GET] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error?.message || error) },
      { status: 500 }
    );
  }
}
