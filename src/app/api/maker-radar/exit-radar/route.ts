import { NextRequest, NextResponse } from 'next/server';
import {
  readExitRadarCache,
  getLiveStatus,
  isWarmupRunning,
} from '@/modules/radar/lib/radar-cache';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60; // generous — cache reads are <50ms

const PROJECT_ROOT = process.cwd();
const EXIT_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'exit_radar.py');

// Cache staleness threshold (15 min) — same as the maker radar. If older →
// trigger a background warmup so the exit radar stays fresh across sessions.
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

// In-process mutex to prevent multiple concurrent exit-radar warmups. The
// background spawn is fire-and-forget — we never block the API response.
let warmupInMemory = false;

/**
 * Trigger a background warmup of the exit radar — fire-and-forget spawn of
 * `python3 scripts/exit_radar.py --json-only`. Safe to call multiple times
 * (the mutex prevents concurrent runs). Returns true if a warmup started,
 * false otherwise.
 *
 * This mirrors the maker radar's `triggerBackgroundWarmup` pattern — the
 * Python script is the brain (Constitution Rule 32), Next.js is display-only.
 */
export function triggerExitRadarWarmup(market = 'EGX'): boolean {
  if (warmupInMemory) return false;
  if (!existsSync(EXIT_SCRIPT)) return false;

  // Resolve python binary — same portable chain as radar-cache.resolvePython.
  // Duplicated here to avoid exporting a private function.
  const python = resolvePython();
  warmupInMemory = true;

  const args = [
    EXIT_SCRIPT,
    '--market', market,
    '--min-price', '1.0',
    '--json-only',
  ];

  const child = spawn(python, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  // Drain stdout/stderr to avoid the child process hanging on a full pipe
  // buffer (the script writes a few KB of progress logs).
  child.stdout?.on('data', () => { /* drain */ });
  child.stderr?.on('data', () => { /* drain */ });

  child.on('error', () => { warmupInMemory = false; });
  child.on('exit', () => { warmupInMemory = false; });

  // Detach so the child can outlive the API request handler.
  child.unref();
  return true;
}

/**
 * Resolve python binary — 100% portable, NO absolute paths.
 * Mirrors radar-cache.resolvePython (kept in sync).
 */
function resolvePython(): string {
  if (process.env.PYTHON && existsSync(process.env.PYTHON)) {
    return process.env.PYTHON;
  }
  if (process.env.VIRTUAL_ENV) {
    const venvPython = path.join(process.env.VIRTUAL_ENV, 'bin', 'python3');
    if (existsSync(venvPython)) return venvPython;
    const venvPythonAlt = path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (existsSync(venvPythonAlt)) return venvPythonAlt;
  }
  const projectVenvs = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
  ];
  for (const c of projectVenvs) {
    if (existsSync(c)) return c;
  }
  let dir = PROJECT_ROOT;
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    const venvInParent = [
      path.join(parent, '.venv', 'bin', 'python3'),
      path.join(parent, '.venv', 'bin', 'python'),
      path.join(parent, 'venv', 'bin', 'python3'),
      path.join(parent, 'venv', 'bin', 'python'),
    ];
    for (const c of venvInParent) {
      if (existsSync(c)) return c;
    }
    dir = parent;
  }
  return 'python3';
}

