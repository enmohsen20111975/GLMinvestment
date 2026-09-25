/**
 * GET /api/v82?ticker=COMI&market=EGX
 * ================================
 * V82 Analyzer endpoint — The Ultimate EGX Engine
 *
 * يشغّل V82 Analyzer على سهم معين ويرجع القرار:
 * - 9-Condition Entry Gate
 * - Fuel Gauge
 * - Best Entry / Stop Loss / Targets
 * - Position Sizing (EGP)
 * - Kill Switch status
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const V82_SCRIPT = path.join(process.cwd(), 'vps-service', 'analyzers', 'v82_analyzer.py');

interface V82Result {
  ticker: string;
  market: string;
  action: string;
  signal_strength: string;
  diagnosis: string;
  buy_path: string;
  entry_price: number;
  best_entry_price: number;
  stop_loss: number;
  target_price_1: number;
  target_price_2: number;
  risk_reward: number;
  buy_value_m: number;
  sell_value_m: number;
  gate_conditions: Record<string, boolean>;
  gate_passed: boolean;
  fuel_pct: number;
  fuel_exhausted: boolean;
  position_size: number;
  position_value_egp: number;
  risk_amount_egp: number;
  expected_profit_egp: number;
  safe_mode_active: boolean;
  kill_switch_triggered: boolean;
  confidence: number;
}

function runV82Analyzer(ticker: string, market: string, days: number, balance: number, risk: number): Promise<any> {
  return new Promise((resolve) => {
    const args = [
      V82_SCRIPT,
      '--ticker', ticker,
      '--market', market,
      '--days', String(days),
      '--balance', String(balance),
      '--risk', String(risk),
    ];

    const proc = spawn('python3', args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 30_000,
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

function parseV82Output(stdout: string): Partial<V82Result> {
  const result: any = {};

  // Parse the CLI output
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Decision
    if (trimmed.startsWith('🎯 القرار:')) {
      const match = trimmed.match(/القرار:\s*(\w+)\s*\((\w+)\)/);
      if (match) {
        result.action = match[1];
        result.signal_strength = match[2];
      }
    }
    if (trimmed.startsWith('📋 التشخيص:')) {
      result.diagnosis = trimmed.replace('📋 التشخيص:', '').trim();
    }
    if (trimmed.startsWith('📍 السبب:')) {
      result.buy_path = trimmed.replace('📍 السبب:', '').trim();
    }

    // Entry / Stop / Targets
    if (trimmed.startsWith('💰 Entry:')) {
      const m = trimmed.match(/Entry:\s*([\d.]+)/);
      if (m) result.entry_price = parseFloat(m[1]);
    }
    if (trimmed.startsWith('🛑 Stop:')) {
      const m = trimmed.match(/Stop:\s*([\d.]+)/);
      if (m) result.stop_loss = parseFloat(m[1]);
    }
    if (trimmed.startsWith('🎯 TP1:')) {
      const m = trimmed.match(/TP1:\s*([\d.]+)/);
      if (m) result.target_price_1 = parseFloat(m[1]);
    }
    if (trimmed.startsWith('🎯 TP2:')) {
      const m = trimmed.match(/TP2:\s*([\d.]+)/);
      if (m) result.target_price_2 = parseFloat(m[1]);
    }
    if (trimmed.startsWith('⚖️ R:R:')) {
      const m = trimmed.match(/R:R:\s*([\d.]+)/);
      if (m) result.risk_reward = parseFloat(m[1]);
    }

    // Money Flow
    if (trimmed.startsWith('💧 Buy Value:')) {
      const m = trimmed.match(/Buy Value:\s*([\d.]+)/);
      if (m) result.buy_value_m = parseFloat(m[1]);
    }
    if (trimmed.startsWith('💧 Sell Value:')) {
      const m = trimmed.match(/Sell Value:\s*([\d.]+)/);
      if (m) result.sell_value_m = parseFloat(m[1]);
    }

    // Position
    if (trimmed.startsWith('📦 Position Size:')) {
      const m = trimmed.match(/Position Size:\s*(\d+)/);
      if (m) result.position_size = parseInt(m[1], 10);
    }
    if (trimmed.startsWith('💵 Position Value:')) {
      const m = trimmed.match(/Position Value:\s*([\d.]+)/);
      if (m) result.position_value_egp = parseFloat(m[1]);
    }
    if (trimmed.startsWith('⚠️ Risk Amount:')) {
      const m = trimmed.match(/Risk Amount:\s*([\d.]+)/);
      if (m) result.risk_amount_egp = parseFloat(m[1]);
    }
    if (trimmed.startsWith('✨ Expected Profit:')) {
      const m = trimmed.match(/Expected Profit:\s*([\d.]+)/);
      if (m) result.expected_profit_egp = parseFloat(m[1]);
    }

    // Safe Mode
    if (trimmed.startsWith('🔒 Safe Mode:')) {
      result.safe_mode_active = trimmed.includes('True');
    }

    // Gate
    if (trimmed.startsWith('Gate Passed:')) {
      result.gate_passed = trimmed.includes('YES');
    }

    // Confidence
    if (trimmed.startsWith('Confidence:')) {
      const m = trimmed.match(/Confidence:\s*([\d.]+)/);
      if (m) result.confidence = parseFloat(m[1]);
    }

    // Gate conditions
    if (trimmed.startsWith('✅') || trimmed.startsWith('❌')) {
      const condMatch = trimmed.match(/[✅❌]\s+(.+)/);
      if (condMatch) {
        const condName = condMatch[1].trim();
        const passed = trimmed.startsWith('✅');
        if (!result.gate_conditions) result.gate_conditions = {};
        result.gate_conditions[condName] = passed;
      }
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const ticker = (url.searchParams.get('ticker') || 'COMI').toUpperCase();
    const market = url.searchParams.get('market') || 'EGX';
    const days = parseInt(url.searchParams.get('days') || '365', 10);
    const balance = parseFloat(url.searchParams.get('balance') || '10000');
    const risk = parseFloat(url.searchParams.get('risk') || '1.0');

    const { stdout, stderr, exitCode } = await runV82Analyzer(ticker, market, days, balance, risk);

    if (exitCode !== 0 && !stdout) {
      return NextResponse.json({
        success: false,
        error: 'V82 analyzer failed',
        stderr: stderr.slice(0, 500),
      }, { status: 500 });
    }

    const parsed = parseV82Output(stdout);

    return NextResponse.json({
      success: true,
      ticker,
      market,
      ...parsed,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/v82] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
