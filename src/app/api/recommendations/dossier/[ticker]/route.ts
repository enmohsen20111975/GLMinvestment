import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json({ success: false, error: 'missing_ticker' }, { status: 400 });
  }

  const pyBase = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${pyBase}/api/recommendations/dossier/${ticker}`, {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error(`[dossier proxy error] ticker=${ticker}:`, error);
    return NextResponse.json(
      { success: false, error: 'dossier_fetch_failed', message_ar: 'تعذر الاتصال بمحرك ملفات الأدلة' },
      { status: 502 }
    );
  }
}
