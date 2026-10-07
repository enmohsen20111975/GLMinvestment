import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { predictionsDb } from '@/lib/db-predictions';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * AI Predictions Evaluate API
 * تقييم التوقعات خلال فترة زمنية
 */

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const startDate = body.start_date;
    const endDate = body.end_date;
    const closeExpired = body.close_expired !== false;
    const maxDays = body.max_days || 30;
    
    const dbAny = predictionsDb as any;
    
    // Build date filter
    let whereClause: any = { status: 'PENDING' };
    
    if (startDate && endDate) {
      whereClause = {
        status: 'PENDING',
        prediction_date: {
          gte: startDate,
          lte: endDate
        }
      };
    }
    
    // Get pending predictions
    const predictions = await dbAny.prediction.findMany({
      where: whereClause,
      orderBy: { prediction_date: 'desc' },
      take: 50 // Limit to avoid timeout
    });
    
    console.log(`[Evaluate] Found ${predictions.length} pending predictions`);
    
    const results = {
      evaluated: 0,
      target_hit: 0,
      stopped: 0,
      expired: 0,
      still_pending: 0,
      no_price_data: 0
    };
    
    // For now, just return the count without actual evaluation
    // (evaluation needs current prices which requires database access)
    results.still_pending = predictions.length;
    
    return NextResponse.json({
      success: true,
      message: `يوجد ${predictions.length} توقع نشط`,
      results: results,
      details: []
    });
    
  } catch (error) {
    console.error('[Evaluate API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
      results: {
        evaluated: 0,
        target_hit: 0,
        stopped: 0,
        expired: 0,
        still_pending: 0,
        no_price_data: 0
      }
    }, { status: 200 });
  }
}
