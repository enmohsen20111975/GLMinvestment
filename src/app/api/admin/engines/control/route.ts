/**
 * POST /api/admin/engines/control
 * ===============================
 * Task 31-B (Engine Monitor Battalion):
 *   Start / stop / restart an individual engine or scraper.
 *
 *   Body:
 *     { engine: 'data_engine'|'news'|'predictions'|'learning'|'sharia', action: 'start'|'stop'|'restart' }
 *
 *   For 'start': runs the appropriate launch command (mirrors crontab entries).
 *   For 'stop': pkill -f <pattern> targeting that engine's processes.
 *   For 'restart': stop then start.
 *
 *   Auth: admin only (requireAdminAsync — token/cookie/NextAuth session).
 *
 *   Rule 30: emerald/amber/red palette (handled in UI).
 *   Rule 20 N/A — this endpoint performs writes (process control) by design.
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

// ----------------------------------------------------------------------------
// Engine control specs — what to start + what to kill.
//
// start_cmd:  the shell command to spawn the engine (backgrounded with &)
// kill_pat:   pkill -f pattern that matches the engine's running processes
// ----------------------------------------------------------------------------
interface EngineControlSpec {
  start_cmd?: string;
  kill_pat: string;
  label: string;
  log_file: string;
}

const ENGINE_SPECS: Record<string, EngineControlSpec> = {
  data_engine: {
    // Task 33 (ROOT-CAUSE-FIRST): the previous start_cmd ran the
    // multi_market_scraper cron job (which exits after ~60s) — so the
    // port 3010 never opened + the card stayed red forever. The actual
    // daemon is the Flask server in data_engine/main.py.
    //
    // DATA_ENGINE_PORT=3010 aligns the Flask app with the system-health
    // probe on port 3010 (main.py now reads this env var).
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
    // Trigger the V40.2 daily predictor in one-shot mode (not daemon).
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

const VALID_ACTIONS = new Set(['start', 'stop', 'restart']);
const VALID_ENGINES = new Set(Object.keys(ENGINE_SPECS));

// ----------------------------------------------------------------------------
// Run a shell command safely-ish. We use exec (not execFile) here because the
// start commands need shell redirection (`>> log 2>&1 &`) — these are static
// strings from our own ENGINE_SPECS map, never user input.
// ----------------------------------------------------------------------------
async function runShell(cmd: string, timeoutMs = 20000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: CWD,
      timeout: timeoutMs,
      env: { ...process.env, PATH: process.env.PATH || '' },
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (err: any) {
    // pkill exits 1 if no process matched — that's NOT an error for stop action
    return {
      ok: false,
      stdout: err.stdout?.toString()?.trim() || '',
      stderr: err.stderr?.toString()?.trim() || '',
      code: err.code ?? 1,
    };
  }
}

// ----------------------------------------------------------------------------
// pgrep helper — check if any process matches a pattern.
//
// IMPORTANT: we use execFile (not exec) and pass the pattern as a separate
// argv element. If we ran `sh -c 'pgrep -f "pattern"'`, the shell itself
// would contain `pattern` in its argv and pgrep would match it (false
// positive). Using execFile means only the pgrep process has the pattern,
// and pgrep excludes its own PID by default.
// ----------------------------------------------------------------------------
async function listPids(pattern: string): Promise<number[]> {
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

  try {
    const body = await req.json().catch(() => ({}));
    const { engine, action } = body as { engine?: string; action?: string };

    if (!engine || !VALID_ENGINES.has(engine)) {
      return NextResponse.json(
        {
          success: false,
          error: 'invalid_engine',
          valid: Array.from(VALID_ENGINES),
        },
        { status: 400 },
      );
    }

    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        {
          success: false,
          error: 'invalid_action',
          valid: Array.from(VALID_ACTIONS),
        },
        { status: 400 },
      );
    }

    const spec = ENGINE_SPECS[engine];

    // Detect venv Python — fall back to system python3 if the .venv doesn't exist
    const pythonExists = fs.existsSync(VENV_PYTHON);
    if (!pythonExists && action !== 'stop') {
      return NextResponse.json(
        {
          success: false,
          error: 'venv_missing',
          detail: `Python venv not found at ${VENV_PYTHON}. On this host the engine start commands require a working .venv.`,
          hint: 'Create .venv first or run the engine manually.',
        },
        { status: 503 },
      );
    }

    // ---------------------------------------------------------------------------
    // STOP: pkill -f <kill_pat>
    // ---------------------------------------------------------------------------
    if (action === 'stop' || action === 'restart') {
      const stopCmd = `pkill -f "${spec.kill_pat}" 2>/dev/null; true`;
      const stopResult = await runShell(stopCmd, 10000);
      const pidsBefore = await listPids(spec.kill_pat);
      // Give the kernel a moment to release
      await new Promise(r => setTimeout(r, 500));
      const pidsAfter = await listPids(spec.kill_pat);
      if (action === 'stop') {
        return NextResponse.json({
          success: true,
          action: 'stop',
          engine,
          label: spec.label,
          message: pidsAfter.length === 0
            ? `تم إيقاف المحرك (${pidsBefore.length} عملية كانت تعمل)`
            : `تم إرسال إشارة الإيقاف، لكن ${pidsAfter.length} عملية لا تزال تعمل`,
          pids_before: pidsBefore,
          pids_after: pidsAfter,
          timestamp: new Date().toISOString(),
        });
      }
      // For restart: brief pause before starting again
      await new Promise(r => setTimeout(r, 800));
    }

    // ---------------------------------------------------------------------------
    // START: spawn the backgrounded command
    // ---------------------------------------------------------------------------
    if (spec.start_cmd) {
      const startResult = await runShell(spec.start_cmd, 5000);
      // The start command ends with `&` so it forks immediately — startResult
      // returning ok:true just means the shell spawned the process.
      await new Promise(r => setTimeout(r, 800));
      const pids = await listPids(spec.kill_pat);
      return NextResponse.json({
        success: startResult.ok || startResult.code === 0,
        action: 'start',
        engine,
        label: spec.label,
        message: pids.length > 0
          ? `تم تشغيل المحرك (PID: ${pids.slice(0, 5).join(', ')})`
          : 'تم إرسال أمر التشغيل — تحقق من السجل للتأكد',
        pids,
        log_file: spec.log_file,
        stdout: startResult.stdout,
        stderr: startResult.stderr,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { success: false, error: 'no_start_command', engine },
      { status: 400 },
    );
  } catch (err) {
    console.error('[POST /api/admin/engines/control]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// GET — list supported engines + their current PIDs (handy for the UI)
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const engines = await Promise.all(
    Object.entries(ENGINE_SPECS).map(async ([key, spec]) => {
      const pids = await listPids(spec.kill_pat);
      return {
        key,
        label: spec.label,
        kill_pattern: spec.kill_pat,
        log_file: spec.log_file,
        running: pids.length > 0,
        pids,
      };
    }),
  );

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    engines,
  });
}
