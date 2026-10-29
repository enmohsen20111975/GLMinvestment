/**
 * POST /api/auth/login
 *
 * Mobile login endpoint - Returns Bearer token for mobile apps
 * 
 * Request Body:
 * {
 *   "username_or_email": "user@example.com",
 *   "password": "password123"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Login successful",
 *   "message_ar": "تم تسجيل الدخول بنجاح",
 *   "user": { ... },
 *   "token": "egx_uuid_token_timestamp",
 *   "token_type": "Bearer",
 *   "expires_in": 2592000
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { checkAuthRateLimit } from '@/lib/rate-limiter'; // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #2)
import { isServerAdmin } from '@/lib/admin-identities';

// Token expiry: 30 days
const TOKEN_EXPIRY_DAYS = 30;

export async function POST(request: NextRequest) {
  try {
    // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #2): rate limit brute-force attempts.
    // 5 attempts per minute per IP. Returns 429 with Retry-After on exceedance.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const rl = checkAuthRateLimit(ip);
    if (!rl.ok) {
      const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { success: false, error: 'rate_limit_exceeded', retry_after_seconds: retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      );
    }

    const body = await request.json();
    const { username_or_email, password } = body;

    // Validate required fields
    if (!username_or_email || typeof username_or_email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'اسم المستخدم أو البريد الإلكتروني مطلوب' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور مطلوبة' },
        { status: 400 }
      );
    }

    // Find user by email or username
    let user;
    try {
      user = await db.user.findFirst({
        where: {
          OR: [
            { email: username_or_email.toLowerCase().trim() },
            { username: username_or_email.trim() },
          ],
        },
      });
    } catch (dbError: any) {
      console.error('[Login] DB error:', dbError?.message || dbError);
      return NextResponse.json(
        { success: false, error: 'قاعدة البيانات غير متاحة حالياً', error_en: 'Database temporarily unavailable' },
        { status: 503 }
      );
    }

    if (!user) {
      // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #3): unified error message to prevent
      // username/email enumeration. The specific reason is logged server-side only.
      console.warn('[auth/login]', 'user_not_found', { username_or_email });
      return NextResponse.json(
        { success: false, error: 'بيانات الدخول غير صحيحة' },
        { status: 401 }
      );
    }

    // Check if user is active
    if (!user.is_active) {
      return NextResponse.json(
        { success: false, error: 'الحساب غير مفعل', error_en: 'Account is deactivated' },
        { status: 403 }
      );
    }

    // Check password — support both DB bcrypt hash and env-configured admin password
    const envAdminPassword = (process.env.ADMIN_PASSWORD || '').trim();
    const isAdmin = isServerAdmin(user.email, user.username);
    const envAdminMatches = isAdmin && envAdminPassword.length > 0 && password === envAdminPassword;

    let passwordMatch = envAdminMatches;
    if (!passwordMatch && user.password_hash) {
      passwordMatch = await bcrypt.compare(password, user.password_hash);
    }

    if (!passwordMatch) {
      // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #3): unified error message; log the reason.
      console.warn('[auth/login]', 'wrong_password', { user_id: user.id });
      return NextResponse.json(
        { success: false, error: 'بيانات الدخول غير صحيحة' },
        { status: 401 }
      );
    }

    // Generate API token
    const token = `egx_${user.id}_${randomUUID()}_${Date.now()}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);
    const expiresAtISO = expiresAt.toISOString();

    // Get device info from headers
    const userAgent = request.headers.get('user-agent') || null;
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                      request.headers.get('x-real-ip') || null;

    // Create token in database using raw query to ensure ISO format
    try {
      await db.$executeRaw`
        INSERT INTO api_tokens (id, user_id, token, device_info, ip_address, expires_at, created_at)
        VALUES (
          ${randomUUID()},
          ${user.id},
          ${token},
          ${userAgent},
          ${ipAddress},
          ${expiresAtISO},
          ${new Date().toISOString()}
        )
      `;
      console.log('[Login] Token created with ISO date format');
    } catch (tokenError) {
      console.error('[Login] Token creation error:', tokenError);
      // Fallback: try Prisma create
      try {
        await db.apiToken.create({
          data: {
            id: randomUUID(),
            user_id: user.id,
            token,
            expires_at: expiresAt as any,
          },
        });
      } catch (fallbackError) {
        console.error('[Login] Fallback token creation also failed:', fallbackError);
      }
    }

    // Update last login
    await db.user.update({
      where: { id: user.id },
      data: { last_login: new Date().toISOString() },
    });

    // Get subscription info
    const subscription = await db.userSubscription.findUnique({
      where: { user_id: user.id },
      include: { SubscriptionPlan: true },
    });

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      message_ar: 'تم تسجيل الدخول بنجاح',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        image: user.image,
        subscription_tier: subscription?.SubscriptionPlan?.name || user.subscription_tier,
        is_admin: user.subscription_tier === 'admin',
      },
      token,
      token_type: 'Bearer',
      expires_in: TOKEN_EXPIRY_DAYS * 24 * 60 * 60, // seconds
    });

  } catch (error) {
    console.error('[POST /api/auth/login] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تسجيل الدخول' },
      { status: 500 }
    );
  }
}
