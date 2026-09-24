export const dynamic = 'force-dynamic';
/**
 * Live Monitor - Trigger Update
 * تشغيل تحديث الأسعار يدوياً
 */

import { NextResponse } from 'next/server';

const PYTHON_BACKEND = process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function POST() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const response = await fetch(`${PYTHON_BACKEND}/api/live-monitor/trigger-update`, {
      method: 'POST',
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
    return NextResponse.json(data);
  } catch (error) {
    console.error('[live-monitor/trigger] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
