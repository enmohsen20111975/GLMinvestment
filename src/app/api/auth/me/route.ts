/**
 * GET /api/auth/me
 *
 * بتجيب بيانات المستخدم الحالي - بتدعم طريقتين:
 * 1. NextAuth session cookie (للويب - تسجيل دخول بـ Google/credentials)
 * 2. Bearer token (للموبايل - API token)
 *
 * Response:
 * {
 *   "success": true,
 *   "user": {
 *     "id": "uuid",
 *     "email": "user@example.com",
 *     "is_admin": false,
 *     ...
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';
import { verifyAdminRequest } from '@/lib/admin-auth-server';
import { isServerAdmin } from '@/lib/admin-identities';

// P0.1 (SEC-01): admin emails sourced from env vars via @/lib/admin-identities.
// No hardcoded list in this file anymore.

function isAdminEmail(email: string | null | undefined): boolean {
  return isServerAdmin(email);
}

export async function GET(request: NextRequest) {
  try {
    // ============================================================
    // 1. الأول: فحص NextAuth session (للويب)
    // ============================================================
    let session;
    try {
      session = await getServerSession(authOptions);
    } catch (sessionErr) {
      console.error('[GET /api/auth/me] Session error:', sessionErr);
      session = null;
    }

    if (session?.user?.email) {
      try {
        const dbUser = await db.user.findUnique({
          where: { email: session.user.email },
        });

        if (dbUser) {
          // SEC-01 HOTFIX (Phase A): username-based admin detection removed.
          const isAdmin = isAdminEmail(dbUser.email) || dbUser.subscription_tier === 'admin' || dbUser.subscription_tier === 'premium';
          const effectiveTier = isAdmin ? 'admin' : (dbUser.subscription_tier || 'free');

          // Proactively upgrade DB tier if user is an admin but tier in DB is free
          if (isAdmin && dbUser.subscription_tier !== 'admin' && dbUser.subscription_tier !== 'premium') {
            db.user.update({
              where: { id: dbUser.id },
              data: { subscription_tier: 'admin' },
            }).catch(e => console.error('[GET /api/auth/me] DB tier update failed:', e));
          }

          return NextResponse.json({
            success: true,
            user: {
              id: dbUser.id,
              email: dbUser.email,
              username: dbUser.username || dbUser.name || '',
              name: dbUser.name || dbUser.email || '',
              image: dbUser.image || null,
              subscription_tier: effectiveTier,
              default_risk_tolerance: dbUser.default_risk_tolerance || 'medium',
              is_admin: isAdmin,
              is_active: dbUser.is_active ?? true,
              email_verified: dbUser.email_verified ? true : false,
              last_login: dbUser.last_login?.toISOString?.() || null,
              created_at: dbUser.created_at?.toISOString?.() || new Date().toISOString(),
            },
          });
        }
      } catch (dbErr) {
        console.error('[GET /api/auth/me] DB error:', dbErr);
      }
    }

    // ============================================================
    // 2. التاني: فحص Bearer token (للموبايل)
    // ============================================================
    const authHeader = request.headers.get('authorization');

    if (authHeader) {
      try {
        const token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;

        if (token) {
          const apiToken = await db.apiToken.findUnique({
            where: { token },
            include: { User: true },
          });

          if (apiToken && apiToken.expires_at > new Date() && apiToken.User?.is_active) {
            await db.apiToken.update({
              where: { id: apiToken.id },
              data: { last_used: new Date() },
            });

            const user = apiToken.User;
            // SEC-01 HOTFIX (Phase A): username-based admin detection removed.
            const isAdmin = isAdminEmail(user.email) || user.subscription_tier === 'admin' || user.subscription_tier === 'premium';
            const effectiveTier = isAdmin ? 'admin' : (user.subscription_tier || 'free');

            if (isAdmin && user.subscription_tier !== 'admin' && user.subscription_tier !== 'premium') {
              db.user.update({
                where: { id: user.id },
                data: { subscription_tier: 'admin' },
              }).catch(e => console.error('[GET /api/auth/me] Bearer DB tier update failed:', e));
            }

            return NextResponse.json({
              success: true,
              user: {
                id: user.id,
                email: user.email,
                username: user.username || '',
                name: user.name || user.email || '',
                image: user.image || null,
                subscription_tier: effectiveTier,
                default_risk_tolerance: user.default_risk_tolerance || 'medium',
                is_admin: isAdmin,
                is_active: user.is_active ?? true,
                email_verified: user.email_verified ? true : false,
                last_login: user.last_login?.toISOString?.() || null,
                created_at: user.created_at?.toISOString?.() || new Date().toISOString(),
              },
            });
          }
        }
      } catch (tokenErr) {
        console.error('[GET /api/auth/me] Token error:', tokenErr);
      }
    }

    // ============================================================
    // 3. Admin session cookie (password login — no NextAuth session)
    //    Recognized so /api/auth/me does not 401 the platform owner and
    //    trigger the auth-check poll loop. ADMIN_PASSWORD never leaves
    //    the server; we only trust the httpOnly admin_session cookie.
    // ============================================================
    if (verifyAdminRequest(request)) {
      return NextResponse.json({
        success: true,
        user: {
          id: 'admin',
          email: 'ceo@m2y.net',
          username: process.env.ADMIN_USERNAME || '',
          name: 'Admin',
          image: null,
          subscription_tier: 'admin',
          default_risk_tolerance: 'high',
          is_admin: true,
          is_active: true,
          email_verified: true,
          last_login: null,
          created_at: new Date().toISOString(),
        },
      });
    }

    // ============================================================
    // 4. مفيش session ولا token صالح
    // ============================================================
    return NextResponse.json(
      { success: false, error: 'غير مسجل الدخول' },
      { status: 401 }
    );

  } catch (error) {
    console.error('[GET /api/auth/me] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب بيانات المستخدم' },
      { status: 500 }
    );
  }
}
