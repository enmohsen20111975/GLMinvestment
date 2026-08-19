/**
 * GET /api/unified-learning/patterns
 *
 * الأنماط الفنية المستفادة من نظام التعلم الموحّد.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/unified-learning/patterns`
 * - fallback: قائمة فارغة (لا بيانات مُفبركة في production)
 */
import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface Pattern {
  name: string;
  description: string;
  confidence: number;
  occurrences: number;
  [key: string]: unknown;
}

function normalizePattern(raw: any): Pattern {
  return {
    name: String(raw?.name ?? raw?.pattern ?? ''),
    description: String(raw?.description ?? raw?.desc ?? ''),
    confidence: Number(raw?.confidence ?? 0),
    occurrences: Number(raw?.occurrences ?? raw?.count ?? 0),
  };
}

export async function GET(_request: NextRequest) {
  // محاولة الاتصال بالـ Python backend
  try {
    const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/unified-learning/patterns`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (pythonResponse.ok) {
      const contentType = pythonResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await pythonResponse.json();
        const rawPatterns: any[] = Array.isArray(data?.patterns)
          ? data.patterns
          : Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
          ? data.data
          : [];
        if (rawPatterns.length > 0) {
          const patterns = rawPatterns.map(normalizePattern);
          return NextResponse.json({
            success: true,
            patterns,
            source: 'python',
          });
        }
      }
    }
  } catch (err) {
    console.warn('[unified-learning/patterns] Python backend unavailable:', err);
  }

  // Fallback: empty array — production app must NOT fabricate patterns
  return NextResponse.json({
    success: true,
    patterns: [],
    source: 'unavailable',
    message: 'خدمة التعلم الموحّد غير متاحة حالياً — لا توجد أنماط لعرضها',
  });
}
