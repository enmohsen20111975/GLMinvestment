/**
 * Prediction Tracking API
 * ========================
 * توجيه الطلبات إلى Python backend
 */

import { NextRequest, NextResponse } from 'next/server';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

export async function GET(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname.replace('/api/predictions/tracking', '/api/predictions/tracking');
    const searchParams = request.nextUrl.searchParams.toString();
    const url = `${PYTHON_BACKEND_URL}${path}${searchParams ? '?' + searchParams : ''}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Python backend returned ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('[Prediction Tracking API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      data: []
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname.replace('/api/predictions/tracking', '/api/predictions/tracking');
    const url = `${PYTHON_BACKEND_URL}${path}`;
    
    const body = await request.json();
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Python backend returned ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('[Prediction Tracking API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
