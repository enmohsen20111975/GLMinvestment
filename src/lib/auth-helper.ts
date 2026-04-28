/**
 * auth-helper.ts — Shared authentication utility for API routes.
 *
 * Provides getSessionUserId() which extracts the authenticated user's ID
 * from the NextAuth session. Used by all user-scoped API routes.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { headers } from 'next/headers';

const ADMIN_EMAILS = ['enmohsen2011975@gmail.com', 'ceo@m2y.net'];
const ADMIN_USERNAMES = ['mohseny', 'admin'];

/**
 * Get the authenticated user's ID and admin status from the session.
 *
 * Returns:
 *   - userId: the Prisma user ID (e.g. "cmo8o12ix...") or null if not logged in
 *   - isAdmin: true if the user is in the admin list
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
    
    const session = await getServerSession(authOptions);
    
    // Debug logging (remove in production if needed)
    console.log('[Auth Helper] Host:', host, '| Has session cookie:', hasSessionCookie, '| Session exists:', !!session, '| Email:', session?.user?.email || 'none');
    
    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin =
      ADMIN_EMAILS.includes(session.user.email) ||
      ADMIN_USERNAMES.includes((session.user as Record<string, unknown>).username as string || '');
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
