/**
 * POST /api/admin/engines/stop-all
 * ==================================
 * Task 31-B (Engine Monitor Battalion):
 *   Iterate over all supported engines + stop each via `pkill -f <pattern>`.
 *
 *   Auth: admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const CWD = process.cwd();

const ENGINES: Array<{ key: string; kill_pat: string; label: string }> = [
  // Task 33 (ROOT-CAUSE-FIRST): kill_pat now matches the Flask daemon entry
  // point (data_engine/main.py), not the multi_market_scraper cron job.
  { key: 'data_engine', kill_pat: 'data_engine/main.py', label: 'محرك البيانات' },
  { key: 'news', kill_pat: 'news-agent', label: 'محرك الأخبار' },
  { key: 'predictions', kill_pat: 'daily_predictor.py', label: 'محرك التوقعات' },
  { key: 'learning', kill_pat: 'learning_engine.py', label: 'محرك التعلّم الذكي' },
  { key: 'sharia', kill_pat: 'sharia_compliance_scraper.py', label: 'الفحص الشرعي' },
];

async function runShell(cmd: string, timeoutMs = 10000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: CWD,
      timeout: timeoutMs,
      env: { ...process.env, PATH: process.env.PATH || '' },
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: any) {
    return {
      ok: false,
      stdout: err.stdout?.toString()?.trim() || '',
      stderr: err.stderr?.toString()?.trim() || '',
    };
  }
}

async function listPids(pattern: string): Promise<number[]> {
  // IMPORTANT: use execFile + separate argv so the pattern isn't in any
  // shell's argv (pgrep would otherwise match the shell wrapper).
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', pattern], { timeout: 5000 });
    return stdout
      .split('\n')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const results = await Promise.all(
    ENGINES.map(async (spec) => {
      const pidsBefore = await listPids(spec.kill_pat);
      if (pidsBefore.length === 0) {
        return {
          engine: spec.key,
          label: spec.label,
          success: true,
          message: 'لم يكن يعمل أصلاً',
          pids_before: [] as number[],
          pids_after: [] as number[],
        };
      }
      await runShell(`pkill -f "${spec.kill_pat}" 2>/dev/null; true`, 8000);
      await new Promise(r => setTimeout(r, 400));
      const pidsAfter = await listPids(spec.kill_pat);
      return {
        engine: spec.key,
        label: spec.label,
        success: pidsAfter.length === 0,
        message: pidsAfter.length === 0
          ? `تم إيقاف ${pidsBefore.length} عملية`
          : `${pidsAfter.length} عملية لا تزال تعمل (قد تحتاج إيقاف يدوي)`,
        pids_before: pidsBefore,
        pids_after: pidsAfter,
      };
    }),
  );

  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  return NextResponse.json({
    success: successCount === totalCount,
    action: 'stop-all',
    timestamp: new Date().toISOString(),
    summary: {
      total: totalCount,
      success: successCount,
      failed: totalCount - successCount,
    },
    results,
  });
}

// GET — alias for POST so admins can curl it without -X
export async function GET(req: NextRequest) {
  return POST(req);
}
