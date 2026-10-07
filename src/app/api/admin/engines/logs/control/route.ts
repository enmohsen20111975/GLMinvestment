/**
 * GET /api/admin/engines/logs/control
 * ===================================
 * Task 33 (Engine Control Room Radical Fix Battalion):
 *   Returns the current PID + running-status for ONE engine (via `pgrep -f`).
 *   This is the per-engine status endpoint that the Live Log Console polls
 *   every 2 seconds to detect when a started daemon becomes reachable or
 *   when a one-shot cron job exits.
 *
 *   Query: `?engine=data_engine|news|predictions|learning|sharia`
 *   Auth: admin only (requireAdminAsync).
 *
 *   Rule 67: existing /api/admin/engines/control GET returns ALL engines at
 *   once (heavier — 5 pgrep calls per request). The Live Log Console only
 *   needs ONE engine's status on each 2s tick, so this lighter endpoint
 *   prevents the polling loop from hammering pgrep 5× per tick.
 *
 *   Rule 68: file existence + curl test verified before claim.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

// ----------------------------------------------------------------------------
// Engine log file mapping — duplicated from ../route.ts (Rule 4: edit-existing-
// files-only + Rule 68 type-safety: Next.js route.ts files must not export
// non-Next symbols, so we keep these constants module-local in each route).
// ----------------------------------------------------------------------------
interface EngineLogSpec {
  label: string;
  files: string[];
}

const ENGINE_LOG_FILES: Record<string, EngineLogSpec> = {
  data_engine: {
    label: 'محرك البيانات',
    files: [
      '/tmp/data_engine.log',
      '/tmp/multi_scraper.log',
      '/tmp/tradingview.log',
      '/tmp/price_updater_morning.log',
    ],
  },
  news: {
    label: 'محرك الأخبار',
    files: ['/tmp/news_collector.log'],
  },
  predictions: {
    label: 'محرك التوقعات V40.2',
    files: [
      '/tmp/v40_2_morning.log',
      '/tmp/v40_2_evening.log',
      '/tmp/v40_2_intraday.log',
    ],
  },
  learning: {
    label: 'محرك التعلّم الذكي',
    files: ['/tmp/learning_engine.log'],
  },
  sharia: {
    label: 'الفحص الشرعي',
    files: ['/tmp/sharia_scraper.log'],
  },
};

const VALID_ENGINES = new Set(Object.keys(ENGINE_LOG_FILES));

// ----------------------------------------------------------------------------
// pgrep helper — same pattern as /api/admin/engines/control (execFile, NOT
// exec, so the shell wrapper itself doesn't match the pattern).
// ----------------------------------------------------------------------------
async function listPids(pattern: string): Promise<number[]> {
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

// ----------------------------------------------------------------------------
// Map engine key → the patterns we pgrep for.
//
// For daemon engines, we pgrep the long-running process pattern.
// For cron engines (predictions/learning/sharia), the process only exists
// during the 30-60s window while the cron job is running; outside that
// window, pgrep returns empty → status = "scheduled" (NOT "stopped").
// ----------------------------------------------------------------------------
const ENGINE_PGREP_PATTERNS: Record<string, { pattern: string; type: 'daemon' | 'cron' }> = {
  data_engine: { pattern: 'data_engine/main.py', type: 'daemon' },
  news: { pattern: 'news-agent', type: 'daemon' },
  predictions: { pattern: 'daily_predictor.py', type: 'cron' },
  learning: { pattern: 'learning_engine.py', type: 'cron' },
  sharia: { pattern: 'sharia_compliance_scraper.py', type: 'cron' },
};

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const engine = url.searchParams.get('engine');

    if (!engine || !VALID_ENGINES.has(engine)) {
      return NextResponse.json(
        {
          success: false,
          error: 'invalid_engine',
          valid: Array.from(VALID_ENGINES),
          provided: engine || null,
        },
        { status: 400 },
      );
    }

    const pgrepSpec = ENGINE_PGREP_PATTERNS[engine];
    const logSpec = ENGINE_LOG_FILES[engine];
    const pids = await listPids(pgrepSpec.pattern);
    const running = pids.length > 0;

    return NextResponse.json({
      success: true,
      engine,
      label: logSpec.label,
      type: pgrepSpec.type,         // 'daemon' | 'cron' — drives the UI's label logic
      pattern: pgrepSpec.pattern,
      running,
      pids,
      // For cron jobs, "scheduled" is the correct idle state — NOT "stopped".
      // The UI uses `state` to decide which pill to render.
      state: running
        ? 'running'
        : pgrepSpec.type === 'cron' ? 'scheduled' : 'stopped',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GET /api/admin/engines/logs/control]', err);
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
