/**
 * auth-helper.ts — Shared authentication utility for API routes.
 *
 * Provides getSessionUserId() which extracts the authenticated user's ID
 * from the NextAuth session OR Bearer token (for mobile apps).
 * Used by all user-scoped API routes.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { validateTokenWithUser, updateTokenLastUsed } from '@/lib/token-helper';
import { isServerAdmin } from '@/lib/admin-identities';
// FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #15 (Rule 58): structured logger replaces console.log/error
// to avoid leaking userId/email/IP/stack in plain logs.
import { logger } from '@/lib/logger';

// P0.1 (SEC-01): admin emails/usernames are sourced from env vars
// (ADMIN_EMAILS / ADMIN_USERNAMES) with historical defaults via
// @/lib/admin-identities — no longer hardcoded in each consumer.

// ANALYTICS-FIX (2026-10-01): throttle in-memory cache so we don't write
// last_active_at to auth.db on every single API call — only once per user
// per 5 minutes. Lives on globalThis to survive HMR in dev.
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const globalForActiveThrottle = globalThis as unknown as {
  __lastActiveUpdate?: Record<string, number>;
};

/**
 * ANALYTICS-FIX: fire-and-forget update of User.last_active_at.
 *
 * Throttled to 1 update per user per 5 min via globalThis cache.
 * NEVER awaited — must not slow down the calling API route.
 * Swallows errors silently (Rule 55 — tracking must not break UX).
 */
function updateLastActive(userId: string): void {
  if (!userId) return;
  try {
    const now = Date.now();
    const cache = globalForActiveThrottle.__lastActiveUpdate || {};
    const last = cache[userId] || 0;
    if (now - last < FIVE_MINUTES_MS) return; // throttled
    cache[userId] = now;
    globalForActiveThrottle.__lastActiveUpdate = cache;
    // Fire-and-forget — do NOT await.
    db.user.update({
      where: { id: userId },
      data: { last_active_at: new Date().toISOString() },
    }).catch(() => {
      // Non-fatal — never let tracking break auth.
    });
  } catch {
    // ignore
  }
}

/**
 * Parse a date field that might be ISO format or Unix timestamp
 */
function parseDateField(value: string | null | undefined): Date | null {
  if (!value) return null;
  
  // Check if it's a Unix timestamp (13 digits = milliseconds)
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value));
  }
  
  // Try parsing as ISO format
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Get the authenticated user's ID and admin status from the session or Bearer token.
 *
 * Returns:
 *   - userId: the Prisma user ID (e.g. "cmo8o12ix...") or null if not logged in
 *   - isAdmin: true if the user is in the admin list
 *
 * Supports:
 *   - Session cookies (Web App)
 *   - Bearer token (Mobile App)
 *
 * Does NOT throw — returns null userId for unauthenticated requests.
 */
export async function getSessionUserId(): Promise<{ userId: string | null; isAdmin: boolean }> {
  try {
    // Get headers for debugging
    const headersList = await headers();
    const host = headersList.get('host') || 'unknown';
    const cookie = headersList.get('cookie') || '';
    const hasSessionCookie = cookie.includes('next-auth.session-token') || cookie.includes('__Secure-next-auth.session-token');
    const authHeader = headersList.get('authorization') || '';
    
    // First: Try Bearer Token (Mobile App) - Use robust token helper
    if (authHeader) {
      try {
        const token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;

        if (token) {
          // Use the robust token helper that handles corrupted dates
          const tokenData = await validateTokenWithUser(token);

          // FOCUS-5-TASKS-AUDIT-FIX (AUDIT-DEEP-1 #1):
          // `tokenData.token.expires_at` is stored as String in the Prisma schema
          // (auth-schema.prisma — `expires_at String`). Comparing String > Date
          // coerces to `NaN > Number` → always false → ALL bearer tokens rejected.
          // FIX: parse to Date first. If parsing fails (corrupted), treat as expired.
          const expiresAt = (() => {
            try {
              const raw = tokenData?.token?.expires_at as unknown;
              if (raw instanceof Date) return raw;
              if (typeof raw === 'string' || typeof raw === 'number') {
                const parsed = new Date(raw);
                return isNaN(parsed.getTime()) ? null : parsed;
              }
              return null;
            } catch {
              return null;
            }
          })();

          if (tokenData && expiresAt && expiresAt > new Date() && tokenData.user.is_active) {
            // Update last used
            await updateTokenLastUsed(tokenData.token.id);

            const isAdmin = tokenData.user.subscription_tier === 'admin' ||
                            isServerAdmin(tokenData.user.email || '', tokenData.user.username || '');

            logger.debug('bearer auth ok', { userId: tokenData.token.user_id, isAdmin });
            // ANALYTICS-FIX: bump last_active_at (throttled fire-and-forget)
            updateLastActive(tokenData.token.user_id);
            return { userId: tokenData.token.user_id, isAdmin };
          }
        }
      } catch (err) {
        logger.warn('bearer token auth error', { err: err instanceof Error ? err.message : String(err) });
      }
    }

    // ─── ADMIN-SESSION-COOKIE (Task SUBSCRIPTION-FIX-2026-10-07, Rule 67) ───────
    // قبل كده: admin_session cookie (password-login path) ما كانش بيتعرّف عليه →
    // الأدمن بيشوف "14 يوم تجريبي" رغم إنه المالك.
    // الحل: نقرأ admin_session cookie ونجيب الـ user_id من الـ DB.
    if (cookie.includes('admin_session=')) {
      try {
        const adminCookieMatch = cookie.match(/admin_session=([^;]+)/);
        if (adminCookieMatch) {
          const adminCookieValue = decodeURIComponent(adminCookieMatch[1]);
          // admin_session cookie بياخد شكل email أو userId
          // نجرّب نبص على الـ DB بالـ email الأول
          const adminUser = await db.user.findFirst({
            where: {
              OR: [
                { email: adminCookieValue },
                { id: adminCookieValue },
                { username: adminCookieValue },
              ],
            },
            select: { id: true, email: true, username: true, subscription_tier: true, is_active: true },
          });
          if (adminUser && adminUser.is_active) {
            const isAdmin = adminUser.subscription_tier === 'admin' ||
                            isServerAdmin(adminUser.email || '', adminUser.username || '');
            logger.debug('admin_session cookie auth ok', { userId: adminUser.id, isAdmin });
            if (adminUser.id) updateLastActive(adminUser.id);
            return { userId: adminUser.id, isAdmin };
          }
        }
      } catch (err) {
        logger.warn('admin_session cookie auth error', { err: err instanceof Error ? err.message : String(err) });
      }
    }

    // Second: Try Session (Web App)
    const session = await getServerSession(authOptions);
    
    // Debug logging (structured — no email leak)
    logger.debug('session probe', { host, hasSessionCookie, hasSession: !!session });

    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin =
      isServerAdmin(session.user.email,
                    (session.user as Record<string, unknown>).username as string || '');
    // session.user.id is set by the JWT callback in [...nextauth]/route.ts
    const token = session.user as Record<string, unknown>;
    const userId = (session.user.id || token.id) as string | undefined ?? null;
    logger.debug('session auth ok', { userId, isAdmin });
    // ANALYTICS-FIX: bump last_active_at (throttled fire-and-forget)
    if (userId) updateLastActive(userId);
    return { userId, isAdmin };
  } catch (error) {
    logger.error('auth helper failure', { err: error instanceof Error ? error.message : String(error) });
    return { userId: null, isAdmin: false };
  }
}

