/**
 * GET  /api/predictions/dual-track/backtest
 * POST /api/predictions/dual-track/backtest
 * ============================================
 * المرحلة 1.5 — Backtest Trigger Endpoint
 *
 * يشغّل liquidity_backtest_engine.py (Python) ويرجع النتائج.
 *
 * الاستخدام:
 *   GET  /api/predictions/dual-track/backtest?market=EGX&days=90
 *   POST /api/predictions/dual-track/backtest  (recalc all markets)
 *
 * المخرجات:
 *   - results: لكل سوق → total_signals, successful, hit_rate, qualified
 *   - saved_to: liquidity_backtest_results table
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BACKTEST_SCRIPT = path.join(process.cwd(), 'vps-service', 'scripts', 'liquidity_backtest_engine.py');

interface BacktestResult {
  market: string;
  total_signals: number;
  successful_signals: number;
  failed_signals: number;
  hit_rate: number;
  avg_return: number;
  dynamic_threshold: number;
  backtest_start?: string;
  backtest_end?: string;
  qualified: number;
  notes?: string;
}

function runPythonScript(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('python3', [BACKTEST_SCRIPT, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 60_000,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: -1 });
    });
  });
}

// Parse the script's stdout to extract results per market
function parseBacktestOutput(stdout: string): BacktestResult[] {
  const results: BacktestResult[] = [];
  const lines = stdout.split('\n');

  let currentMarket: string | null = null;
  let currentResult: Partial<BacktestResult> | null = null;

  for (const line of lines) {
    const marketMatch = line.match(/^Market:\s+(\w+)/);
    if (marketMatch) {
      if (currentResult && currentMarket) {
        results.push({ market: currentMarket, ...(currentResult as BacktestResult) });
      }
      currentMarket = marketMatch[1];
      currentResult = { market: currentMarket };
      continue;
    }

    if (currentResult) {
      const thresholdMatch = line.match(/threshold \(p75\):\s+([\d.]+)/);
      if (thresholdMatch) currentResult.dynamic_threshold = parseFloat(thresholdMatch[1]);

      const totalMatch = line.match(/total signals:\s+(\d+)/);
      if (totalMatch) currentResult.total_signals = parseInt(totalMatch[1], 10);

      const successMatch = line.match(/successful.*?:\s+(\d+)/);
      if (successMatch) currentResult.successful_signals = parseInt(successMatch[1], 10);

      const failedMatch = line.match(/failed:\s+(\d+)/);
      if (failedMatch) currentResult.failed_signals = parseInt(failedMatch[1], 10);

      const hitRateMatch = line.match(/hit_rate:\s+([\d.]+)%/);
      if (hitRateMatch) currentResult.hit_rate = parseFloat(hitRateMatch[1]);

      const avgRetMatch = line.match(/avg_return:\s+([+-]?[\d.]+)%/);
      if (avgRetMatch) currentResult.avg_return = parseFloat(avgRetMatch[1]);

      const periodMatch = line.match(/period:\s+(\S+)\s+→\s+(\S+)/);
      if (periodMatch) {
        currentResult.backtest_start = periodMatch[1];
        currentResult.backtest_end = periodMatch[2];
      }

      const qualifiedMatch = line.match(/qualification:\s+(✅|❌)/);
      if (qualifiedMatch) {
        currentResult.qualified = qualifiedMatch[1] === '✅' ? 1 : 0;
      }
    }
  }
  if (currentResult && currentMarket) {
    results.push({ market: currentMarket, ...(currentResult as BacktestResult) });
  }

  return results;
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const market = url.searchParams.get('market');
  const days = url.searchParams.get('days') || '90';
  const execute = url.searchParams.get('execute') === '1';

  const args: string[] = [
    execute ? '--execute' : '--dry-run',
    '--days', days,
  ];
  if (market && market !== 'all') {
    args.push('--market', market);
  }

  const { stdout, stderr, exitCode } = await runPythonScript(args);

  if (exitCode !== 0 && !stdout) {
    return NextResponse.json({
      success: false,
      error: 'Backtest script failed',
      stderr: stderr.slice(0, 1000),
      exitCode,
    }, { status: 500 });
  }

  const results = parseBacktestOutput(stdout);

  return NextResponse.json({
    success: true,
    results,
    executed: execute,
    saved_to: execute ? 'liquidity_backtest_results + liquidity_dynamic_threshold + liquidity_signal_outcomes' : null,
    raw_output: stdout.slice(-500),  // tail for debugging
    generated_at: new Date().toISOString(),
  });
}
