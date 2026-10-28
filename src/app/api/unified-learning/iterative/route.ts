/**
 * POST /api/unified-learning/iterative
 *
 * تشغيل دورة تعلم تكرارية.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/unified-learning/iterative`
 * - fallback: رجّع stub بـ iteration: 0, accuracy: 0.5, loss: 1.0
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface IterativeBody {
  iterations?: number;
  learning_rate?: number;
  persona?: string;
  target_win_rate?: number;
  [key: string]: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as IterativeBody;
    const iterations = Number(body?.iterations ?? 10);
    const learningRate = Number(body?.learning_rate ?? 0.01);

    // محاولة الاتصال بالـ Python backend
    try {
      const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/unified-learning/iterative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iterations,
          learning_rate: learningRate,
          persona: body.persona ?? 'balanced',
          target_win_rate: body.target_win_rate ?? 75,
          ...(body as Record<string, unknown>),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (pythonResponse.ok) {
        const contentType = pythonResponse.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await pythonResponse.json();
          return NextResponse.json({
            success: true,
            iteration: Number(data?.iteration ?? data?.iterations_completed ?? 0),
            accuracy: Number(data?.accuracy ?? data?.final_accuracy ?? 0.5),
            loss: Number(data?.loss ?? data?.final_loss ?? 1.0),
            source: 'python',
            ...(data as Record<string, unknown>),
          });
        }
      }
    } catch (err) {
      console.warn('[unified-learning/iterative] Python backend unavailable, using stub:', err);
    }

    // FIX (BRAVO-DISASTER 2026-10-28): was returning success:true with fabricated
    // stub metrics (iteration:0, accuracy:0.5, loss:1.0) — Rule 27 NO-FAKE-DATA.
    return NextResponse.json({
      success: false,
      error: 'python_backend_unavailable',
      iteration: 0,
      accuracy: 0,
      loss: 0,
      requested_iterations: iterations,
      learning_rate: learningRate,
      source: 'unavailable',
      message: 'خدمة التعلم التكراري غير متاحة حالياً — لا يمكن تشغيل دورة تعلم',
    }, { status: 503 });
  } catch (err) {
    console.error('[unified-learning/iterative] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        message: 'حدث خطأ غير متوقع في endpoint التعلم التكراري',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: false,
    error: 'method_not_allowed',
    message: 'هذا endpoint يستقبل POST فقط. الرجاء تمرير body يحتوي iterations, learning_rate',
  }, { status: 405 });
}
