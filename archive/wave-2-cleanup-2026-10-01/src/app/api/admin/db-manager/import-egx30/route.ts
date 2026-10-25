import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const adminToken = request.headers.get('x-admin-token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (adminToken) headers['x-admin-token'] = adminToken;

    const pythonUrl = `${PYTHON_BACKEND_URL}/api/admin/database/import-egx30`;
    const upstream = await fetch(pythonUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      cache: 'no-store',
    });

    const payload = await upstream.json().catch(() => ({ error: 'Invalid JSON response from Python backend' }));

    if (!upstream.ok) {
      return NextResponse.json(
        { success: false, error: payload.error || `Python backend returned ${upstream.status}`, payload },
        { status: upstream.status }
      );
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    console.error('[db-manager/import-egx30 POST] error:', e);
    return NextResponse.json(
      { success: false, error: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
