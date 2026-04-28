import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-auth';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/admin/users
// Return all registered users with their details.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // Verify admin access via custom header or cookie
    const authError = requireAdminRequest(request);
    if (authError) return authError;

    const users = await db.user.findMany({
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        image: true,
        is_active: true,
        subscription_tier: true,
        default_risk_tolerance: true,
        last_login: true,
        email_verified: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error('[GET /api/admin/users] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب المستخدمين' },
      { status: 500 }
    );
  }
}
