/**
 * Admin authentication utility for the دليل الاستثمار.
 * Checks if a user is admin based on their email address or username.
 *
 * CLIENT-SAFE module — this file is bundled into the browser. It MUST NOT
 * contain ADMIN_PASSWORD / ADMIN_USERNAME or any token-generation logic.
 *
 * - Client-safe functions: isAdmin, requireAdmin, getAdminToken
 * - Server-only functions (token generation, credential verification): see
 *   @/lib/admin-auth-server
 *
 * SECURITY (July 2026): ADMIN_PASSWORD is NEVER shipped to the browser. The
 * client obtains a short-lived token via getAdminToken() -> GET
 * /api/admin/auth/token (which validates the httpOnly admin_session cookie).
 *
 * P0.1 (SEC-01): admin emails/usernames are sourced from
 * @/lib/admin-identities (NEXT_PUBLIC_ADMIN_EMAILS / NEXT_PUBLIC_ADMIN_USERNAMES
 * env vars with historical defaults) instead of being hardcoded in this file.
 */

import { isClientAdmin } from '@/lib/admin-identities';

export function isAdmin(email: string | null | undefined, username?: string | null): boolean {
  return isClientAdmin(email, username);
}

export function requireAdmin(email: string | null | undefined): { authorized: boolean; error?: string } {
  if (!email) return { authorized: false, error: 'يجب تسجيل الدخول أولاً' };
  if (!isAdmin(email)) return { authorized: false, error: 'ليس لديك صلاحية الوصول' };
  return { authorized: true };
}

// Module-level cache of the token fetched from the server (client-side only).
let _clientAdminToken: string | null = null;
let _clientAdminTokenPromise: Promise<string | null> | null = null;

/**
 * Client-safe way to obtain an admin token. Fetches a short-lived token from
 * GET /api/admin/auth/token (which validates the httpOnly admin_session cookie).
 * This keeps ADMIN_PASSWORD out of the browser bundle entirely.
 */
export async function getAdminToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (_clientAdminToken) return _clientAdminToken;
  if (_clientAdminTokenPromise) return _clientAdminTokenPromise;

  _clientAdminTokenPromise = fetch('/api/admin/auth/token', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const token = data?.token ?? null;
      _clientAdminToken = token;
      return token;
    })
    .catch(() => null)
    .finally(() => {
      _clientAdminTokenPromise = null;
    });

  return _clientAdminTokenPromise;
}
