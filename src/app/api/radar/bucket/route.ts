import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get('market') || 'EGX';
  const type = searchParams.get('type') || 'inflow';
  const pyBase = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${pyBase}/api/radar/bucket?market=${market}&type=${type}`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, error: 'bucket_fetch_failed' }, { status: 502 });
  }
}
