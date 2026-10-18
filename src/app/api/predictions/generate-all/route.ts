import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-guard';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // Rule 55 §б fix (Task 7-B Batch 7): this route triggers
    // /api/daily/rebuild-predictions on the Python backend (data-mutating).
    // Previously had NO auth — anyone could trigger a full predictions
    // rebuild. Now admin-gated per Rule 55 §б (data-mutating non-admin
    // routes must require admin auth).
    const authError = await requireAdminAsync(req);
    if (authError) return authError;

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
    let data;
    try {
      const targetUrl = `${PY}/api/daily/rebuild-predictions${qs ? `?${qs}` : ''}`;
      const options: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyText || '{}',
        signal: AbortSignal.timeout(30000),
      };
      const res = await fetch(targetUrl, options);
      data = await res.json();
    } catch (pyErr) {
      console.error('[predictions:generate-all] Python backend unavailable:', pyErr);
      return NextResponse.json({
        success: false,
        error: 'python_backend_unavailable',
        message: 'محرك التوقعات (Python backend) غير متاح حالياً',
      }, { status: 503 });
    }

    if (data.success && !data.predictions_count) {
      // REALITY-CHECK-025: شيلنا fallback لـ 151 الكاذب
      // بنستخدم القيمة الحقيقية بس (مش رقم وهمي)
      data.predictions_count = data.performance?.total_predictions || data.stats?.today || data.activePredictions?.length || 0;
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error('[predictions:generate-all]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 503 });
  }
}
