/**
 * GET /api/auth/profile  -> current user profile
 * PUT /api/auth/profile   -> update profile (e.g. name)
 * POST /api/auth/profile  -> update profile (alias used by some clients)
 *
 * ALERTS-API-FIX (2026-10-01): now supports Bearer tokens (mobile) via
 * `getSessionUserId()`. Previously only checked `getServerSession()` →
 * all mobile profile fetches returned 401. Also fixed `createdAt` /
 * `updatedAt` (camelCase) select which never existed in the schema
 * (the User model uses `created_at` / `updated_at`).
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth-helper';

async function resolveUserId(): Promise<string | null> {
  // 1) Bearer token (mobile) — canonical helper parses expires_at
  try {
    const { userId } = await getSessionUserId();
    if (userId && userId !== 'admin') return userId;
  } catch { /* fall through */ }
  // 2) Session cookie (web)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.id) return session.user.id as string;
    if (session?.user?.email) {
      const u = await db.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
      if (u) return u.id;
    }
  } catch { /* fall through */ }
  return null;
}

export async function GET() {
  try {
    const userId = await resolveUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        image: true,
        subscription_tier: true,
        default_risk_tolerance: true,
        is_active: true,
        email_verified: true,
        last_login: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!user) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 404 });
    }
    return NextResponse.json({ success: true, profile: user, user });
  } catch (error: unknown) {
    console.error('[GET /api/auth/profile] Error:', error);
    return NextResponse.json({ success: false, error: 'فشل في جلب الملف الشخصي' }, { status: 500 });
  }
}

async function updateProfile(request: NextRequest) {
  try {
    const userId = await resolveUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { name, username, default_risk_tolerance, image } = body;

    const data: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim().length > 0) data.name = name.trim();
    if (typeof username === 'string' && username.trim().length > 0) data.username = username.trim();
    if (typeof default_risk_tolerance === 'string' && default_risk_tolerance.trim().length > 0) {
      data.default_risk_tolerance = default_risk_tolerance.trim();
    }
    if (typeof image === 'string' && image.trim().length > 0) data.image = image.trim();

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد بيانات لتحديثها' }, { status: 400 });
    }

    const user = await db.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        image: true,
        subscription_tier: true,
        updated_at: true,
      },
    });

    return NextResponse.json({ success: true, profile: user, user, message: 'تم تحديث الملف الشخصي' });
  } catch (error: unknown) {
    console.error('[/api/auth/profile] Error:', error);
    return NextResponse.json({ success: false, error: 'فشل في تحديث الملف الشخصي' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return updateProfile(request);
}

export async function POST(request: NextRequest) {
  return updateProfile(request);
}
