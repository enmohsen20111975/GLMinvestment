/**
 * POST /api/ai/batch-analysis
 *
 * Pure proxy to Python backend /api/v2/batch-analysis.
 *
 * Rule 20 (Python = brain, Node = display only): NO stub fallback.
 * Rule 27 (NO-FAKE-DATA): removed previous `buildStubForTicker` which generated
 * fake scores/recommendations ("شراء قوي"/"شراء"/"تجميع") using hash — violating both rules.
 *
 * If Python backend is unavailable, returns 502 with clear hint.
 */
import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30;

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface BatchAnalysisBody {
  tickers: string[];
  options?: {
    horizon?: string;
    risk_level?: string;
    include_fundamentals?: boolean;
    [key: string]: unknown;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as BatchAnalysisBody;
    const tickers = Array.isArray(body?.tickers) ? body.tickers.filter(Boolean) : [];

    if (tickers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'لم يتم تمرير أي tickers، تم إرجاع نتائج فارغة',
        results: [],
        source: 'empty',
      });
    }

    // Pure proxy to Python backend — no fake fallback (Rule 27)
    const pythonResponse = await fetch(`${PY}/api/v2/batch-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });

    const contentType = pythonResponse.headers.get('content-type') || '';
    if (!pythonResponse.ok || !contentType.includes('application/json')) {
      return NextResponse.json({
        success: false,
        error: `Python backend returned ${pythonResponse.status}`,
        hint: 'تأكد أن Python backend يعمل على ' + PY + '/api/v2/batch-analysis — لا بيانات كاذبة (Rule 27)',
      }, { status: 502 });
    }

    const data = await pythonResponse.json();
    return NextResponse.json(data, { status: pythonResponse.status });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({
      success: false,
      error: isTimeout ? 'انتهت مهلة الطلب' : 'فشل في الاتصال بـ Python Backend',
      details: errMsg,
      hint: 'تأكد أن Python backend يعمل — لا بيانات كاذبة (Rule 27)',
    }, { status: isTimeout ? 504 : 502 });
  }
}
