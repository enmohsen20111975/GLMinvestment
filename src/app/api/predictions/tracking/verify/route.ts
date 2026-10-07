/**
 * POST /api/predictions/tracking/verify
 * ======================================
 * Proxy to Python Backend — التحقق من التوقعات المعلقة
 *
 * Body (optional): { market: "EGX" }
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010')
  .replace('localhost', '127.0.0.1');

export async function POST(request: NextRequest) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    // empty body OK
  }

  try {
    const url = `${PYTHON_BACKEND_URL}/api/predictions/tracking/verify`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الطلب' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'فشل في الاتصال بـ Python Backend',
        details: error?.message,
      },
      { status: 502 }
    );
  }
}
