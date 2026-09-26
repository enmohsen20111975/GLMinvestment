
/**
 * Admin Server-Only Functions
 * ============================
 * ده ملف server-only - مفيش أي client component يـ import منه.
 * فيه الـ functions اللي بتستخدم Prisma/NextAuth (server-side only) وأيضاً
 * منطق التحقق من كلمة المرور وتوليد التوكن (اللي بيحتاج ADMIN_PASSWORD).
 *
 * Client components تستخدم admin-auth.ts بدلاً من هذا.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { isAdmin } from './admin-auth';

/** Admin credentials from environment variables. */
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/** Session token for cookie-based auth (middleware-safe, no password in cookie). */
const ADMIN_SESSION_TOKEN = process.env.ADMIN_SESSION_TOKEN || '';

if (!ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
  console.error('[admin-auth] ❌ ADMIN_PASSWORD not set in production — admin login DISABLED. Set ADMIN_PASSWORD in .env.local');
}

export function getAdminSessionToken(): string {
  return ADMIN_SESSION_TOKEN;
}

/**
 * Verify admin login credentials against the configured values or primary admin hash.
 * Used by the direct login form and the X-Admin-Token verification.
 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  if (ADMIN_USERNAME && ADMIN_PASSWORD && username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return true;
  }

  // Primary platform admin (mohseny) verified via salted bcrypt hash
  const u = username.trim().toLowerCase();
  if (u === 'mohseny' || u === 'mohseny@m2y.net') {
    try {
      const bcrypt = require('bcryptjs');
      const MOHSENY_HASH = '$2b$12$E8webiMgn4ptfjWn6UfJaebd8P5cdIcnUIGY/3i3zn/hWam84EKFO';
      if (bcrypt.compareSync(password, MOHSENY_HASH)) {
        return true;
      }
    } catch {
      // Fallback
    }
  }

  return false;
}

/**
 * Generate an admin auth token for API requests (base64 encoded username:password).
 * SERVER-ONLY — never imported from a 'use client' component.
 */
export function generateAdminToken(): string {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return '';
  const credentials = `${ADMIN_USERNAME}:${ADMIN_PASSWORD}`;
  return Buffer.from(credentials).toString('base64');
}

/**
 * Verify an admin token string (base64 encoded username:password).
 */
export function verifyAdminToken(token: string): boolean {
  if (!token) return false;

  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [username, password] = decoded.split(':');

    if (!username || !password) return false;

    return verifyAdminCredentials(username, password);
  } catch {
    return false;
  }
}

/**
 * Verify admin access from a NextRequest.
 * Checks multiple auth methods:
 * 1. X-Admin-Token header (base64 encoded username:password)
 * 2. admin_session cookie
 */
export function verifyAdminRequest(request: NextRequest): boolean {
  const adminToken = request.headers.get('x-admin-token');
  if (adminToken) {
    try {
      const decoded = Buffer.from(adminToken, 'base64').toString('utf-8');
      const [username, password] = decoded.split(':');
      if (username && password && verifyAdminCredentials(username, password)) {
        return true;
      }
    } catch {
      // Invalid token
    }
  }

  // Check admin_session cookie against secure token (NOT the old 'authenticated' string)
  const adminCookie = request.cookies.get('admin_session')?.value;
  if (adminCookie && ADMIN_SESSION_TOKEN && adminCookie === ADMIN_SESSION_TOKEN) {
    return true;
  }

  return false;
}

/**
 * Middleware helper: returns 403 if admin is not authorized.
 */
export function requireAdminRequest(request: NextRequest): NextResponse | null {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json(
      { success: false, error: 'ليس لديك صلاحية الوصول' },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Async admin check - يفحص NextAuth session (Google login) + token + cookie.
 * ده اللي نستخدمه في الـ API routes.
 *
 * Usage:
 *   const authError = await requireAdminAsync(request);
 *   if (authError) return authError;
 */
export async function requireAdminAsync(request: NextRequest): Promise<NextResponse | null> {
  // Method 1: Custom header or cookie (from verifyAdminRequest)
  if (verifyAdminRequest(request)) {
    console.log('[admin-auth] ✅ Method 1 passed (token/cookie)');
    return null;
  }
  console.log('[admin-auth] ❌ Method 1 failed (no valid token/cookie)');

  // Method 2: NextAuth session (Google login)
  try {
    console.log('[admin-auth] 🔍 Trying Method 2 (NextAuth session)...');
    const { getServerSession } = await import('next-auth');
    const { authOptions } = await import('@/app/api/auth/[...nextauth]/route');
    const session = await getServerSession(authOptions);
    console.log('[admin-auth] 📧 Session:', session?.user?.email || 'null');

    if (session?.user?.email) {
      // فحص isAdmin (قائمة الـ emails المعروفة)
      if (isAdmin(session.user.email)) {
        console.log('[admin-auth] ✅ Method 2 passed (isAdmin match)');
        return null;
      }

      // فحص DB للـ subscription_tier
      try {
        const { db } = await import('@/lib/db');
        const dbUser = await db.user.findUnique({
          where: { email: session.user.email },
          select: { subscription_tier: true, is_active: true },
        });

        console.log('[admin-auth] 👤 DB user:', dbUser ? `${dbUser.subscription_tier}/${dbUser.is_active}` : 'null');

        // الأدمن = subscription_tier 'admin' أو 'premium' (طالما المستخدم active)
        if (dbUser && dbUser.is_active && (dbUser.subscription_tier === 'admin' || dbUser.subscription_tier === 'premium')) {
          console.log('[admin-auth] ✅ Method 2 passed (DB match)');
          return null;
        }
      } catch (dbErr) {
        // لو DB غير متاح، نعتمد على isAdmin فقط
        console.error('[admin-auth] DB check failed:', dbErr);
      }
    }
  } catch (err) {
    console.error('[admin-auth] ❌ Method 2 error:', err);
  }

  // Method 3: Localhost bypass — اسمح بالوصول من localhost أو الساندبوكس
  // NODE_ENV=production في الساندبوكس بس ده مش إنتاج حقيقي
  // فحص: localhost / 127.0.0.1 / ALLOW_ADMIN_BYPASS env var
  const host = request.headers.get('host') || '';
  const xForwardedHost = request.headers.get('x-forwarded-host') || '';
  const isLocalhost = host.startsWith('localhost') || xForwardedHost.startsWith('localhost') ||
    host.startsWith('127.0.0.1') || xForwardedHost.startsWith('127.0.0.1') ||
    host.startsWith('0.0.0.0') || xForwardedHost.startsWith('0.0.0.0');
  const allowBypass = process.env.ALLOW_ADMIN_BYPASS === 'true' || process.env.NODE_ENV !== 'production';

  if (isLocalhost || allowBypass) {
    console.log('[admin-auth] ✅ Method 3 passed (localhost/bypass)', { host, isLocalhost, allowBypass });
    return null; // اسمح بالوصول من localhost أو لو ALLOW_ADMIN_BYPASS=true
  }

  console.log('[admin-auth] ❌ All methods failed, returning 403');
  return NextResponse.json(
    { success: false, error: 'ADMIN_AUTH_REQUIRED', error_ar: 'ليس لديك صلاحية الوصول — سجّل دخول الأدمن أولاً' },
    { status: 403 }
  );
}
