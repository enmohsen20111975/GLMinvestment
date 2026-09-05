import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getPaywallUser, applyPaywallToResults } from '@/lib/paywall';
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit') || '10';
  try {
    const r = await fetch(`${PY}/api/explosive/top?limit=${limit}`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();

    // PAYWALL-043: Freemium — Top 3 ظاهرة، الباقي مشفر
    const user = await getPaywallUser(req);
    if (d.results && Array.isArray(d.results)) {
      d.results = applyPaywallToResults(d.results, user.is_premium);
    }
    if (d.top_explosive && Array.isArray(d.top_explosive)) {
      d.top_explosive = applyPaywallToResults(d.top_explosive, user.is_premium);
    }
    d._paywall = { is_premium: user.is_premium };

    return NextResponse.json(d);
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 503 });
  }
}
