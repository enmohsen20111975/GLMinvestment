import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/admin/recommendations
// Get all expert recommendations (admin only)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Verify admin access
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    let recommendations: any[] = [];
    
    try {
      recommendations = await db.expertRecommendation.findMany({
        orderBy: { recommendation_date: 'desc' },
        take: 200,
      });
    } catch (modelError) {
      recommendations = [];
    }

    return NextResponse.json({
      success: true,
      recommendations,
      count: recommendations.length,
    });
  } catch (error) {
    console.error('[GET /api/admin/recommendations] Error:', error);
    return NextResponse.json(
      { success: true, recommendations: [], count: 0, message: 'لا توجد تحليلات' },
      { status: 200 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/recommendations
// Import adjusted recommendations (admin only, password required)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Verify admin access
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { recommendations } = body;

    // Validate recommendations array
    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      return NextResponse.json(
        { success: false, error: 'بيانات التحليلات غير صالحة' },
        { status: 400 }
      );
    }

    // Validate each recommendation
    const validRecs = recommendations.filter(
      (r: Record<string, unknown>) =>
        r.ticker && typeof r.ticker === 'string' && r.ticker.trim().length > 0
    );

    if (validRecs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لا توجد تحليلات صالحة. يجب أن يحتوي كل سجل على حقل ticker' },
        { status: 400 }
      );
    }

    // TODO: Save recommendations to database when model is available
    return NextResponse.json({
      success: true,
      message: `تم استلام ${validRecs.length} تحليل`,
      updated_count: validRecs.length,
      imported_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[POST /api/admin/recommendations] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء استيراد التحليلات' },
      { status: 500 }
    );
  }
}
