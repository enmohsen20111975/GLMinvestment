/**
 * Learn From Errors — Rule 20 Pure Thin Proxy
 * ============================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO lesson extraction in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty lessons array.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * Forwards query params + returns Python's JSON as-is.
 * If Python is unavailable, returns 503 with success:false (no fake empty arrays).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const pyParams = new URLSearchParams();
  pyParams.set('market', searchParams.get('market') || 'EGX');

  const targetUrl = `${PY}/api/stored-analysis/learn-from-errors?${pyParams.toString()}`;
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر استخراج الدروس — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-canonical-learn-from-errors',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:learn-from-errors] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض دروس وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}

// POST handler — delegate to Python /api/predictions/tracking/verify (kept for backward compat)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetUrl = `${PY}/api/predictions/tracking/verify`;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market: body.market || 'EGX' }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Python backend returned ${res.status}`,
      }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 502 });
  }
}
