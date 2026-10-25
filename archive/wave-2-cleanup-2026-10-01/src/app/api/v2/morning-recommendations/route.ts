/**
 * Morning Recommendations API
 * ===========================
 *
 * GET /api/v2/morning-recommendations
 *
 * Proxies to Python Backend for morning stock recommendations.
 * Returns morning stock recommendations for EGX market.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const PYTHON_BACKEND_URL = process.env.VPS_API_URL || process.env.PYTHON_API_URL || process.env.VPS_API_URL || process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const url = `${PYTHON_BACKEND_URL}/api/v2/morning-recommendations`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60000) // 60 second timeout for analysis
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[morning-recommendations] Error:', error);

    if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الطلب - التحليل يستغرق وقتاً طويلاً', is_timeout: true },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'خطأ في الاتصال بالخادم', detail: String(error) },
      { status: 500 }
    );
  }
}
