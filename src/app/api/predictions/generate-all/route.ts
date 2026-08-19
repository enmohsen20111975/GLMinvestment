import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const bodyText = await req.text();

    // 1. Trigger live refresh in background
    try {
      await fetch(`${PY}/api/daily/live-refresh-analyses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      });
    } catch (_) {
      // non-blocking
    }

    // 2. Call rebuild-predictions
    const targetUrl = `${PY}/api/daily/rebuild-predictions${qs ? `?${qs}` : ''}`;
    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText || '{}',
      signal: AbortSignal.timeout(30000),
    };

    const res = await fetch(targetUrl, options);
    const data = await res.json();

    if (data.success && !data.predictions_count) {
      // REALITY-CHECK-025: شيلنا fallback لـ 151 الكاذب
      // بنستخدم القيمة الحقيقية بس (مش رقم وهمي)
      data.predictions_count = data.performance?.total_predictions || data.stats?.today || data.activePredictions?.length || 0;
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}
