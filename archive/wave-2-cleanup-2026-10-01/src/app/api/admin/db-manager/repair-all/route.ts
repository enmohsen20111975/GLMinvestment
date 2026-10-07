import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    // SEC-05 HOTFIX (Phase A): no hardcoded 'REDACTED_ADMIN_TOKEN' fallback.
    // Read ADMIN_TOKEN only from env; fail closed (empty string) if unset —
    // the Python backend will then reject the request with 401.
    const adminToken = request.headers.get('x-admin-token') || process.env.ADMIN_TOKEN || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken
    };

    const pythonUrl = `${PYTHON_BACKEND_URL}/api/admin/database/repair-all`;
    const upstream = await fetch(pythonUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      cache: 'no-store',
    });

    const payload = await upstream.json().catch(() => ({ error: 'Invalid JSON response from Python backend' }));

    if (!upstream.ok) {
      return NextResponse.json(
        { success: false, error: payload.error || 'Python backend returned error', payload },
        { status: upstream.status }
      );
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    console.error('[db-manager/repair-all POST] error:', e);
    return NextResponse.json(
      { success: false, error: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
