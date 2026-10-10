/**
 * POST /api/admin/engines/start-all
 * ==================================
 * Task 31-B (Engine Monitor Battalion):
 *   Iterate over all supported engines + start each.
 *
 *   Auth: admin only.
 *
 *   Mirrors the per-engine logic in /api/admin/engines/control but batches
 *   them so the UI's "تشغيل كل المحركات" button is a single round-trip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const CWD = process.cwd();
const VENV_PYTHON = join(CWD, '.venv', 'bin', 'python3');

interface EngineSpec {
  start_cmd?: string;
  kill_pat: string;
  label: string;
  log_file: string;
}

const ENGINES: Record<string, EngineSpec> = {
  data_engine: {
    // Task 33 (ROOT-CAUSE-FIRST): start the actual Flask daemon, not the
    // multi_market_scraper cron job (which exits after ~60s).
    start_cmd: `cd ${CWD} && DATA_ENGINE_PORT=3010 ${VENV_PYTHON} data_engine/main.py >> /tmp/data_engine.log 2>&1 &`,
    kill_pat: 'data_engine/main.py',
    label: 'محرك البيانات',
    log_file: '/tmp/data_engine.log',
  },
  news: {
    start_cmd: `cd ${CWD} && ${VENV_PYTHON} -m news-agent.main >> /tmp/news_collector.log 2>&1 &`,
    kill_pat: 'news-agent',
    label: 'محرك الأخبار',
    log_file: '/tmp/news_collector.log',
  },
  predictions: {
    start_cmd: `cd ${CWD} && ${VENV_PYTHON} vps-service/jobs/daily_predictor.py --today-only --max-picks 5 >> /tmp/v40_2_morning.log 2>&1 &`,
    kill_pat: 'daily_predictor.py',
    label: 'محرك التوقعات',
    log_file: '/tmp/v40_2_morning.log',
  },
  learning: {
    start_cmd: `cd ${CWD} && ${VENV_PYTHON} vps-service/jobs/learning_engine.py >> /tmp/learning_engine.log 2>&1 &`,
    kill_pat: 'learning_engine.py',
    label: 'محرك التعلّم الذكي',
    log_file: '/tmp/learning_engine.log',
  },
  sharia: {
    start_cmd: `cd ${CWD} && ${VENV_PYTHON} data_engine/scrapers/sharia_compliance_scraper.py >> /tmp/sharia_scraper.log 2>&1 &`,
    kill_pat: 'sharia_compliance_scraper.py',
    label: 'الفحص الشرعي',
    log_file: '/tmp/sharia_scraper.log',
  },
};

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
  } catch { // silent fallback (safe-by-design)
    return [];
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const pythonAvailable = fs.existsSync(VENV_PYTHON);

  const results = await Promise.all(
    Object.entries(ENGINES).map(async ([key, spec]) => {
      if (!pythonAvailable || !spec.start_cmd) {
        return {
          engine: key,
          label: spec.label,
          success: false,
          message: pythonAvailable ? 'لا يوجد أمر تشغيل' : '.venv غير متاح على هذا الـ host',
          pids: [] as number[],
        };
      }
      const r = await runShell(spec.start_cmd, 5000);
      await new Promise(res => setTimeout(res, 400));
      const pids = await listPids(spec.kill_pat);
      return {
        engine: key,
        label: spec.label,
        success: pids.length > 0,
        message: pids.length > 0
          ? `PID: ${pids.slice(0, 3).join(', ')}`
          : 'أُرسل أمر التشغيل — تحقق من السجل',
        pids,
        stderr: r.stderr || undefined,
      };
    }),
  );

  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  return NextResponse.json({
    success: successCount === totalCount,
    action: 'start-all',
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
