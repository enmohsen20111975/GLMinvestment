import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

// P0-11-AUTH fix (2026-09-27): added user auth guard — AI analysis
// triggers expensive Python AI calls (run-hourly, etc.). Was open to
// anyone (cost / DoS vector).
import { requireAuthAsync } from '@/lib/admin-guard';


/**
 * AI Analysis API
 * تحليل الذكاء الاصطناعي للأسهم
 */

// Python backend URL
const PYTHON_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

// ---------------------------------------------------------------------------
// GET /api/ai-analysis/health
// Check AI system health
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard
  const auth = await requireAuthAsync(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const ticker = searchParams.get('ticker');

  try {
    // Health check
    if (action === 'health' || !action) {
      const response = await fetch(`${PYTHON_URL}/api/ai/health`, {
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: 'AI service unavailable',
          ollama_available: false
        });
      }
      
      const data = await response.json();
      return NextResponse.json({ success: true, ...data });
    }

    // Get recommendations
    if (action === 'recommendations') {
      const limit = searchParams.get('limit') || '20';
      const response = await fetch(`${PYTHON_URL}/api/ai/recommendations?limit=${limit}`, {
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: 'Failed to get recommendations'
        });
      }
      
      return NextResponse.json(await response.json());
    }

    // Analyze specific ticker
    if (action === 'analyze' && ticker) {
      const response = await fetch(`${PYTHON_URL}/api/ai/analyze/${ticker}`, {
        signal: AbortSignal.timeout(60000)
      });
      
      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: `Failed to analyze ${ticker}`
        });
      }
      
      return NextResponse.json(await response.json());
    }

    // Market summary
    if (action === 'summary') {
      const response = await fetch(`${PYTHON_URL}/api/ai/market-summary`, {
        signal: AbortSignal.timeout(60000)
      });
      
      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: 'Failed to get market summary'
        });
      }
      
      return NextResponse.json(await response.json());
    }

    return NextResponse.json({
      success: false,
      error: 'Unknown action',
      available_actions: ['health', 'recommendations', 'analyze', 'summary']
    });

  } catch (error) {
    console.error('[AI Analysis API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'AI service connection failed',
      details: String(error)
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/ai-analysis
// Run AI analysis
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard
  const auth = await requireAuthAsync(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { action, tickers } = body;

    // Run hourly analysis
    if (action === 'run-hourly') {
      const response = await fetch(`${PYTHON_URL}/api/ai/run-hourly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
        signal: AbortSignal.timeout(120000)
      });
      
      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: 'Failed to run analysis'
        });
      }
      
      return NextResponse.json(await response.json());
    }

    // Analyze specific stock
    if (action === 'analyze' && body.ticker) {
      const response = await fetch(`${PYTHON_URL}/api/ai/analyze/${body.ticker}`, {
        signal: AbortSignal.timeout(60000)
      });
      
      if (!response.ok) {
        return NextResponse.json({
          success: false,
          error: `Failed to analyze ${body.ticker}`
        });
      }
      
      return NextResponse.json(await response.json());
    }

    return NextResponse.json({
      success: false,
      error: 'Unknown action',
      available_actions: ['run-hourly', 'analyze']
    });

  } catch (error) {
    console.error('[AI Analysis API] POST Error:', error);
    return NextResponse.json({
      success: false,
      error: 'AI analysis failed',
      details: String(error)
    }, { status: 500 });
  }
}
