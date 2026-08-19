/**
 * Admin Educational Card Image Proxy
 * ===================================
 *
 * Proxy لجلب صورة كارت تعليمي محدد من Python Backend.
 * كل المنطق في Python (THE BRAIN) - Next.js للعرض فقط.
 *
 * Endpoint:
 *  - GET /api/admin/educational-cards/[id]/image -> GET http://127.0.0.1:8010/api/educational-cards/<id>/image
 *
 * Returns: image/png (or other binary content type if backend returns something else)
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
// GET /api/admin/educational-cards/[id]/image
// Returns the card's image (PNG) as binary
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
        { success: false, error: 'معرف الكارت مطلوب' },
        { status: 400 }
      );
    }

    const url = `${PYTHON_BACKEND_URL}/api/educational-cards/${encodeURIComponent(id)}/image`;

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      // Try to parse error response as JSON
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errorData = await response.json();
        return NextResponse.json(errorData, { status: response.status });
      }
      return NextResponse.json(
        {
          success: false,
          error: `Python backend returned status ${response.status}`,
        },
        { status: response.status }
      );
    }

    // Get binary content
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // Use the content type returned by the backend if available, otherwise default to PNG
    const contentType = response.headers.get('content-type') || 'image/png';

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: unknown) {
    console.error('[admin/educational-cards/[id]/image GET] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const isConnectionError =
      errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed');

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? 'انتهت مهلة تحميل الصورة'
          : isConnectionError
            ? 'لا يمكن الاتصال بـ Python Backend على المنفذ 8010'
            : 'خطأ في تحميل صورة الكارت',
        details: errorMessage,
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
