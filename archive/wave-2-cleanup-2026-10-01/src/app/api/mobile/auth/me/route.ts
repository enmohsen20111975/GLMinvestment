/**
 * GET /api/mobile/auth/me
 *
 * Get current user info using Bearer token
 * Mobile-specific endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { validateTokenWithUser, updateTokenLastUsed } from '@/lib/token-helper';

export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json({
        success: false,
        error: 'Authorization header مطلوب',
        error_en: 'Authorization header required',
      }, { status: 401 });
    }

    // Extract token
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      return NextResponse.json({
        success: false,
        error: 'Token غير صالح',
        error_en: 'Invalid token',
      }, { status: 401 });
    }

    // Validate token using robust helper
    const result = await validateTokenWithUser(token);

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Token غير موجود أو منتهي الصلاحية',
        error_en: 'Token not found or expired',
      }, { status: 401 });
    }

    const { token: tokenData, user } = result;

    // Check if user is active
    if (!user.is_active) {
      return NextResponse.json({
        success: false,
        error: 'الحساب غير مفعل',
        error_en: 'Account is deactivated',
      }, { status: 403 });
    }

    // Update last used timestamp
    await updateTokenLastUsed(tokenData.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        image: user.image,
        subscription_tier: user.subscription_tier || 'free',
        is_admin: user.subscription_tier === 'admin',
        is_active: !!user.is_active,
      },
    });

  } catch (error) {
    console.error('[GET /api/mobile/auth/me] Error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ أثناء جلب بيانات المستخدم',
      error_en: 'Error fetching user data',
    }, { status: 500 });
  }
}
