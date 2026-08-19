import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

export async function POST(request: NextRequest) {
  const pythonUrl = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');

  let body: { market?: string } = {};
  try {
    body = await request.json();
  } catch {
    // empty body = refresh all
  }

  try {
    const response = await fetch(`${pythonUrl}/api/hunter/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Python backend returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الطلب (التحديث بياخد وقت)' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'فشل في الاتصال بـ Python Backend', details: error?.message },
      { status: 502 }
    );
  }
}
