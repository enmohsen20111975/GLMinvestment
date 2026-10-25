import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PYTHON_BACKEND_URL}/api/v2/recommend${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    return NextResponse.json({ success: true, recommendations: [], market: 'EGX' });
  } catch (e) {
    return NextResponse.json({ success: true, recommendations: [], market: 'EGX' });
  }
}
