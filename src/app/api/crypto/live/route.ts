import { NextResponse } from 'next/server';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const r = await fetch(`${PY}/api/crypto/live`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json(); return NextResponse.json(d);
  } catch (e) { return NextResponse.json({ success: false, error: 'internal_error' }, { status: 503 }); }
}
