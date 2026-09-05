/**
 * Market Status API
 * ==================
 * حالة السوق الحالية
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const market = searchParams.get('market') || 'EGX';

    const url = `${PYTHON_BACKEND_URL}/api/market/report/status?market=${market}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Python backend returned ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('[Market Status API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
