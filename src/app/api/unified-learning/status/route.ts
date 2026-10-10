/**
 * GET /api/unified-learning/status
 *
 * حالة نظام التعلم الموحّد.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/unified-learning/status`
 * - fallback: رجّع status: 'idle', patterns_count: 0, accuracy: 0
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface LearningStatus {
  status: 'idle' | 'learning' | 'completed';
  last_run: string | null;
  patterns_count: number;
  accuracy: number;
  [key: string]: unknown;
}

function buildStubStatus(): LearningStatus {
  return {
    status: 'idle',
    last_run: null,
    patterns_count: 0,
    accuracy: 0,
  };
}

export async function GET(request: NextRequest) {
  // محاولة الاتصال بالـ Python backend
  try {
    const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/unified-learning/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (pythonResponse.ok) {
      const contentType = pythonResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await pythonResponse.json();
        const statusValue = String(data?.status ?? 'idle') as LearningStatus['status'];
        const validStatuses: LearningStatus['status'][] = ['idle', 'learning', 'completed'];
        const status = validStatuses.includes(statusValue) ? statusValue : 'idle';
        return NextResponse.json({
          success: true,
          status,
          last_run: data?.last_run ?? data?.lastRun ?? null,
          patterns_count: Number(data?.patterns_count ?? data?.patternsCount ?? 0),
          accuracy: Number(data?.accuracy ?? 0),
          source: 'python',
          ...(data as Record<string, unknown>),
        });
      }
    }
  } catch (err) {
    console.warn('[unified-learning/status] Python backend unavailable, using stub:', err);
  }

  // Fallback: stub
  return NextResponse.json({
    success: true,
    ...buildStubStatus(),
    source: 'stub',
    message: 'تم استخدام رد افتراضي لأن خدمة التعلم الموحّد غير متاحة',
  });
}
