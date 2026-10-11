/**
 * POST /api/ai/analyze-stock — Rule 20 Pure Thin Proxy
 * ================================================
 *
 * RULE20-PURE-PROXY + MAESTRO-KILL (2026-10-12):
 *
 * The previous route had 337 lines of:
 *   - Direct SQLite access via better-sqlite3 (Rule 20 violation)
 *   - Fetch to `/api/maestro/stock/` (Python endpoint DELETED per MAESTRO-KILL)
 *   - `maestro_score` field references (orphan field after Maestro deletion)
 *   - computePredictionStats with Math.round (Rule 67 violation)
 *   - "source: 'python_maestro'" (Maestro deleted — fake source label!)
 *
 * Now: pure proxy to Python `/api/stocks/<ticker>/unified` (canonical V40.2 analysis).
 *
 * Rule 20 (Python=Brain) + Rule 27 (NO-FAKE-DATA) + Rule 35 (Maestro deleted)
 * + Rule 67 (CALCULATION-CANONICAL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function POST(req: NextRequest) {
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const body: { ticker?: string; market?: string } = await req.json().catch(() => ({}));
    const ticker = String(body.ticker || '').trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }
    const market = String(body.market || 'EGX').toUpperCase();

    // Pure proxy to Python canonical /api/stocks/<ticker>/unified
    const targetUrl = `${PY}/api/stocks/${encodeURIComponent(ticker)}/unified?market=${encodeURIComponent(market)}`;
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر تحليل السهم — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({
      success: true,
      ticker,
      market,
      source: 'python-canonical-unified',
      analysis: data,
      generated_at: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': 'python-canonical-unified',
      },
    });
  } catch (error) {
    console.error('[ai:analyze-stock] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض تحليل وهمي (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
