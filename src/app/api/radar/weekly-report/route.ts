import { NextRequest, NextResponse } from 'next/server';
<<<<<<< HEAD
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'scripts', 'output');
const REPORT_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'weekly_radar_report.py');

// In-process mutex — prevent concurrent weekly-report generations.
let warmupInMemory = false;

/**
 * Weekly Radar Report API
 * ========================
 * Returns the latest weekly report JSON (Top 5 + Stock of the Week +
 * last-week performance + market regime + sector heatmap).
 *
 * Endpoints:
 *   GET  /api/radar/weekly-report?market=EGX      → JSON payload
 *   GET  /api/radar/weekly-report/pdf?market=EGX  → PDF file stream
 *   POST /api/radar/weekly-report?market=EGX      → trigger regeneration
 *
 * Constitution §32: Python is the brain — this endpoint ONLY reads
 * scripts/output/weekly_radar_report_<date>.json (instant <50ms) and
 * triggers a background regeneration via `python3 scripts/weekly_radar_report.py`
 * if the cache is stale (older than 6 hours — since the report is weekly).
 */

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Find the most recent weekly_radar_report_*.json file. */
function findLatestWeeklyReport(market?: string): string | null {
  try {
    if (!existsSync(OUTPUT_DIR)) return null;
    const files = readdirSync(OUTPUT_DIR)
      .filter((f) => f.startsWith('weekly_radar_report_') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    // If a market filter is provided, prefer files matching it
    if (market) {
      for (const f of files) {
        const fp = path.join(OUTPUT_DIR, f);
        try {
          const data = JSON.parse(readFileSync(fp, 'utf-8'));
          if ((data?.market || '').toUpperCase() === market.toUpperCase()) {
            return fp;
          }
        } catch {
          // skip malformed file
        }
      }
    }
    return path.join(OUTPUT_DIR, files[0]);
  } catch {
    return null;
  }
}

/** Read the latest weekly report JSON. Returns null if not found. */
function readWeeklyReport(market?: string): { data: any; filePath: string } | null {
  const fp = findLatestWeeklyReport(market);
  if (!fp || !existsSync(fp)) return null;
  try {
    const data = JSON.parse(readFileSync(fp, 'utf-8'));
    return { data, filePath: fp };
  } catch {
    return null;
  }
}

/**
 * Resolve python binary — 100% portable (mirrors radar-cache.resolvePython).
 */
function resolvePython(): string {
  if (process.env.PYTHON && existsSync(process.env.PYTHON)) return process.env.PYTHON;
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
 * Trigger a background regeneration of the weekly report.
 * Fire-and-forget — never blocks the API response.
 */
export function triggerWeeklyReportWarmup(market = 'EGX'): boolean {
  if (warmupInMemory) return false;
  if (!existsSync(REPORT_SCRIPT)) return false;

  const python = resolvePython();
  warmupInMemory = true;

  const args = [REPORT_SCRIPT, '--market', market, '--json-only'];
  const child = spawn(python, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  // Drain stdout/stderr to avoid the child process hanging on a full pipe.
  child.stdout?.on('data', () => { /* drain */ });
  child.stderr?.on('data', () => { /* drain */ });
  child.on('error', () => { warmupInMemory = false; });
  child.on('exit', () => { warmupInMemory = false; });
  child.unref();
  return true;
}

/**
 * GET /api/radar/weekly-report?market=EGX
 *
 * Returns the latest weekly report JSON (instant <50ms). If the cache is
 * stale or missing, triggers a background regeneration — but the current
 * cache (or an empty-report response) is returned immediately.
 *
 * Response shape (success):
 *   {
 *     success: true,
 *     cached: true,
 *     cache_age_seconds: number,
 *     cache_stale: boolean,
 *     warmup_running: boolean,
 *     report: {
 *       generated_at, market, week_number, year, week_start, week_end,
 *       market_regime, stock_of_week, top_5, last_week_performance,
 *       sector_heatmap, db_source, ...
 *     }
 *   }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();

  const cache = readWeeklyReport(market);

  // Cache miss — no weekly_radar_report_*.json file exists yet. Trigger a
  // background warmup so the next request has data. Return a "warming up"
  // 503 so the UI can show a loading state.
  if (!cache) {
    if (!warmupInMemory) {
      triggerWeeklyReportWarmup(market);
    }
    return NextResponse.json({
      success: false,
      warming_up: true,
      error: 'التقرير الأسبوعي بيتولّد لأول مرة — حاول تاني خلال دقيقة',
      retry_after_seconds: 30,
      market,
    }, { status: 503 });
  }

  const reportData = cache.data;
  const generatedAt = reportData?.generated_at;
  const cacheAgeSec = generatedAt
    ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 1000)
    : null;
  const stale = cacheAgeSec !== null && cacheAgeSec > STALE_THRESHOLD_MS / 1000;

  // If the cache is stale AND no warmup is running → trigger a fresh run.
  if (stale && !warmupInMemory) {
    triggerWeeklyReportWarmup(market);
  }

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
    report: reportData,
  });
}

/**
 * POST /api/radar/weekly-report?market=EGX
 *
 * Triggers a synchronous regeneration of the weekly report (PDF + PNG + JSON).
 * Used by the Sunday cron + the "Regenerate" button in the UI. Blocks until
 * the script finishes (or times out at 90s).
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();

  if (!existsSync(REPORT_SCRIPT)) {
    return NextResponse.json({
      success: false,
      error: `Script not found: ${REPORT_SCRIPT}`,
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
    const args = [REPORT_SCRIPT, '--market', market];
    const child = spawn(python, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
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
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const expectedJson = path.join(OUTPUT_DIR, `weekly_radar_report_${dateStr}.json`);
      const expectedPdf = path.join(OUTPUT_DIR, `weekly_radar_report_${dateStr}.pdf`);
      const expectedPng = path.join(OUTPUT_DIR, `weekly_radar_report_${dateStr}.png`);

      if (code === 0) {
        resolve(NextResponse.json({
          success: true,
          duration_ms: durationMs,
          files: {
            json: existsSync(expectedJson) ? expectedJson : null,
            pdf: existsSync(expectedPdf) ? expectedPdf : null,
            png: existsSync(expectedPng) ? expectedPng : null,
          },
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
=======
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const outputDir = path.join(process.cwd(), 'scripts', 'output');
    if (!existsSync(outputDir)) {
      return NextResponse.json({ success: false, error: 'no_reports_yet', warming_up: true }, { status: 503 });
    }
    const files = readdirSync(outputDir).filter(f => f.startsWith('weekly_radar_report_') && f.endsWith('.json')).sort().reverse();
    if (files.length === 0) {
      return NextResponse.json({ success: false, error: 'no_reports_yet', warming_up: true }, { status: 503 });
    }
    const raw = readFileSync(path.join(outputDir, files[0]), 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json({ success: true, ...data, cached: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
>>>>>>> 835c22b (fix: recreate 7 lost API routes + restore predictions.db + Flutter audit)
}
