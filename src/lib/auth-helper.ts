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

// P0.1 (SEC-01): admin emails/usernames are sourced from env vars
// (ADMIN_EMAILS / ADMIN_USERNAMES) with historical defaults via
// @/lib/admin-identities — no longer hardcoded in each consumer.

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
          
          if (tokenData && tokenData.token.expires_at > new Date() && tokenData.user.is_active) {
            // Update last used
            await updateTokenLastUsed(tokenData.token.id);

            const isAdmin = tokenData.user.subscription_tier === 'admin' ||
                            isServerAdmin(tokenData.user.email || '', tokenData.user.username || '');
            
            console.log('[Auth Helper] Bearer auth - userId:', tokenData.token.user_id, '| isAdmin:', isAdmin);
            return { userId: tokenData.token.user_id, isAdmin };
          }
        }
      } catch (err) {
        console.error('[Auth Helper] Bearer token auth error:', err);
      }
    }
    
    // Second: Try Session (Web App)
    const session = await getServerSession(authOptions);
    
    // Debug logging (remove in production if needed)
    console.log('[Auth Helper] Host:', host, '| Has session cookie:', hasSessionCookie, '| Session exists:', !!session, '| Email:', session?.user?.email || 'none');
    
    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin =
      isServerAdmin(session.user.email,
                    (session.user as Record<string, unknown>).username as string || '');
    // session.user.id is set by the JWT callback in [...nextauth]/route.ts
    const token = session.user as Record<string, unknown>;
    const userId = (session.user.id || token.id) as string | undefined ?? null;
    console.log('[Auth Helper] userId:', userId, '| isAdmin:', isAdmin);
    return { userId, isAdmin };
  } catch (error) {
    console.error('[Auth Helper] Error:', error);
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
    console.error('[Auth Helper] Mobile auth error:', error);
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
    console.warn('[Auth Helper] Could not fetch legacy IDs:', error);
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