/**
 * Get user ID from Bearer token only (for mobile-only endpoints)
 * Handles corrupted date fields automatically
 */
export async function getMobileUserId(token: string): Promise<string | null> {
  if (!token) return null;

  try {
    const tokenData = await validateTokenWithUser(token);

    if (tokenData && tokenData.token.expires_at > new Date() && tokenData.user.is_active) {
      await updateTokenLastUsed(tokenData.token.id);
      return tokenData.token.user_id;
    }

    return null;
  } catch (error) {
    logger.warn('mobile auth error', { err: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Get ALL possible user IDs for the authenticated user (CUID + legacy Google Numeric ID).
 *
 * المشكلة: قديماً portfolio/watchlist كانوا بيتخزنوا بـ Google Numeric ID.
 * حالياً: بنستخدم Prisma CUID.
 * الحل: نرجع الاتنين عشان الـ queries تقدر تلاقي البيانات القديمة والجديدة.
 *
 * Returns:
 *   - userIds: array of all possible user IDs (CUID + legacy numeric IDs)
 *   - primaryUserId: the CUID (preferred)
 *   - isAdmin: admin status
 */
export async function getUserIdsWithLegacy(): Promise<{
  userIds: string[];
  primaryUserId: string | null;
  isAdmin: boolean;
}> {
  const { userId, isAdmin } = await getSessionUserId();

  if (!userId) {
    return { userIds: [], primaryUserId: null, isAdmin };
  }

  const userIds = [userId];

  try {
    // ابحث في Account table عن Google Numeric IDs المرتبطة بالمستخدم
    const accounts = await db.account.findMany({
      where: { userId: userId },
      select: { providerAccountId: true },
    });

    for (const acc of accounts) {
      if (acc.providerAccountId && acc.providerAccountId !== userId && !userIds.includes(acc.providerAccountId)) {
        userIds.push(acc.providerAccountId);
      }
    }
  } catch (error) {
    // Account table might not exist or Prisma error - non-fatal
    logger.warn('could not fetch legacy IDs', { err: error instanceof Error ? error.message : String(error) });
  }

  return { userIds, primaryUserId: userId, isAdmin };
}

/**
 * Build a SQL WHERE clause for user_id that matches ALL possible user IDs.
 *
 * Usage:
 *   const { userIds, primaryUserId } = await getUserIdsWithLegacy();
 *   const { clause, params } = buildUserIdClause(userIds, 'user_id');
 *   const query = `SELECT * FROM portfolio_assets WHERE ${clause}`;
 *   const rows = db.prepare(query).all(...params);
 *
 * Returns:
 *   - clause: "user_id = ?" or "user_id IN (?, ?, ?)"
 *   - params: array of user IDs to bind
 */
export function buildUserIdClause(userIds: string[], column = 'user_id'): { clause: string; params: string[] } {
  if (userIds.length === 0) {
    return { clause: '1=0', params: [] }; // no matches
  }
  if (userIds.length === 1) {
    return { clause: `${column} = ?`, params: userIds };
  }
  const placeholders = userIds.map(() => '?').join(', ');
  return { clause: `${column} IN (${placeholders})`, params: userIds };
}
