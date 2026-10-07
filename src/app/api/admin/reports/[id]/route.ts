/**
 * Admin Single Report API Proxy
 * ===============================
 *
 * Proxy لـ Python Backend endpoints الخاصة بتقرير محدد.
 * كل المنطق في Python (THE BRAIN) - Next.js للعرض فقط.
 *
 * Endpoints المُمرّرة:
 *  - GET  /api/admin/reports/[id]              -> GET  http://127.0.0.1:8010/api/reports/<id>
 *  - POST /api/admin/reports/[id]?action=publish -> POST http://127.0.0.1:8010/api/reports/<id>/publish
 *
 * Architecture: Python = THE BRAIN, Node.js = DISPLAY ONLY
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/reports/[id]
// Proxy to Python /api/reports/<id>
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Require admin
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'معرف التقرير مطلوب' },
        { status: 400 }
      );
    }

    const url = `${PYTHON_BACKEND_URL}/api/reports/${encodeURIComponent(id)}`;

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error(
        `[admin/reports/[id] GET] Non-JSON response:`,
        text.substring(0, 300)
      );
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
    console.error('[admin/reports/[id] GET] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const isConnectionError =
      errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed');

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? 'انتهت مهلة الطلب'
          : isConnectionError
            ? 'لا يمكن الاتصال بـ Python Backend على المنفذ 8010'
            : 'خطأ في جلب التقرير',
        details: errorMessage,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/reports/[id]?action=publish
// Proxy to Python /api/reports/<id>/publish
// (Currently the only supported action is "publish")
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Require admin
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'معرف التقرير مطلوب' },
        { status: 400 }
      );
    }

    const action = request.nextUrl.searchParams.get('action') || 'publish';
    const supportedActions = ['publish', 'approve', 'reject', 'regenerate', 'delete'];
    if (!supportedActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: `إجراء غير مدعوم: ${action}` },
        { status: 400 }
      );
    }

    // Optional body
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK
    }

    const url = `${PYTHON_BACKEND_URL}/api/reports/${encodeURIComponent(id)}/${encodeURIComponent(action)}`;

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
      console.error(
        `[admin/reports/[id] POST] Non-JSON response:`,
        text.substring(0, 300)
      );
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
    console.error('[admin/reports/[id] POST] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const isConnectionError =
      errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed');

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? 'انتهت مهلة النشر'
          : isConnectionError
            ? 'لا يمكن الاتصال بـ Python Backend على المنفذ 8010'
            : 'خطأ في نشر التقرير',
        details: errorMessage,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
