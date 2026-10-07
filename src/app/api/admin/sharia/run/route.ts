/**
 * POST /api/admin/sharia/run
 * =========================
 * Task 28-B (Fix 1 — Fix Battalion):
 *   Manual trigger for `data_engine/scrapers/sharia_compliance_scraper.py`.
 *   The scraper is normally run weekly (cron job #25, Saturday 15:00 UTC),
 *   but the admin needs a button to run it on-demand when:
 *     - a brand-new sharia source was added
 *     - the S&P/Halal consensus looks stale
 *     - a new ticker was listed and needs a halal verdict
 *
 * Rule 20: admin API routes that need logic → call Python (don't reimplement).
 * Rule 64: SHARIA-COMPLIANCE — Python is the brain, Node is the proxy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 180; // scraper may take 1-2 min on slow upstream

const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const EXEC_ENV = {
  ...process.env,
  PATH: `${SYSTEM_PATH}:${process.env.PATH || ''}`,
};

// Module-load-time check — only runs once.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
function resolveBinary(name: string, candidates: string[]): string {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return name;
}

const PYTHON_BIN = resolveBinary('python3', ['/usr/bin/python3', '/bin/python3', '/usr/local/bin/python3']);

const SCRAPER_REL_PATH = 'data_engine/scrapers/sharia_compliance_scraper.py';

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

function runScraper(args: string[], cwd: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(PYTHON_BIN, args, {
      cwd,
      env: EXEC_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      // Force-kill after 5s grace
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + '\n[spawn error] ' + err.message,
        durationMs: Date.now() - start,
        timedOut: false,
      });
    });
  });
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const cwd = process.cwd();
    const scraperPath = join(cwd, SCRAPER_REL_PATH);

    try {
      await access(scraperPath);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'scraper_not_found',
          path: SCRAPER_REL_PATH,
          hint: 'sharia_compliance_scraper.py is missing — check data_engine/scrapers/ directory',
        },
        { status: 404 },
      );
    }

    // Parse optional flags. Default behavior: just refresh sharia tables
    // (don't sync to stocks.db — that requires a manual schema migration).
    let body: { sync_stocks?: boolean; full?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const args = [SCRAPER_REL_PATH];
    if (body.sync_stocks === true) {
      args.push('--sync-stocks');
    }
    if (body.full === true) {
      args.push('--full');
    }

    const result = await runScraper(args, cwd, 150_000);

    const success = result.exitCode === 0 && !result.timedOut;

    // Keep only the last ~4KB of stderr/stdout to avoid huge payloads
    const trim = (s: string, max = 4096) =>
      s.length > max ? '...' + s.slice(-max) : s;

    return NextResponse.json({
      success,
      timestamp: new Date().toISOString(),
      scraper: SCRAPER_REL_PATH,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      duration_human: `${(result.durationMs / 1000).toFixed(1)}s`,
      timed_out: result.timedOut,
      stdout_tail: trim(result.stdout),
      stderr_tail: trim(result.stderr),
      flags: {
        sync_stocks: body.sync_stocks === true,
        full: body.full === true,
      },
      next_step_hint: success
        ? 'Scraper finished — refresh the tab to see updated stats.'
        : 'Check stderr_tail — usually a network error to upstream JSON source or a Python module missing.',
    });
  } catch (err) {
    console.error('[POST /api/admin/sharia/run]', err);
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
