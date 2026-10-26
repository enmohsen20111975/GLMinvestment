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
import { getSessionUserId } from '@/lib/auth-helper';

// P0.1 (SEC-01): admin emails sourced from env vars via @/lib/admin-identities.
// No hardcoded list in this file anymore.

function isAdminEmail(email: string | null | undefined, username?: string | null): boolean {
  return isServerAdmin(email, username);
}

export async function GET(request: NextRequest) {
  try {
    // ============================================================
    // 1. الأول: Bearer token عبر getSessionUserId (للموبايل + الويب)
    // ALERTS-API-FIX (2026-10-01): the previous local Bearer-token
    // check used `apiToken.expires_at > new Date()`, but `expires_at`
    // is stored as String in the Prisma schema — String > Date always
    // evaluates to false → ALL bearer tokens were rejected → 401.
    // The canonical `getSessionUserId()` helper already parses the
    // date correctly (see token-helper.ts parseDateField) and falls
    // back to session cookies, so we delegate to it first.
    // ============================================================
    try {
      const { userId, isAdmin: tokenIsAdmin } = await getSessionUserId();
      if (userId && userId !== 'admin') {
        const dbUser = await db.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            username: true,
            name: true,
            image: true,
            subscription_tier: true,
            default_risk_tolerance: true,
            is_active: true,
            email_verified: true,
          },
        });
        if (dbUser && dbUser.is_active) {
          const isAdmin = isAdminEmail(dbUser.email, dbUser.username) || dbUser.subscription_tier === 'admin' || tokenIsAdmin;
          const effectiveTier = isAdmin ? 'admin' : (dbUser.subscription_tier || 'free');

          // Proactively upgrade DB tier if user is an admin but tier in DB is free
          if (isAdmin && dbUser.subscription_tier !== 'admin') {
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
      }
    } catch (bearerErr) {
      console.error('[GET /api/auth/me] Bearer/session helper error:', bearerErr);
    }

    // ============================================================
    // 2. التاني: فحص NextAuth session (للويب)
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
          select: {
            id: true,
            email: true,
            username: true,
            name: true,
            image: true,
            subscription_tier: true,
            default_risk_tolerance: true,
            is_active: true,
            email_verified: true,
          },
        });

        if (dbUser) {
          // SEC-01 HOTFIX (Phase A): username-based admin detection removed.
          // FIX-P1-SECURITY (CRIT-1): premium is NOT admin. Only 'admin' tier is.
          const isAdmin = isAdminEmail(dbUser.email, dbUser.username) || dbUser.subscription_tier === 'admin';
          const effectiveTier = isAdmin ? 'admin' : (dbUser.subscription_tier || 'free');

          // Proactively upgrade DB tier if user is an admin but tier in DB is free
          if (isAdmin && dbUser.subscription_tier !== 'admin') {
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
    // BRAVO-FIX8: return 200 with not_authenticated (not 500) — matching owner directive
    // الـ 500 بـ يسبب console spam + الـ client بـ يعمل retry. لو مفيش session، ده مش error.
    return NextResponse.json(
      { success: false, authenticated: false, error: 'not_authenticated' },
      { status: 200 }
    );
  }
}
