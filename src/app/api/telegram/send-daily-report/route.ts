import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

/**
 * POST /api/telegram/send-daily-report?market=EGX
 * Pure proxy للـ Python endpoint — Rule 20 (Node = display only)
 */
export async function POST(req: NextRequest) {
  try {
    // Task P0-BRAVO-PROD-GOVERNANCE — TELEGRAM_ENABLED guard (local sandbox disabled)
    const telegramEnabled = process.env.TELEGRAM_ENABLED;
    if (telegramEnabled === 'false' || telegramEnabled === '0' || telegramEnabled === undefined) {
      return NextResponse.json(
        { success: false, error: 'telegram_disabled_locally', message: 'التليجرام معطّل محليًا (TELEGRAM_ENABLED=false).' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market') || 'EGX';
    const targetUrl = `${PY}/api/telegram/send-daily-report?market=${market}`;

    const res = await fetch(targetUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error('[telegram:send-daily-report]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 503 }
    );
  }
}