/**
 * GET /api/maker-radar/exit-radar?market=EGX
 *
 * Production-safe: ALWAYS reads from cached JSON (instant <50ms).
 * Never blocks on Python script execution. If the cache is stale or missing,
 * a background warmup is triggered (fire-and-forget) — but the current
 * cache (or an empty-list response) is returned immediately.
 *
 * Response shape:
 *   {
 *     success: true,
 *     cached: true,
 *     cache_age_seconds: number,
 *     cache_stale: boolean,
 *     warmup_running: boolean,
 *     generated_at: string,
 *     market: string,
 *     db_source: string | null,
 *     total_scanned: number,
 *     exit_count: number,
 *     exit_list: ExitRadarEntry[],
 *     x1_distribution_strong: ExitRadarEntry[],
 *     x2_volume_divergence: ExitRadarEntry[],
 *     x3_resistance_rejection: ExitRadarEntry[],
 *     x4_exhaustion_gap: ExitRadarEntry[],
 *     x5_kill_switch_triggered: ExitRadarEntry[],
 *   }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  // PAYWALL Phase 2 — Gate 2 (P0-4, Exit Radar):
  //   Exit Radar is a Pro-grade feature (per PAYWALL-STRATEGY-FINAL.md
  //   §5.2 row 3 + §1 "رادار الخروج — اعرف الأسهم القرب تنهار قبل غيرك").
  //   Server-side enforcement here means the client-side paywall can no
  //   longer be bypassed with curl.
  //   - Anonymous (no session) → 403 (Exit Radar is NOT a marketing
  //     taste hook — only Maker Radar top-3 is the taste hook per §4).
  //   - Authenticated + paid OR within 14-day trial → full radar.
  //   - Authenticated + free + trial expired → 403 EXIT_RADAR_LOCKED.
  //   Per Rule 50 — this is NOT a safety feature (it's a sell-timing
  //   insight, not a stop-loss on owned positions). Stop loss on the
  //   portfolio routes remains free.
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'EXIT_RADAR_LOCKED', upgradeUrl: '/pricing' },
      { status: 403 },
    );
  }
  const trial = await checkTrialNotExpired(userId);
  if (!trial.ok) {
    return NextResponse.json(
      { success: false, error: 'EXIT_RADAR_LOCKED', upgradeUrl: '/pricing' },
      { status: 403 },
    );
  }

  const cache = readExitRadarCache();

  // Cache miss — no exit_radar_*.json file exists yet. Trigger a background
  // warmup so the next request has data. Return a "warming up" 503 response
  // so the UI can show a loading state (mirrors the maker radar pattern).
  if (!cache) {
    if (!isWarmupRunning() && !warmupInMemory) {
      triggerExitRadarWarmup(market);
    }
    return NextResponse.json({
      success: false,
      warming_up: true,
      error: 'رادار الخروج بيتسخن لأول مرة — حاول تاني خلال دقيقة',
      retry_after_seconds: 30,
      market,
    }, { status: 503 });
  }

  const radarData = cache.data;
  const generatedAt = radarData?.generated_at;
  const cacheAgeSec = generatedAt
    ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 1000)
    : null;
  const stale = cacheAgeSec !== null && cacheAgeSec > STALE_THRESHOLD_MS / 1000;

  // If the cache is stale AND no warmup is running → trigger a fresh run.
  // Fire-and-forget — never block the response.
  if (stale && !warmupInMemory) {
    triggerExitRadarWarmup(market);
  }

  // Attach live status from the maker radar (shared cache status file) so
  // the UI can surface the DB source. The exit radar uses the same DB
  // as the maker radar, so the source identifier is the same.
  const status = getLiveStatus();

  return NextResponse.json({
    success: true,
    cached: true,
    cache_age_seconds: cacheAgeSec,
    cache_stale: stale,
    warmup_running: warmupInMemory,
    served_at: new Date().toISOString(),
    cache_generated_at: generatedAt ?? null,
    cache_file: cache.filePath,
    market,
    db_source: radarData?.db_source ?? status.db_source ?? null,
    total_scanned: radarData?.total_scanned ?? 0,
    exit_count: radarData?.exit_count ?? 0,
    x1_distribution_strong_count: radarData?.x1_distribution_strong_count ?? 0,
    x2_volume_divergence_count: radarData?.x2_volume_divergence_count ?? 0,
    x3_resistance_rejection_count: radarData?.x3_resistance_rejection_count ?? 0,
    x4_exhaustion_gap_count: radarData?.x4_exhaustion_gap_count ?? 0,
    x5_kill_switch_triggered_count: radarData?.x5_kill_switch_triggered_count ?? 0,
    exit_list: radarData?.exit_list ?? [],
    x1_distribution_strong: radarData?.x1_distribution_strong ?? [],
    x2_volume_divergence: radarData?.x2_volume_divergence ?? [],
    x3_resistance_rejection: radarData?.x3_resistance_rejection ?? [],
    x4_exhaustion_gap: radarData?.x4_exhaustion_gap ?? [],
    x5_kill_switch_triggered: radarData?.x5_kill_switch_triggered ?? [],
  });
}

/**
 * POST /api/maker-radar/exit-radar
 *
 * Triggers a synchronous warmup of the exit radar. Used by cron jobs and
 * the "refresh" button in the UI. Blocks until the script finishes (or
 * times out at 90s).
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  if (!existsSync(EXIT_SCRIPT)) {
    return NextResponse.json({
      success: false,
      error: `Script not found: ${EXIT_SCRIPT}`,
    }, { status: 500 });
  }

  // Wait if a warmup is already running (up to 90s).
  const waitStart = Date.now();
  while (warmupInMemory && Date.now() - waitStart < 90_000) {
    await new Promise((r) => setTimeout(r, 500));
  }

  const python = resolvePython();
  warmupInMemory = true;
  const startedMonotonic = Date.now();

  return new Promise((resolve) => {
    const args = [
      EXIT_SCRIPT,
      '--market', market,
      '--min-price', '1.0',
      '--json-only',
    ];
    const child = spawn(python, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore - safe-by-design */ }
      warmupInMemory = false;
      resolve(NextResponse.json({
        success: false,
        error: `timeout after 90s`,
        duration_ms: Date.now() - startedMonotonic,
      }, { status: 504 }));
    }, 90_000);

    child.on('error', (err) => {
      clearTimeout(timer);
      warmupInMemory = false;
      resolve(NextResponse.json({
        success: false,
        error: `spawn error: ${err.message}`,
        duration_ms: Date.now() - startedMonotonic,
      }, { status: 500 }));
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      warmupInMemory = false;
      const durationMs = Date.now() - startedMonotonic;
      const cache = readExitRadarCache();

      if (code === 0) {
        resolve(NextResponse.json({
          success: true,
          duration_ms: durationMs,
          cache_file: cache?.filePath ?? null,
          cache_generated_at: cache?.data?.generated_at ?? null,
          exit_count: cache?.data?.exit_count ?? 0,
          total_scanned: cache?.data?.total_scanned ?? 0,
        }));
      } else {
        const errMsg = stderr.trim().slice(0, 1000) || `exit code ${code}`;
        resolve(NextResponse.json({
          success: false,
          error: errMsg,
          duration_ms: durationMs,
        }, { status: 500 }));
      }
    });
  });
}
