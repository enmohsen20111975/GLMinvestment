import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { verifyAdminCredentials, getAdminSessionToken } from '@/lib/admin-auth-server';

// ---------------------------------------------------------------------------
// POST /api/admin/auth
// Verify admin credentials for protected admin operations
// Supports both:
//   - { username, password } for direct login
//   - { password } for backward compatibility
//
// FIX (July 2026): Now sets admin_session cookie so middleware allows access
// to all /api/admin/* routes without requiring X-Admin-Token header on every request.
//
// FIX-P1-SECURITY (CRIT-5 part 2): This endpoint is now GATED by
// `process.env.ALLOW_FORM_LOGIN === 'true'`. If the env var is unset (or any
// other value) the endpoint returns 403 immediately — no password verification,
// no admin_session cookie, no token minting. This matches the gating already
// applied to the NextAuth CredentialsProvider in `[...nextauth]/route.ts`.
// In production, admin should log in via Google OAuth; the form-login path is
// a controlled ops fallback, disabled by default.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // FIX-P1-SECURITY (CRIT-5 part 2): fail closed unless ALLOW_FORM_LOGIN is explicitly 'true'.
    if (process.env.ALLOW_FORM_LOGIN !== 'true') {
      return NextResponse.json(
        {
          success: false,
          error: 'طريقة تسجيل الدخول هذه غير مُفعّلة. استخدم Google OAuth.',
          error_en: 'Form-based admin login is disabled. Use Google OAuth.',
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { username, password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور مطلوبة' },
        { status: 400 }
      );
    }

    // If username is provided, verify both username and password
    // If only password is provided, use backward-compatible verification
    let isValid = false;
    let validUsername = 'mohseny';

    if (username && typeof username === 'string') {
      isValid = verifyAdminCredentials(username, password);
      validUsername = username;
    } else {
      // Backward compatible: only password check
      isValid = verifyAdminCredentials('mohseny', password);
    }

    if (isValid) {
      // Generate admin token (base64 username:password) for X-Admin-Token header
      const adminToken = Buffer.from(`${validUsername}:${password}`, 'utf-8').toString('base64');

      const response = NextResponse.json({
        success: true,
        message: 'تم التحقق بنجاح',
        token: adminToken,
      });

      // Set admin_session cookie to a secure random token (NOT 'authenticated' — FIX July 2026)
      const sessionToken = getAdminSessionToken();
      if (sessionToken) {
        response.cookies.set('admin_session', sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7, // 7 days
          path: '/',
        });
      }

      return response;
    } else {
      return NextResponse.json(
        { success: false, error: 'بيانات الدخول غير صحيحة' },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('[POST /api/admin/auth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء التحقق' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/auth
// Logout - clear the admin_session cookie
// ---------------------------------------------------------------------------
export async function DELETE() {
  const response = NextResponse.json({ success: true, message: 'تم تسجيل الخروج' });
  response.cookies.delete('admin_session');
  return response;
}

