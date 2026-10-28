import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const execFileAsync = promisify(execFile);

// BRAVO-INTRADAY-PULSE-API (2026-10-28):
// Thin wrapper that runs scripts/intraday_pulse.py and returns JSON.
// Alert only — NOT a buy recommendation.

export async function GET(req: NextRequest) {
  try {
    const projectRoot = process.cwd();
    const pulseScript = join(projectRoot, 'scripts', 'intraday_pulse.py');

    if (!existsSync(pulseScript)) {
      return NextResponse.json({
        success: false,
        error: 'intraday_pulse.py not found',
      }, { status: 404 });
    }

    // Run the pulse script
    const { stdout, stderr } = await execFileAsync('python3', [
      pulseScript, '--json-only',
    ], {
      cwd: projectRoot,
      timeout: 20000,
      maxBuffer: 5 * 1024 * 1024,
    });

    // Parse the JSON output
    try {
      const data = JSON.parse(stdout);
      return NextResponse.json({ success: true, ...data });
    } catch {
      // If JSON parse fails, return raw output
      return NextResponse.json({
        success: false,
        error: 'invalid JSON from pulse script',
        raw: stdout.slice(0, 500),
        stderr: stderr.slice(0, 500),
      }, { status: 500 });
    }
  } catch (e) {
    console.error('[intraday-pulse]', e);
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'internal_error',
    }, { status: 500 });
  }
}
