export const dynamic = 'force-dynamic';
/**
 * Live Monitor API - Proxy to Python Backend
 * لوحة المراقبة الحية
 */

import { NextResponse } from 'next/server';

const PYTHON_BACKEND = process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

let cache: { timestamp: number; data: unknown } | null = null;
const CACHE_TTL = 5_000;

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`${PYTHON_BACKEND}/api/live-monitor`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Python backend returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    cache = { timestamp: Date.now(), data };
    return NextResponse.json(data);
  } catch (error) {
    console.error('[live-monitor] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
