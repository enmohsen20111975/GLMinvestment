import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, verifyAdminPassword } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// POST /api/admin/auth
// Verify admin password for protected admin operations
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();
    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور مطلوبة' },
        { status: 400 }
      );
    }

    const isValid = verifyAdminPassword(password);

    if (isValid) {
      return NextResponse.json({
        success: true,
        message: 'تم التحقق بنجاح',
        token: 'admin_session_' + Date.now(), // Simple token for session
      });
    } else {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور غير صحيحة' },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('[POST /api/admin/auth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء التحقق' },
      { status: 500 }
    );
  }
}
