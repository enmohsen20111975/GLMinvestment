/**
 * Telegram Post API
 * =================
 * Proxy to Python backend for posting to Telegram channel
 */

import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Python Backend URL
// ─────────────────────────────────────────────────────────────────────────────

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

async function pythonBackendFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${PYTHON_BACKEND_URL}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/telegram/post
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action || 'message';

    let endpoint = '/api/telegram/post/';
    let data = body;

    switch (action) {
      case 'connect':
        endpoint += 'connect';
        break;
      case 'message':
        endpoint += 'message';
        data = { text: body.text, parse_mode: body.parse_mode || 'md' };
        break;
      case 'recommendation':
        endpoint += 'recommendation';
        break;
      case 'daily-summary':
        endpoint += 'daily-summary';
        break;
      case 'top-recommendations':
        endpoint += 'top-recommendations';
        break;
      case 'alert':
        endpoint += 'alert';
        break;
      case 'market-open':
        endpoint += 'market-open';
        break;
      case 'market-close':
        endpoint += 'market-close';
        break;
      case 'custom':
        endpoint += 'custom';
        break;
      default:
        endpoint += 'message';
    }

    const response = await pythonBackendFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[Telegram Post API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Internal server error',
        error_ar: 'حدث خطأ في الاتصال بخدمة تليجرام'
      },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/telegram/post/status
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const response = await pythonBackendFetch('/api/telegram/status');
    const result = await response.json();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Telegram Post API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Internal server error'
      },
      { status: 500 }
    );
  }
}
