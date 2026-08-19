import { NextRequest, NextResponse } from 'next/server';
import { generateAdminToken, getAdminSessionToken } from '@/lib/admin-auth-server';

// ---------------------------------------------------------------------------
// GET /api/admin/auth/token
// Client-safe token issuer. Validates the httpOnly admin_session cookie so the
// browser never sees ADMIN_PASSWORD. Returns { token } only when authenticated.
// FIX (July 2026): Compare against ADMIN_SESSION_TOKEN instead of 'authenticated'
// ---------------------------------------------------------------------------
export async function GET() {
  const { cookies } = await import('next/headers');
  const session = cookies().get('admin_session')?.value;
  const expectedToken = getAdminSessionToken();

  if (!session || !expectedToken || session !== expectedToken) {
    return NextResponse.json({ success: false, error: 'غير مسجل الدخول' }, { status: 401 });
  }
  return NextResponse.json({ success: true, token: generateAdminToken() });
}