import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { generateAdminToken, getAdminSessionToken } from '@/lib/admin-auth-server';

// ---------------------------------------------------------------------------
// GET /api/admin/auth/token
// Client-safe token issuer. Validates the httpOnly admin_session cookie so the
// browser never sees ADMIN_PASSWORD. Returns { token } only when authenticated.
// FIX (July 2026): Compare against ADMIN_SESSION_TOKEN instead of 'authenticated'
// ---------------------------------------------------------------------------
export async function GET() {
  const { cookies } = await import('next/headers');
  const sessionCookie = cookies().get('admin_session')?.value;
  const expectedToken = getAdminSessionToken();

  // 1. Direct admin_session cookie check
  if (sessionCookie && expectedToken && sessionCookie === expectedToken) {
    return NextResponse.json({ success: true, token: generateAdminToken() });
  }

  // 2. NextAuth / Google session check for verified admins
  try {
    const { getSessionUserId } = await import('@/lib/auth-helper');
    const { isAdmin } = await getSessionUserId();
    if (isAdmin) {
      return NextResponse.json({ success: true, token: generateAdminToken() });
    }
  } catch (err) {
    // continue to 401
  }

  return NextResponse.json({ success: false, error: 'غير مسجل الدخول' }, { status: 401 });
}