import { NextRequest, NextResponse } from 'next/server';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const r = await fetch(`${PY}/api/crypto/flow/${symbol}`, { signal: AbortSignal.timeout(10000) });
    const d = await r.json(); return NextResponse.json(d);
  } catch (e) { return NextResponse.json({ success: false, error: 'internal_error' }, { status: 503 }); }
}
