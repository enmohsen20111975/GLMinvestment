/**
 * GET /api/predictions/tracking/stats
 * ====================================
 * Proxy to Python Backend — إحصائيات نسبة نجاح توصيات الصياد
 *
 * Query: market=EGX, days=30
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010')
  .replace('localhost', '127.0.0.1');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  try {
    const url = `${PYTHON_BACKEND_URL}/api/predictions/tracking/stats?${searchParams.toString()}`;
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
        { success: false, error: 'انتهت مهلة الطلب', data: {} },
        { status: 504 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'فشل في الاتصال بـ Python Backend',
        details: error?.message,
        data: {},
      },
      { status: 502 }
    );
  }
}
