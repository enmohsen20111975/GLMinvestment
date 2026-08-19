/**
 * GET /api/auth/profile  -> current user profile
 * PUT /api/auth/profile   -> update profile (e.g. name)
 * POST /api/auth/profile  -> update profile (alias used by some clients)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
    });
    if (!user) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 404 });
    }
    return NextResponse.json({ success: true, profile: user, user });
  } catch (error: any) {
    console.error('[GET /api/auth/profile] Error:', error);
    return NextResponse.json({ success: false, error: 'فشل في جلب الملف الشخصي' }, { status: 500 });
  }
}

async function updateProfile(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { name } = body;

    const data: { name?: string } = {};
    if (typeof name === 'string' && name.trim().length > 0) {
      data.name = name.trim();
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد بيانات لتحديثها' }, { status: 400 });
    }

    const user = await db.user.update({
      where: { id: session.user.id },
      data,
      select: { id: true, email: true, name: true, updatedAt: true },
    });

    return NextResponse.json({ success: true, profile: user, user, message: 'تم تحديث الملف الشخصي' });
  } catch (error: any) {
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
