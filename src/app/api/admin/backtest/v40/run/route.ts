import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const body = await req.text();
    const res = await fetch(`${PY}/api/admin/backtest/v40/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Unknown' }, { status: 503 });
  }
}
