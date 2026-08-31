import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * Admin Clear Predictions API
 * ============================
 * 
 * حذف التوقعات (اختيارياً حسب السوق)
 */

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { market } = body;
    
    const dbAny = db as any;
    
    let deletedCount = 0;
    
    if (market && market !== 'all') {
      // حذف حسب السوق
      const result = await dbAny.prediction?.deleteMany({
        where: { market },
      });
      deletedCount = result?.count || 0;
    } else {
      // حذف الكل
      const result = await dbAny.prediction?.deleteMany({});
      deletedCount = result?.count || 0;
    }
    
    return NextResponse.json({
      success: true,
      message: `تم حذف ${deletedCount} توقع`,
      deletedCount,
    });
    
  } catch (error) {
    console.error('[Clear Predictions] Error:', error);
    return NextResponse.json({
      success: false,
      message: 'خطأ في الحذف: ' + String(error),
      deletedCount: 0,
    });
  }
}
