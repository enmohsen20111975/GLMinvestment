import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { isAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/db';

/**
 * POST /api/admin/auth/auto-cookie
 * ===============================
 * يحل مشكلة "ADMIN_AUTH_REQUIRED" للأدمن المسجل بـ Google.
 *
 * المشكلة:
 *   الـ middleware يعمل في Edge runtime ولا يمكنه فحص NextAuth session
 *   (يحتاج Node.js runtime). لذلك الأدمن المسجل بـ Google يحصل على 401
 *   عند استدعاء /api/admin/db-manager/repair وغيرها من destructive endpoints.
 *
 * الحل:
 *   هذا الـ endpoint يفحص الـ NextAuth session، ولو المستخدم أدمن
 *   (عبر isAdmin(email) أو subscription_tier='admin'/'premium')،
 *   يضبط httpOnly cookie `admin_session` = ADMIN_SESSION_TOKEN.
 *   بعدها كل الـ admin API calls ستعمل عبر الـ middleware.
 *
 * الاستخدام:
 *   - الـ AdminView يستدعيه POST على mount
 *   - لو success: المستخدم أدمن وكل الـ endpoints ستعمل
 *   - لو 403: ليس أدمن
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'لا توجد جلسة — سجّل دخول Google أولاً' },
        { status: 401 }
      );
    }

    const email = session.user.email.toLowerCase().trim();

    // فحص 1: isAdmin (قائمة الـ emails المعروفة)
    let authorized = isAdmin(email);

    // فحص 2: subscription_tier من DB
    if (!authorized) {
      try {
        const dbUser = await db.user.findUnique({
          where: { email },
          select: { subscription_tier: true, is_active: true },
        });
        if (dbUser && dbUser.is_active && (dbUser.subscription_tier === 'admin' || dbUser.subscription_tier === 'premium')) {
          authorized = true;
        }
      } catch (dbErr) {
        // لو DB غير متاح، نعتمد على isAdmin فقط
        console.error('[auto-cookie] DB check failed:', dbErr);
      }
    }

    if (!authorized) {
      return NextResponse.json(
        { success: false, error: 'ليس لديك صلاحية أدمن', email },
        { status: 403 }
      );
    }

    // ضبط الـ cookie
    const sessionToken = process.env.ADMIN_SESSION_TOKEN;
    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: 'ADMIN_SESSION_TOKEN not configured on server' },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      message: 'تم تفعيل صلاحيات الأدمن تلقائياً',
      email,
      expires: '7d',
    });

    // httpOnly cookie يبقى 7 أيام
    response.cookies.set('admin_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 أيام
    });

    return response;
  } catch (error) {
    console.error('[auto-cookie] Error:', error);
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
