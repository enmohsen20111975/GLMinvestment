/**
 * Admin authentication utility for the EGX Investment Platform.
 * Checks if a user is admin based on their email address or username.
 */

import { type NextRequest, NextResponse } from 'next/server';

const ADMIN_EMAILS = ['enmohsen2011975@gmail.com', 'ceo@m2y.net'];
const ADMIN_USERNAMES = ['mohseny'];

/** Hardcoded admin credentials for direct login */
const HARDCODED_ADMIN = {
  username: 'mohseny',
  password: 'M2y@01287644099',
} as const;

export function isAdmin(email: string | null | undefined, username?: string | null): boolean {
  if (email && ADMIN_EMAILS.includes(email.toLowerCase().trim())) return true;
  if (username && ADMIN_USERNAMES.includes(username.toLowerCase().trim())) return true;
  return false;
}

export function requireAdmin(email: string | null | undefined): { authorized: boolean; error?: string } {
  if (!email) return { authorized: false, error: 'يجب تسجيل الدخول أولاً' };
  if (!isAdmin(email)) return { authorized: false, error: 'ليس لديك صلاحية الوصول' };
  return { authorized: true };
}

/**
 * Verify admin login credentials against hardcoded values.
 * Used for the direct login form on the admin page.
 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  return (
    username.trim() === HARDCODED_ADMIN.username &&
    password === HARDCODED_ADMIN.password
  );
}

/**
 * Generate an admin auth token for API requests (base64 encoded username:password).
 * Used by the client-side admin dashboard to authenticate API calls.
 */
export function generateAdminToken(): string {
  const credentials = `${HARDCODED_ADMIN.username}:${HARDCODED_ADMIN.password}`;
  return Buffer.from(credentials).toString('base64');
}

/**
 * Verify admin access from a NextRequest.
 * Checks multiple auth methods:
 * 1. X-Admin-Token header (base64 encoded username:password)
 * 2. admin_session cookie
 *
 * Returns true if authorized, false otherwise.
 * This is the RECOMMENDED way to protect admin API routes
 * since it doesn't depend on NextAuth sessions.
 */
export function verifyAdminRequest(request: NextRequest): boolean {
  // Method 1: Custom header from client-side admin login
  const adminToken = request.headers.get('x-admin-token');
  if (adminToken) {
    try {
      const decoded = Buffer.from(adminToken, 'base64').toString('utf-8');
      const [username, password] = decoded.split(':');
      if (username && password && verifyAdminCredentials(username, password)) {
        return true;
      }
    } catch {
      // Invalid token format
    }
  }

  // Method 2: Admin session cookie
  const adminCookie = request.cookies.get('admin_session')?.value;
  if (adminCookie === 'authenticated') {
    return true;
  }

  return false;
}

/**
 * Middleware helper: returns 403 if admin is not authorized.
 * Usage: const authError = requireAdminRequest(request); if (authError) return authError;
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
