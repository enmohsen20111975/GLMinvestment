/**
 * GET/POST /api/unified/predictions — Rule 20 Pure Thin Proxy
 * ==========================================================
 *
 * RULE20-PURE-PROXY (P2-FALLBACK-REMOVAL): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays
 *   returned when Python is unavailable.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth for
 *   the unified multi-market predictions feed.
 *
 * The previous route had a 65-line SQLite fallback chain that:
 *   - Used `getPredictionsFallback` + `getPerformanceFallback` (Rule 20
 *     violation — direct SQLite reads from Node)
 *   - Returned `source: 'sqlite_fallback'` with `predictions: []` empty
 *     arrays + a fabricated `performance: {hit_rate: 0}` (Rule 27 violation
 *     — placeholder data masquerading as a real response)
 *   - POST handler also returned 200 with `source: 'sqlite_fallback_empty'`
 *     + `error: 'internal_error'` on Python-down (mixed signals)
 *
 * Python endpoint `/api/unified/predictions` (misc_routes.py L2385) already
 * returns the canonical structure (active + closed + performance + market
 * filters). This route just forwards query params / JSON body + returns
 * Python's JSON.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PY =
  process.env.EGXPY_SERVICE_URL ||
  process.env.PYTHON_BACKEND_URL ||
  'http://127.0.0.1:8010';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

// GET /api/unified/predictions — pure thin proxy to Python.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/unified/predictions${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `python-returned-${res.status}`,
          message:
            'تعذّر جلب التوقعات الموحّدة — Python backend أرجع خطأ',
        },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        ...NO_STORE_HEADERS,
        'X-Data-Source': data.source || 'python-canonical-unified-predictions',
      },
    });
  } catch (error) {
    console.error('[unified:predictions] Python backend unavailable:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'python-backend-unavailable',
        message:
          'Python backend غير متاح — لا يمكن عرض توقعات وهمية (Rule 27)',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}

// POST /api/unified/predictions — pure thin proxy to Python (trigger rebuild).
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/unified/predictions${qs ? `?${qs}` : ''}`;

  let body: string | undefined;
  try {
    const raw = await req.json();
    body = JSON.stringify(raw);
  } catch {
    // body is optional — Python accepts empty POST for rebuild trigger
    body = undefined;
  }

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `python-returned-${res.status}`,
          message:
            'تعذّر تحديث التوقعات — Python backend أرجع خطأ',
        },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        ...NO_STORE_HEADERS,
        'X-Data-Source': data.source || 'python-canonical-unified-predictions',
      },
    });
  } catch (error) {
    console.error(
      '[unified:predictions:POST] Python backend unavailable:',
      error
    );
    return NextResponse.json(
      {
        success: false,
        error: 'python-backend-unavailable',
        message:
          'Python backend غير متاح — لا يمكن تشغيل إعادة بناء التوقعات (Rule 27)',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
