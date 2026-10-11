/**
 * Honest Live Tracking — Rule 20 Pure Thin Proxy
 * ===============================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO filtering in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * Forwards query params + returns Python's JSON as-is.
 * If Python is unavailable, returns 503 with success:false (no fake zeros).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const pyParams = new URLSearchParams();
  pyParams.set('market', searchParams.get('market') || 'EGX');
  pyParams.set('days', searchParams.get('days') || '30');
  pyParams.set('limit', searchParams.get('limit') || '50');
  if (searchParams.get('minScore')) {
    pyParams.set('minScore', searchParams.get('minScore')!);
  }

  const targetUrl = `${PY}/api/stored-analysis/live-tracking?${pyParams.toString()}`;
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
        message: 'تعذّر جلب التتبع الحي — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-live-tracking-v2',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:live-tracking] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض بيانات وهمية (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
