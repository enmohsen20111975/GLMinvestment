import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  try {
    const r = await fetch(`${PY}/api/stock-profile/${ticker}`, { signal: AbortSignal.timeout(10000) });
    const d = await r.json(); return NextResponse.json(d);
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 503 });
  }
}
