/**
 * Admin Educational Lessons API Proxy
 * =====================================
 *
 * Proxy لجلب قائمة الدروس التعليمية المتاحة من Python Backend.
 * كل المنطق في Python (THE BRAIN) - Next.js للعرض فقط.
 *
 * Endpoint:
 *  - GET /api/admin/educational-cards/lessons -> GET http://127.0.0.1:8010/api/educational-cards/lessons
 *
 * Query params (optional): category (stocks|crypto|all)
 *
 * Architecture: Python = THE BRAIN, Node.js = DISPLAY ONLY
 *
 * Legal Compliance: نستخدم "توقعات" وليس "توصيات"
 * Platform: دليل الاستثمار
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/educational-cards/lessons
// Proxy to Python /api/educational-cards/lessons
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  // Require admin
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const qs = searchParams.toString();

    const url = `${PYTHON_BACKEND_URL}/api/educational-cards/lessons${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error(
        '[admin/educational-cards/lessons GET] Non-JSON response:',
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
    console.error('[admin/educational-cards/lessons GET] Error:', error);

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
            : 'خطأ في جلب الدروس',
        details: errorMessage,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
