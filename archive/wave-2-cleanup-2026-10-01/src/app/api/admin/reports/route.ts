/**
 * Admin Reports API Proxy
 * ========================
 *
 * Proxy لـ Python Backend endpoints الخاصة بالتقارير الذكية.
 * كل المنطق في Python (THE BRAIN) - Next.js للعرض فقط.
 *
 * Endpoints المُمرّرة:
 *  - GET  /api/admin/reports        -> GET  http://127.0.0.1:8010/api/reports/list
 *  - POST /api/admin/reports        -> POST http://127.0.0.1:8010/api/reports/generate
 *
 * Architecture: Python = THE BRAIN, Node.js = DISPLAY ONLY
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/reports
// Proxy to Python /api/reports/list
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  // Require admin
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const qs = searchParams.toString();

    const url = `${PYTHON_BACKEND_URL}/api/reports/list${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error('[admin/reports GET] Non-JSON response:', text.substring(0, 300));
      return NextResponse.json(
        {
          success: false,
          error: 'Python backend returned non-JSON response',
          status: response.status,
          preview: text.substring(0, 200),
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error('[admin/reports GET] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const isConnectionError =
      errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed');

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? 'انتهت مهلة الطلب - Python Backend يستغرق وقتاً طويلاً'
          : isConnectionError
            ? 'لا يمكن الاتصال بـ Python Backend على المنفذ 8010'
            : 'خطأ في الاتصال بالخادم',
        details: errorMessage,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/reports
// Proxy to Python /api/reports/generate
// Body: { type: 'daily_tomorrow' | 'daily_summary' | 'weekly' | 'monthly', force?: boolean }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // Require admin
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK (we'll let Python handle validation)
    }

    const url = `${PYTHON_BACKEND_URL}/api/reports/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error('[admin/reports POST] Non-JSON response:', text.substring(0, 300));
      return NextResponse.json(
        {
          success: false,
          error: 'Python backend returned non-JSON response',
          status: response.status,
          preview: text.substring(0, 200),
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error('[admin/reports POST] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const isConnectionError =
      errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed');

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? 'انتهت مهلة التوليد - يستغرق Python Backend وقتاً أطول'
          : isConnectionError
            ? 'لا يمكن الاتصال بـ Python Backend على المنفذ 8010'
            : 'خطأ في توليد التقرير',
        details: errorMessage,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
