/**
 * GET /api/dynamic-analysis?ticker=X&market=Y
 *
 * ⚠️ PROXY ONLY — DISPLAY ONLY ⚠️
 *
 * Architecture Rule: Python = THE BRAIN (port 8010), Node.js = DISPLAY ONLY.
 * This route does NOT compute anything. It forwards to the Python backend which
 * runs the full Gemini Strategy Dynamic Analysis Engine:
 *   - Regime Detection (STRONG_BULL → STRONG_BEAR)
 *   - BB Squeeze Detection
 *   - ATR-Aware Structural Targets (S/R + Fibonacci + ATR)
 *   - Adaptive Weights by Market Regime
 *   - Position Override (TAKE_PROFIT for profitable positions)
 *
 * The calculation logic lives in: vps-service/analyzers/dynamic_analysis_engine.py
 * The Flask route lives in: vps-service/api/dynamic_analysis_routes.py
 *
 * Zero SQLite reads, zero calculations, zero native modules — pure HTTP proxy.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json({ success: false, error: 'ticker is required' }, { status: 400 });
  }

  const queryString = searchParams.toString();
  const pythonUrl = `${PYTHON_BACKEND_URL}/api/dynamic-analysis?${queryString}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(pythonUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('ECONNREFUSED') || msg.includes('abort') || msg.includes('fetch')) {
      return NextResponse.json({
        success: false,
        error: 'Python analysis engine unavailable',
        details: 'The Python backend (THE BRAIN) is not running on port 8010. Start it with: cd vps-service && python run.py',
      }, { status: 503 });
    }

    console.error('[Dynamic Analysis Proxy] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Proxy failed', details: msg },
      { status: 500 }
    );
  }
}