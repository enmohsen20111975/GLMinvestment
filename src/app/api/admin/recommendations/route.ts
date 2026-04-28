import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, verifyAdminPassword, importRecommendations } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// POST /api/admin/recommendations
// Import adjusted recommendations (admin only, password required)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();
    const body = await request.json();
    const { password, recommendations } = body;

    // Verify admin password
    if (!verifyAdminPassword(password || '')) {
      return NextResponse.json(
        { success: false, error: 'كلمة المرور غير صحيحة' },
        { status: 401 }
      );
    }

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

    // Import recommendations
    const result = importRecommendations(
      validRecs.map((r: Record<string, unknown>) => ({
        ticker: (r.ticker as string).toUpperCase(),
        recommendation_action: r.recommendation_action as string | undefined,
        recommendation_ar: r.recommendation_ar as string | undefined,
        confidence_score: typeof r.confidence_score === 'number' ? r.confidence_score : undefined,
        total_score: typeof r.total_score === 'number' ? r.total_score : undefined,
        technical_score: typeof r.technical_score === 'number' ? r.technical_score : undefined,
        fundamental_score: typeof r.fundamental_score === 'number' ? r.fundamental_score : undefined,
        risk_score: typeof r.risk_score === 'number' ? r.risk_score : undefined,
        trend_direction: r.trend_direction as string | undefined,
        target_price: typeof r.target_price === 'number' ? r.target_price : undefined,
        stop_loss: typeof r.stop_loss === 'number' ? r.stop_loss : undefined,
        entry_price: typeof r.entry_price === 'number' ? r.entry_price : undefined,
        time_horizon: r.time_horizon as string | undefined,
        news_sentiment: r.news_sentiment as string | undefined,
        news_impact: r.news_impact as string | undefined,
        notes: r.notes as string | undefined,
      }))
    );

    return NextResponse.json({
      success: true,
      message: `تم تحديث ${result.updated} تحليل بنجاح${result.skipped > 0 ? `، تم تخطي ${result.skipped}` : ''}`,
      updated_count: result.updated,
      skipped_count: result.skipped,
      errors: result.errors,
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
