import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

export async function GET(_request: NextRequest) {
  const pythonUrl = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');

  try {
    const response = await fetch(`${pythonUrl}/api/hunter/cache-status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
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
    return NextResponse.json(
      { success: false, error: 'فشل في الاتصال بـ Python Backend', details: error?.message },
      { status: 502 }
    );
  }
}
