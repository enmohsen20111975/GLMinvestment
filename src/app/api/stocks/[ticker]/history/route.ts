import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/history/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/history/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data && Array.isArray(data.data.history)) {
          return NextResponse.json({
            success: true,
            data: data.data.history
          });
        }
        return NextResponse.json(data);
      }
    } catch (_err) {
      // Try next fallback
    }
  }

  return NextResponse.json({
    success: false,
    error: `Failed to fetch history for ${ticker}`,
  }, { status: 503 });
}
