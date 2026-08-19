import { NextRequest, NextResponse } from 'next/server';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit') || '20';
  try {
    const r = await fetch(`${PY}/api/crypto/flow/top?limit=${limit}`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json(); return NextResponse.json(d);
  } catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 503 }); }
}
