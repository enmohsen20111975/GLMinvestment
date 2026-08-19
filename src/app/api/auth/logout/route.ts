/**
 * POST /api/auth/logout
 *
 * Logout and invalidate token
 * 
 * Headers:
 *   Authorization: Bearer <token>
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Logged out successfully",
 *   "message_ar": "تم تسجيل الخروج بنجاح"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: 'Authorization header مطلوب' },
        { status: 401 }
      );
    }

    // Extract token
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token غير صالح' },
        { status: 401 }
      );
    }

    // Delete token from database
    try {
      await db.apiToken.delete({ where: { token } });
    } catch {
      // Token might not exist, that's okay
    }

    return NextResponse.json({
      success: true,
      message: 'Logged out successfully',
      message_ar: 'تم تسجيل الخروج بنجاح',
    });

  } catch (error) {
    console.error('[POST /api/auth/logout] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تسجيل الخروج' },
      { status: 500 }
    );
  }
}
