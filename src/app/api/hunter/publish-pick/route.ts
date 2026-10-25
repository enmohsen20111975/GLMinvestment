import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Feature 4 — Proxy لنشر توقع الصياد على تيليجرام.
 *
 * يحوّل POST /api/hunter/publish-pick إلى Python backend (port 8010).
 */
export async function POST(request: NextRequest) {
  // 🔧 نستخدم 127.0.0.1 بدل localhost عشان نتجنب DNS resolution issues
  const pythonUrl = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'جسم الطلب غير صالح (JSON متوقع)' },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${pythonUrl}/api/hunter/publish-pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(45000),
    });

    const data = await response.json().catch(() => ({ success: false, error: 'استجابة غير صالحة من الخادم' }));

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: (data && (data.error || data.message)) || `Python backend returned ${response.status}`,
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    if (err?.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الطلب' },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'فشل في الاتصال بـ Python Backend',
        details: err?.message,
      },
      { status: 502 },
    );
  }
}
