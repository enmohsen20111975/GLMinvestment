/**
 * GET /api/market/recommendations/ai-insights — Rule 20 Pure Thin Proxy
 * =======================================================================
 *
 * RULE20-PURE-PROXY (P2-FALLBACK-REMOVAL): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays
 *   returned when Python is unavailable.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth for
 *   the AI Insights feed (top active predictions by master_score).
 *
 * The previous route had a 65-line fallback chain that:
 *   - Tried Python `/api/market-pulse` first (which returns a DIFFERENT
 *     response shape — market overview, not AI insights — so the success
 *     branch was effectively never used by the frontend)
 *   - On Python failure: fell through to `getPredictionsFallback` (Rule 20
 *     violation — direct SQLite reads from Node)
 *   - Filtered + sorted + sliced in Node (computation in Node)
 *   - Returned `source: 'sqlite_fallback'` (Rule 27 violation — placeholder
 *     data masquerading as a real response)
 *
 * Python endpoint `/api/market/recommendations/ai-insights` (misc_routes.py,
 * P2-FALLBACK-REMOVAL) returns the canonical structure:
 *   { success, ai_insights, insights, recommendations, count, timestamp }
 *
 * This route just forwards query params + returns Python's JSON.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY =
  process.env.EGXPY_SERVICE_URL ||
  process.env.PYTHON_BACKEND_URL ||
  'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/market/recommendations/ai-insights${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `python-returned-${res.status}`,
          message: 'تعذّر جلب رؤى الذكاء الاصطناعي — Python backend أرجع خطأ',
        },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-ai-insights',
      },
    });
  } catch (error) {
    console.error('[market:recommendations:ai-insights] Python backend unavailable:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'python-backend-unavailable',
        message:
          'Python backend غير متاح — لا يمكن عرض رؤى وهمية (Rule 27)',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      },
      { status: 503 }
    );
  }
}
