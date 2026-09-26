/**
 * GET /api/predictions/tracking/list
 * ==================================
 * Proxy to Python Backend — قائمة توقعات الصياد المتتبعة
 *
 * Query: market=EGX, status=pending, limit=50
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010')
  .replace('localhost', '127.0.0.1');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    const url = `${PYTHON_BACKEND_URL}/api/predictions/tracking/list?${searchParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الطلب', data: [] },
        { status: 504 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر تحميل التوقعات',
        details: error?.message,
        data: [],
      },
      { status: 502 }
    );
  }
}
