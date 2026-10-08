import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
// معالجة payloads كبيرة (صور base64) — لا حدود على الـ body
export const runtime = 'nodejs';

/**
 * POST /api/market/publish-status-image
 *
 * Next.js proxy → Python Backend (port 8010) — /api/market/publish-status-image
 *
 * Body: { image: "data:image/png;base64,...", market: "EGX", caption: "..." }
 *
 * يفكّ الـ base64 ويستخدم telegram.auto_poster.send_photo لينشر الصورة
 * على قناة تيليجرام (@Arabian_investment_guide).
 *
 * Task SECURITY-P0: admin-only — النشر على قناة الإنتاج يحتاج صلاحية أدمن.
 */
export async function POST(request: NextRequest) {
  // Task SECURITY-P0: كان بلا auth إطلاقًا — أي أحد يقدر ينشر. الآن: admin gate.
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;

  const pythonUrl = (
    process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010'
  ).replace('localhost', '127.0.0.1');

  try {
    const body = await request.json();

    if (!body?.image) {
      return NextResponse.json(
        {
          success: false,
          error: 'image is required',
          error_ar: 'صورة حالة السوق مطلوبة',
        },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${pythonUrl}/api/market/publish-status-image`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: body.image,
          market: body.market || 'EGX',
          caption: body.caption,
        }),
        // الصور base64 ممكن تكون كبيرة — نرفع الـ timeout
        signal: AbortSignal.timeout(90_000),
      },
    );

    const data = await response.json().catch(() => ({
      success: false,
      error: `Python backend returned ${response.status}`,
    }));

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return NextResponse.json(
        {
          success: false,
          error: 'انتهت مهلة الطلب',
          error_ar: 'انتهت مهلة النشر على تيليجرام',
        },
        { status: 504 },
      );
    }
    console.error('[/api/market/publish-status-image] error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'فشل في الاتصال بـ Python Backend',
        error_ar: 'فشل الاتصال بالخادم',
      },
      { status: 502 },
    );
  }
}
