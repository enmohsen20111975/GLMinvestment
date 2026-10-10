
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
// FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #15 (Rule 58): structured logger replaces console.log/error
// to avoid leaking admin email/tier/host in plain logs.
import { logger } from '@/lib/logger';

/** Admin credentials from environment variables. */
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/** Session token for cookie-based auth (middleware-safe, no password in cookie). */
const ADMIN_SESSION_TOKEN = process.env.ADMIN_SESSION_TOKEN || '';

if (!ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
  logger.error('ADMIN_PASSWORD not set in production — admin login DISABLED');
}

export function getAdminSessionToken(): string {
  return ADMIN_SESSION_TOKEN;
}

/**
 * Verify admin login credentials against the configured env vars.
 * Used by the direct login form and the X-Admin-Token verification.
 *
 * FIX-P1-SECURITY (CRIT-6): The hardcoded `MOHSENY_HASH` bcrypt backdoor has
 * been REMOVED. Admin login is now possible ONLY via:
 *   1. ADMIN_USERNAME + ADMIN_PASSWORD env vars (this function), OR
 *   2. Google OAuth where the user's email is in the admin-identities allowlist
 *      (handled in `[...nextauth]/route.ts` + `requireAdminAsync` Method 2).
 *
 * If `ADMIN_USERNAME`/`ADMIN_PASSWORD` are unset → this function returns false
 * for every input (fail closed). In production, admins should prefer Google
 * OAuth; the env-var path is a controlled ops fallback.
 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  // FIX-P1-SECURITY (CRIT-6): env-only admin login — NO hardcoded hash backdoor.
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return false;
  }
  if (username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return true;
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
  } catch { // silent fallback (safe-by-design)
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
    } catch { // silent fallback (safe-by-design)
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
    logger.debug('admin auth method 1 passed (token/cookie)');
    return null;
  }
  logger.debug('admin auth method 1 failed (no valid token/cookie)');

  // Method 1.5: getSessionUserId (Bearer token or web session)
  try {
    const { getSessionUserId } = await import('@/lib/auth-helper');
    const { isAdmin: authHelperIsAdmin } = await getSessionUserId();
    if (authHelperIsAdmin) {
      logger.debug('admin auth method 1.5 passed (getSessionUserId admin)');
      return null;
    }
  } catch (err) {
    // continue to NextAuth probe
  }

  // Method 2: NextAuth session (Google login)
  try {
    logger.debug('admin auth method 2 (NextAuth session)');
    const { getServerSession } = await import('next-auth');
    const { authOptions } = await import('@/app/api/auth/[...nextauth]/route');
    const session = await getServerSession(authOptions);
    logger.debug('admin auth session probe', { hasSession: !!session });

    if (session?.user?.email) {
      // فحص isAdmin (قائمة الـ emails المعروفة)
      if (isAdmin(session.user.email)) {
        logger.debug('admin auth method 2 passed (isAdmin match)');
        return null;
      }

      // فحص DB للـ subscription_tier
      try {
        const { db } = await import('@/lib/db');
        const dbUser = await db.user.findUnique({
          where: { email: session.user.email },
          select: { subscription_tier: true, is_active: true },
        });

        logger.debug('admin auth DB probe', { tier: dbUser?.subscription_tier ?? null, active: dbUser?.is_active ?? null });

        // FIX-P1-SECURITY (CRIT-1): premium users must NOT be treated as admin.
        // Only subscription_tier === 'admin' (set via env-vars ADMIN_EMAILS /
        // Google OAuth admin identities) grants admin privileges. Premium is a
        // paid tier — not an admin role.
        if (dbUser && dbUser.is_active && dbUser.subscription_tier === 'admin') {
          logger.debug('admin auth method 2 passed (DB match)');
          return null;
        }
      } catch (dbErr) {
        // لو DB غير متاح، نعتمد على isAdmin فقط
        logger.warn('admin auth DB check failed', { err: dbErr instanceof Error ? dbErr.message : String(dbErr) });
      }
    }
  } catch (err) {
    logger.warn('admin auth method 2 error', { err: err instanceof Error ? err.message : String(err) });
  }

  // Method 3: DISABLED — was allowing localhost bypass which is a CRITICAL security hole.
  // BOOTCAMP-3 (2026-10-01): The `isLocalhost` check allowed anyone to access admin APIs
  // if the reverse proxy passes `host: localhost` or `x-forwarded-host: localhost`.
  // This is a P0 Rule 55 violation.
  // 
  // The ONLY bypass now is ALLOW_ADMIN_BYPASS=true (explicit env var, default OFF).
  const allowBypass = process.env.ALLOW_ADMIN_BYPASS === 'true';

  if (allowBypass) {
    logger.debug('admin auth method 3 passed (ALLOW_ADMIN_BYPASS=true)');
    return null;
  }

  logger.warn('admin auth all methods failed, returning 403');
  return NextResponse.json(
    { success: false, error: 'ADMIN_AUTH_REQUIRED', error_ar: 'ليس لديك صلاحية الوصول — سجّل دخول الأدمن أولاً' },
    { status: 403 }
  );
}
