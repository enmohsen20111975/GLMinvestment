import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get('market') || 'all';
  const limit = searchParams.get('limit') || '10';

  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

  try {
    const response = await fetch(
      `${pythonUrl}/api/hunter/screener?market=${market}&limit=${limit}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      }
    );

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
        { success: false, error: 'انتهت مهلة الطلب' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'فشل في الاتصال بـ Python Backend', details: error?.message },
      { status: 502 }
    );
  }
}
