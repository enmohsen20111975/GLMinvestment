/**
 * POST /api/unified-learning/mine-lessons
 *
 * استخراج دروس من فترة زمنية محددة.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/unified-learning/mine-lessons`
 * - fallback: رجّع stub بـ lessons: []
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface MineLessonsBody {
  start_date?: string;
  end_date?: string;
  min_confidence?: number;
  [key: string]: unknown;
}

interface Lesson {
  pattern: string;
  success_rate: number;
  examples_count: number;
  [key: string]: unknown;
}

function normalizeLesson(raw: any): Lesson {
  return {
    pattern: String(raw?.pattern ?? raw?.name ?? ''),
    success_rate: Number(raw?.success_rate ?? raw?.successRate ?? 0),
    examples_count: Number(raw?.examples_count ?? raw?.examplesCount ?? raw?.count ?? 0),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as MineLessonsBody;
    const minConfidence = Number(body?.min_confidence ?? 0.5);

    // محاولة الاتصال بالـ Python backend
    try {
      const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/unified-learning/mine-lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: body.start_date,
          end_date: body.end_date,
          min_confidence: minConfidence,
          ...(body as Record<string, unknown>),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (pythonResponse.ok) {
        const contentType = pythonResponse.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await pythonResponse.json();
          const rawLessons: any[] = Array.isArray(data?.lessons)
            ? data.lessons
            : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data)
            ? data
            : [];
          const lessons = rawLessons.map(normalizeLesson);
          return NextResponse.json({
            success: true,
            lessons,
            source: 'python',
            ...(data as Record<string, unknown>),
          });
        }
      }
    } catch (err) {
      console.warn('[unified-learning/mine-lessons] Python backend unavailable, using stub:', err);
    }

    // Fallback: stub
    return NextResponse.json({
      success: true,
      lessons: [],
      source: 'stub',
      message: 'تم استخدام رد افتراضي لأن خدمة استخراج الدروس غير متاحة',
      requested: {
        start_date: body.start_date ?? null,
        end_date: body.end_date ?? null,
        min_confidence: minConfidence,
      },
    });
  } catch (err) {
    console.error('[unified-learning/mine-lessons] Error:', err);
    return NextResponse.json(
      {
        success: true,
        lessons: [],
        source: 'stub',
        error: 'حدث خطأ غير متوقع، تم إرجاع رد افتراضي',
      },
      { status: 200 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'هذا endpoint يستقبل POST فقط. الرجاء تمرير body يحتوي start_date, end_date, min_confidence',
    stub_response: {
      lessons: [],
    },
  });
}
