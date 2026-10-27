/**
 * Admin Educational Cards API Proxy
 * ==================================
 *
 * Proxy لـ Python Backend endpoints الخاصة بالكروت التعليمية.
 * كل المنطق في Python (THE BRAIN) - Next.js للعرض فقط.
 *
 * Endpoints المُمرّرة:
 *  - GET  /api/admin/educational-cards        -> GET  http://127.0.0.1:8010/api/educational-cards/list
 *  - POST /api/admin/educational-cards        -> POST http://127.0.0.1:8010/api/educational-cards/generate
 *
 * Architecture: Python = THE BRAIN, Node.js = DISPLAY ONLY
 *
 * Legal Compliance: نستخدم "توقعات" فقط (تجنّب الكلمات المحظورة)
 * Platform: دليل الاستثمار
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/educational-cards
// Proxy to Python /api/educational-cards/list
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  // Require admin
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const qs = searchParams.toString();

    const url = `${PYTHON_BACKEND_URL}/api/educational-cards/list${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error(
        '[admin/educational-cards GET] Non-JSON response:',
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
    console.error('[admin/educational-cards GET] Error:', error);

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
// POST /api/admin/educational-cards
// Proxy to Python /api/educational-cards/generate
// Body: { lesson_id: string, style?: string, num_cards?: number, generate_video?: boolean, video_duration?: number }
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

    // Determine which Python endpoint to call based on action
    const bodyObj = body as Record<string, unknown>;
    const action = bodyObj?.action as string | undefined;

    let pythonPath = '/api/educational-cards/generate';
    let timeout = 30000;

    if (action === 'infographic') {
      pythonPath = '/api/educational-cards/generate-infographic';
      timeout = 45000;
    } else if (action === 'pdf') {
      pythonPath = '/api/educational-cards/generate-pdf';
      timeout = 45000;
    } else if (action === 'gif') {
      pythonPath = '/api/educational-cards/generate-gif';
      timeout = 60000;
    }

    const url = `${PYTHON_BACKEND_URL}${pythonPath}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      console.error(
        '[admin/educational-cards POST] Non-JSON response:',
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
    console.error('[admin/educational-cards POST] Error:', error);

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
            : 'فشل في توليد الكروت',
        details: errorMessage,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
