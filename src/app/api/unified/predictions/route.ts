import { NextRequest, NextResponse } from 'next/server';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
// REALITY-CHECK-023: منع الكاش على مستوى الـ route
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const targetUrl = `${PY}/api/unified/predictions${qs ? `?${qs}` : ''}`;
    // REALITY-CHECK-023: cache: 'no-store' عشان الـ response يكون طازج دايماً
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });
    const data = await res.json();
    // إرسال headers بتقول للـ browser: ما تعملش cache
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, predictions: [], closed_predictions: [], total: 0, error: String(e) }, { status: 503 });
  }
}

// POST handler — للـ MaestroDashboard اللي بيعمل trigger analysis
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const targetUrl = `${PY}/api/unified/predictions`;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // دقيقتين للـ rebuild
      cache: 'no-store' as RequestCache,
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: String(e), message: 'Failed to trigger predictions rebuild' },
      { status: 503 }
    );
  }
}
