import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

/**
 * GET /api/stock/deep-analysis?ticker=<TICKER>&market=<MARKET>
 *
 * Next.js proxy → Python Backend (port 8010)
 * يجيب تحليل عميق لسهم واحد من Python backend.
 *
 * كل المنطق في Python — Node.js للعرض فقط.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const ticker = searchParams.get('ticker') || '';
  const market = searchParams.get('market') || 'EGX';

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker مطلوب. مثال: /api/stock/deep-analysis?ticker=EGTS&market=EGX' },
      { status: 400 }
    );
  }

  // 🔧 نستخدم 127.0.0.1 بدل localhost عشان نتجنب DNS resolution issues
  const pythonUrl = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');

  try {
    const url = `${pythonUrl}/api/stock/deep-analysis?ticker=${encodeURIComponent(ticker)}&market=${encodeURIComponent(market)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      // لو السهم مش موجود (404) نمرّر الـ response للـ client
      if (response.status === 404) {
        try {
          const notFoundData = await response.json();
          return NextResponse.json(notFoundData, { status: 404 });
        } catch {
          // fallback
        }
      }
      return NextResponse.json(
        { success: false, error: `Python backend returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الطلب' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'فشل في الاتصال بـ Python Backend', details: error?.message },
      { status: 502 }
    );
  }
}
