/**
 * Market Daily Report API
 * ========================
 * التقرير اليومي للسوق
 */

import { NextRequest, NextResponse } from 'next/server';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const market = searchParams.get('market') || 'EGX';
    const format = searchParams.get('format') || 'json';

    const url = `${PYTHON_BACKEND_URL}/api/market/report/daily?market=${market}&format=${format}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Python backend returned ${response.status}`);
    }

    if (format === 'text') {
      const text = await response.text();
      return new NextResponse(text, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('[Market Daily Report API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
