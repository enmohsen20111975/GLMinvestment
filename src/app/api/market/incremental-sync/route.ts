import { NextRequest, NextResponse } from 'next/server';

// P0-11-AUTH fix (2026-09-27): added admin auth guard — incremental-sync
// proxies to Python backend's eodhd/bulk-update which mass-modifies stock
// data. Was open to anyone.
import { requireAdminAsync } from '@/lib/admin-guard';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard (shared by GET + POST)
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/eodhd/bulk-update${qs ? `?${qs}` : ''}`;

    const options: RequestInit = { signal: AbortSignal.timeout(30000) };
    if (req.method !== 'GET') {
      options.method = req.method;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = await req.text();
    }

    const res = await fetch(targetUrl, options);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
