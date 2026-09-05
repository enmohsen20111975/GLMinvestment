import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get('market') || 'EGX';
  const forceRefresh = searchParams.get('force_refresh') === '1';

  const pythonUrl = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');
  const qs = new URLSearchParams({ market });
  if (forceRefresh) qs.set('force_refresh', '1');

  try {
    const response = await fetch(
      `${pythonUrl}/api/hunter/daily-picks?${qs.toString()}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(forceRefresh ? 60000 : 15000),
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
