import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// POST /api/auth/register
// Register a new user with email, username, and password
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // Quick health check — can we reach the database?
    try {
      await db.user.count();
    } catch (dbHealthError) {
      console.error('[POST /api/auth/register] Database connection failed:', dbHealthError);
      return NextResponse.json(
        {
          success: false,
          error: 'قاعدة البيانات غير متاحة حالياً. يرجى المحاولة لاحقاً.',
          detail: 'Database connection failed. The auth database may not be initialized. Please ensure DATABASE_URL is set correctly on the server.',
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { email, username, password, risk_tolerance } = body;

    // Validate required fields
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني مطلوب' },
        { status: 400 }
      );
    }

    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { success: false, error: 'اسم المستخدم مطلوب' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور مطلوبة' },
        { status: 400 }
      );
    }

    // Validate field lengths
    if (username.length < 3) {
      return NextResponse.json(
        { success: false, error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existingByEmail = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingByEmail) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني مستخدم بالفعل' },
        { status: 409 }
      );
    }

    // Check if username already exists
    const existingByUsername = await db.user.findUnique({
      where: { username: username.trim() },
    });

    if (existingByUsername) {
      return NextResponse.json(
        { success: false, error: 'اسم المستخدم مستخدم بالفعل' },
        { status: 409 }
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    // Create user
    const user = await db.user.create({
      data: {
        email: email.toLowerCase().trim(),
        username: username.trim(),
        name: username.trim(),
        password_hash,
        default_risk_tolerance: risk_tolerance || 'medium',
        subscription_tier: 'free',
        is_active: true,
        last_login: new Date(),
      },
    });

    // Generate API key
    const apiKey = `egx_${user.id}_${Date.now()}`;

    return NextResponse.json({
      success: true,
      message: 'تم إنشاء الحساب بنجاح',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        default_risk_tolerance: user.default_risk_tolerance,
      },
      api_key: apiKey,
    });
  } catch (error) {
    console.error('[POST /api/auth/register] Error:', error);

    // Provide specific error messages for known Prisma errors
    const errorMessage = (error as Error)?.message || '';
    if (errorMessage.includes('FOREIGN KEY constraint failed')) {
      return NextResponse.json(
        { success: false, error: 'خطأ في قاعدة البيانات: قيد مفتاح أجنبي. يرجى التأكد من تهيئة قاعدة البيانات بشكل صحيح.' },
        { status: 500 }
      );
    }
    if (errorMessage.includes('no such table')) {
      return NextResponse.json(
        { success: false, error: 'خطأ في قاعدة البيانات: الجدول غير موجود. يرجى تشغيل Prisma migration.' },
        { status: 500 }
      );
    }
    if (errorMessage.includes('SQLITE_CANTOPEN') || errorMessage.includes('Unable to open database')) {
      return NextResponse.json(
        { success: false, error: 'خطأ في قاعدة البيانات: لا يمكن الوصول إلى ملف قاعدة البيانات. يرجى التأكد من صحة DATABASE_URL.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء إنشاء الحساب' },
      { status: 500 }
    );
  }
}
