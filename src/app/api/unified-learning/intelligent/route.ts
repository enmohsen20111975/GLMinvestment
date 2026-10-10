/**
 * GET /api/unified-learning/intelligent
 *
 * رؤى ذكية مستفادة من نظام التعلم الموحّد.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/unified-learning/intelligent`
 * - fallback (FIX-DB-RESTORE): HTTP 503 + insights: [] — لا بيانات مُفبركة
 *   (Rule 27). الـ 5xx status code بيوصل للـ client إن الخدمة مش شغّالة
 *   بدل ما يرجع 200 + success:false (اللي بيتعمِل كأنه نجاح). الـ JSON shape
 *   محفوظ (insights: []) عشان Flutter ما يكسرش.
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface Insight {
  type: string;
  text: string;
  confidence: number;
  [key: string]: unknown;
}

function normalizeInsight(raw: any): Insight {
  return {
    type: String(raw?.type ?? 'general'),
    text: String(raw?.text ?? raw?.insight ?? raw?.message ?? ''),
    confidence: Number(raw?.confidence ?? 0),
  };
}

async function handleRequest(request: NextRequest) {
  // محاولة الاتصال بالـ Python backend
  try {
    const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/unified-learning/intelligent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: request.body ? await request.text() : '{}',
      signal: AbortSignal.timeout(10000),
    });

    if (pythonResponse.ok) {
      const contentType = pythonResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await pythonResponse.json();
        const rawInsights: any[] = Array.isArray(data?.insights)
          ? data.insights
          : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
          ? data
          : [];
        if (rawInsights.length > 0) {
          const insights = rawInsights.map(normalizeInsight);
          return NextResponse.json({
            success: true,
            insights,
            source: 'python',
          });
        }
      }
    }
  } catch (err) {
    console.warn('[unified-learning/intelligent] Python backend unavailable:', err);
  }

  // Fallback (FIX-FLUTTER-PROD-4): return 200 + insights: [] بدل 503.
  // السبب: Flutter app بيتعامل مع 5xx كـ exception ويطلّع error toast للعميل.
  // لكن دي مش "service error" للعميل — دي "لا توجد رؤى متاحة".
  // Rule 27 (NO-FAKE-DATA): الـ insights array فاضي (مش fabricated).
  // بنرجع source: 'unavailable' عشان الـ client يعرف إن Python معطّل.
  return NextResponse.json({
    success: true,
    insights: [],
    source: 'unavailable',
    message: 'خدمة التعلم الذكي غير متاحة حالياً — لا توجد رؤى لعرضها',
  }, { status: 200 });
}

export async function GET(_request: NextRequest) {
  return handleRequest(_request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}
