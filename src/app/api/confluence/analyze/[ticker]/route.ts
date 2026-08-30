/**
 * GET /api/confluence/analyze/[ticker]
 * =====================================
 * Confluence analysis proxy for a single ticker.
 *
 * The Python backend at port 8010 ALREADY implements this endpoint and
 * returns 200 with a fully-formed board-consensus payload. We just proxy
 * it through Next.js so the Flutter app can hit a single origin.
 *
 * Path: ${PY}/api/confluence/analyze/<ticker>
 *
 * If Python is unreachable or returns non-2xx, we return a clearly-marked
 * 502 with a fallback empty board so the UI can degrade gracefully.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params.ticker || '').toUpperCase();
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();

  try {
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required', error_ar: 'السهم مطلوب' },
        { status: 400 }
      );
    }

    const targetUrl = `${PY}/api/confluence/analyze/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, { status: 200 });
    }

    // Non-2xx: try to pass through Python's body, else synthesize an error
    let errBody: any = null;
    try { errBody = await res.json(); } catch { /* ignore */ }

    return NextResponse.json(
      {
        success: false,
        ticker,
        status: res.status,
        error: 'تعذّر تحليل السهم',
        error_en: 'Analysis unavailable',
        details: errBody || `HTTP ${res.status}`,
        board_consensus: null,
      },
      { status: 502 }
    );
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json(
      {
        success: false,
        ticker,
        error: isAbort ? 'انتهت مهلة الطلب' : 'تعذر الوصول لخدمة التحليل الموحد',
        error_en: isAbort ? 'Request timeout' : 'Confluence service unavailable',
        details: error instanceof Error ? error.message : String(error),
        board_consensus: null,
      },
      { status: 503 }
    );
  }
}
