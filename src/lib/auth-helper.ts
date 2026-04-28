/**
 * auth-helper.ts — Shared authentication utility for API routes.
 *
 * Provides getSessionUserId() which extracts the authenticated user's ID
 * from the NextAuth session. Used by all user-scoped API routes.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

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
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin =
      ADMIN_EMAILS.includes(session.user.email) ||
      ADMIN_USERNAMES.includes((session.user as Record<string, unknown>).username as string || '');
    // session.user.id is set by the JWT callback in [...nextauth]/route.ts
    const token = session.user as Record<string, unknown>;
    const userId = (session.user.id || token.id) as string | undefined ?? null;
    return { userId, isAdmin };
  } catch {
    return { userId: null, isAdmin: false };
  }
}
