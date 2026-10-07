/**
 * admin-guard.ts — Unified auth guard for API routes (P0-11-AUTH).
 * ================================================================
 *
 * CONTEXT:
 *   The AUDIT_ENGINEERING report found 540 of 658 API routes (82%) have
 *   NO auth check. This module provides two guards to fix that gap:
 *
 *   - `requireAuthAsync(req)`   — for USER-scoped routes (portfolio,
 *     watchlist, payments, sync …). Returns the authenticated userId or
 *     a 401 NextResponse. Does NOT require admin role.
 *
 *   - `requireAdminAsync(req)`  — for ADMIN routes. Re-exported from
 *     `@/lib/admin-auth-server` (the canonical, battle-tested guard
 *     with 3 auth methods: token/cookie + NextAuth session + localhost
 *     bypass). Returns null on success or a 403 NextResponse on failure.
 *
 * WHY RE-EXPORT INSTEAD OF DUPLICATE?
 *   `admin-auth-server.ts` already implements a sophisticated multi-method
 *   admin guard (cookie/token/NextAuth/localhost-bypass). Duplicating that
 *   logic here would create two sources of truth → security drift. So we
 *   re-export the canonical `requireAdminAsync` and only ADD the simpler
 *   `requireAuthAsync` (which admin-auth-server doesn't provide).
 *
 * USAGE:
 *   // For admin routes (anything under /api/admin/*):
 *   import { requireAdminAsync } from '@/lib/admin-guard';
 *   export async function POST(req: NextRequest) {
 *     const authError = await requireAdminAsync(req);
 *     if (authError) return authError;
 *     // ... handler body
 *   }
 *
 *   // For user-scoped routes (portfolio, watchlist, payments, sync):
 *   import { requireAuthAsync } from '@/lib/admin-guard';
 *   export async function POST(req: NextRequest) {
 *     const auth = await requireAuthAsync(req);
 *     if (auth instanceof NextResponse) return auth;
 *     const { userId } = auth;
 *     // ... handler body
 *   }
 *
 * Design notes:
 *   - `requireAuthAsync` returns `{ userId } | NextResponse` (so callers
 *     can destructure `userId`). It internally calls `getSessionUserId()`
 *     from `@/lib/auth-helper` (which already supports both NextAuth
 *     session and Bearer token + admin role detection).
 *   - `requireAdminAsync` returns `null | NextResponse` (preserves the
 *     existing signature so existing call sites don't break).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';

// Re-export the canonical admin guard. Existing routes that already
// import from '@/lib/admin-auth-server' continue to work unchanged.
// New routes SHOULD import from '@/lib/admin-guard' for consistency.
export {
  requireAdminAsync,
  verifyAdminRequest,
  verifyAdminCredentials,
  verifyAdminToken,
} from '@/lib/admin-auth-server';

/**
 * Requires the user to be authenticated (any role).
 * Returns `{ userId }` on success or a 401 NextResponse on failure.
 *
 * Use this for user-scoped routes (portfolio, watchlist, payments, sync,
 * AI proxy calls, etc.) where any logged-in user is allowed.
 *
 * For admin-only routes, use `requireAdminAsync` instead.
 */
export async function requireAuthAsync(
  req: NextRequest | Request
): Promise<{ userId: string } | NextResponse> {
  // `req` is accepted for API symmetry with `requireAdminAsync` and for
  // future header-based auth. `getSessionUserId` reads `headers()` and
  // `cookies()` from Next.js internally. Some routes type the handler
  // param as `Request` (Web API) rather than `NextRequest`; both work
  // here since the value is unused at runtime.
  void req; // explicitly mark as intentionally unused at runtime
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'مطلوب تسجيل الدخول' },
        { status: 401 }
      );
    }
    return { userId };
  } catch {
    return NextResponse.json(
      { success: false, error: 'جلسة غير صالحة' },
      { status: 401 }
    );
  }
}
