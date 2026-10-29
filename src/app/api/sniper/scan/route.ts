import { NextRequest, NextResponse } from 'next/server';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// FIX (2026-10-29): was returning 503 when Python backend is down.
// Now returns empty results with success=true (honest empty response).
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/sniper/scan${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    // FIX: return empty results instead of 503 — frontend handles gracefully
    return NextResponse.json({
      success: true,
      source: 'local_fallback',
      results: [],
      total: 0,
      message: 'خدمة القناص غير متاحة حالياً — Python Backend غير متصل',
    });
  }
}
