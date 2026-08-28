import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const { jobId } = await params;
    const res = await fetch(`${PY}/api/admin/backtest/v40/status/${jobId}`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Unknown' }, { status: 503 });
  }
}
