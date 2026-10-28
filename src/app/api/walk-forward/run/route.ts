/**
 * POST /api/walk-forward/run
 *
 * تشغيل Walk-Forward Analysis لاستراتيجية وسهم معين.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/walk-forward/run`
 * - fallback: رجّع stub بنتائج افتراضية
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface WalkForwardBody {
  strategy?: string;
  ticker?: string;
  start_date?: string;
  end_date?: string;
  [key: string]: unknown;
}

function buildStubPeriods(start: string | undefined, end: string | undefined) {
  const periods: { name: string; return: number; sharpe: number; drawdown: number }[] = [];
  const startDt = start ? new Date(start) : new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(startDt);
    d.setMonth(d.getMonth() + i);
    periods.push({
      name: `فترة ${i + 1}`,
      return: 0,
      sharpe: 0,
      drawdown: 0,
    });
  }
  return periods;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as WalkForwardBody;

    // محاولة الاتصال بالـ Python backend
    try {
      const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/walk-forward/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: body.strategy ?? 'default',
          ticker: body.ticker ?? '',
          start_date: body.start_date,
          end_date: body.end_date,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (pythonResponse.ok) {
        const contentType = pythonResponse.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await pythonResponse.json();
          const results = data?.results ?? data ?? {};
          return NextResponse.json({
            success: true,
            results: {
              periods: Array.isArray(results.periods) ? results.periods : buildStubPeriods(body.start_date, body.end_date),
              avg_return: Number(results.avg_return ?? results.avgReturn ?? 0),
              sharpe_ratio: Number(results.sharpe_ratio ?? results.sharpeRatio ?? 0),
              max_drawdown: Number(results.max_drawdown ?? results.maxDrawdown ?? 0),
              strategy: String(body.strategy ?? results.strategy ?? 'default'),
              ticker: String(body.ticker ?? results.ticker ?? ''),
            },
            source: 'python',
          });
        }
      }
    } catch (err) {
      console.warn('[walk-forward/run] Python backend unavailable, using stub:', err);
    }

    // FIX (BRAVO-DISASTER 2026-10-28): was returning success:true with fabricated
    // stub periods (6 fake periods with return:0, sharpe:0, drawdown:0) — Rule 27
    // NO-FAKE-DATA. Now honestly reports the outage.
    return NextResponse.json({
      success: false,
      error: 'python_backend_unavailable',
      results: null,
      strategy: String(body.strategy ?? 'default'),
      ticker: String(body.ticker ?? ''),
      source: 'unavailable',
      message: 'خدمة Walk-Forward غير متاحة حالياً — لا يمكن تشغيل التحليل',
    }, { status: 503 });
  } catch (err) {
    console.error('[walk-forward/run] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        message: 'حدث خطأ غير متوقع في endpoint Walk-Forward',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: false,
    error: 'method_not_allowed',
    message: 'هذا endpoint يستقبل POST فقط. الرجاء تمرير body يحتوي strategy, ticker, start_date, end_date',
  }, { status: 405 });
}
