import { NextRequest, NextResponse } from 'next/server';

// ============================================================================
// /api/stock-screener/analyze?ticker=COMI
// ============================================================================
// Proxy to Python Screener API (port 8012) — Hybrid Stage Analyzer v2
// Returns the FULL STOCK-FEEL contract:
//   - recommendation, hybrid_score, rsi
//   - correction_status, feel, action_hint, risk_level
//   - layers_simple (with label_ar), correction_detail
//   - layers (full), market_context, reasons
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

const PYTHON_SCREENER_URL = 'http://127.0.0.1:8012';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.trim().toUpperCase();

  if (!ticker) {
    return NextResponse.json(
      { error: 'ticker parameter required' },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(
      `${PYTHON_SCREENER_URL}/api/stock-screener/analyze?ticker=${encodeURIComponent(ticker)}`,
      { signal: controller.signal, cache: 'no-store' }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Python API returned ${res.status}` },
        { status: res.status }
      );
    }

    // Return the FULL Python response as-is (all STOCK-FEEL fields pass through)
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'python_screener_unavailable',
        message: 'محرك تحليل الأسهم (Python Screener) غير متاح على port 8012',
      },
      { status: 503 }
    );
  }
}
