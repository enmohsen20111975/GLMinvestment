/**
 * GET /api/unified-learning/indicators
 *
 * المؤشرات الفنية المستفادة من نظام التعلم الموحّد.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/unified-learning/indicators`
 * - fallback: قائمة فارغة (لا بيانات مُفبركة في production)
 */
import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface Indicator {
  name: string;
  value: number;
  signal: 'شراء' | 'بيع' | 'محايد' | string;
  weight: number;
  [key: string]: unknown;
}

function normalizeIndicator(raw: any): Indicator {
  return {
    name: String(raw?.name ?? raw?.indicator ?? ''),
    value: Number(raw?.value ?? 0),
    signal: String(raw?.signal ?? 'محايد'),
    weight: Number(raw?.weight ?? 0),
  };
}

export async function GET(_request: NextRequest) {
  // محاولة الاتصال بالـ Python backend
  try {
    const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/unified-learning/indicators`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (pythonResponse.ok) {
      const contentType = pythonResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await pythonResponse.json();
        const rawIndicators: any[] = Array.isArray(data?.indicators)
          ? data.indicators
          : Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
          ? data.data
          : [];
        if (rawIndicators.length > 0) {
          const indicators = rawIndicators.map(normalizeIndicator);
          return NextResponse.json({
            success: true,
            indicators,
            source: 'python',
          });
        }
      }
    }
  } catch (err) {
    console.warn('[unified-learning/indicators] Python backend unavailable:', err);
  }

  // Fallback: empty array — production app must NOT fabricate indicators
  return NextResponse.json({
    success: true,
    indicators: [],
    source: 'unavailable',
    message: 'خدمة التعلم الموحّد غير متاحة حالياً — لا توجد مؤشرات لعرضها',
  });
}
