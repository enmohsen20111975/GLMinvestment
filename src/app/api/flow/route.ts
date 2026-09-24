export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
let cache: { t: number; d: unknown } | null = null;
export async function GET() {
  if (cache && Date.now() - cache.t < 10000) return NextResponse.json(cache.d);
  try {
    const r = await fetch(`${PY}/api/flow/summary`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json(); cache = { t: Date.now(), d }; return NextResponse.json(d);
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 503 });
  }
}
