/**
 * Admin Layout
 * ============
 * بيحمي كل صفحات /admin/* - بس الأدمن يقدر يفتحها.
 * لو المستخدم مش أدمن → redirect للصفحة الرئيسية.
 */

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';
import { isServerAdmin } from '@/lib/admin-identities'; // P0.1 (SEC-01)

// P0.1 (SEC-01): admin emails sourced from env vars via @/lib/admin-identities.

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let isAdmin = false;

  // DEV: سمح بكل حاجة على لو كنت في localhost أو في وضع التطوير
  const headersList = (await import('next/headers')).headers();
  const host =
    headersList.get('x-forwarded-host') ||
    headersList.get('host') ||
    '';
  // Allow localhost, 127.x, private IPs, and dev environments
  const isLocalhost =
    host.startsWith('localhost') ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    process.env.NODE_ENV === 'development';

  if (isLocalhost) {
    isAdmin = true;
  } else {
    try {
      const session = await getServerSession(authOptions);

      if (session?.user?.email) {
        // فحص بالإيميل
        if (isServerAdmin(session.user.email)) {
          isAdmin = true;
        } else {
          // فحص بـ DB
          const dbUser = await db.user.findUnique({
            where: { email: session.user.email },
            select: { subscription_tier: true, is_active: true },
          });

          if (dbUser && dbUser.is_active) {
            if (
              dbUser.subscription_tier === 'admin' ||
              dbUser.subscription_tier === 'premium'
            ) {
              isAdmin = true;
            }
          }
        }
      }
    } catch (e) {
      // لو فيه خطأ في الـ session، نعتبره مش أدمن
      console.error('[AdminLayout] Auth check error:', e);
    }
  }

  if (!isAdmin) {
    // redirect للصفحة الرئيسية
    redirect('/');
  }

  return <>{children}</>;
}