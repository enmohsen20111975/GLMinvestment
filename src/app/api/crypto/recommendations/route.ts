import { NextRequest, NextResponse } from 'next/server';
import { predictionsDb } from '@/lib/db-predictions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crypto/recommendations
 * توصيات العملات الرقمية من predictions.db (market='CRYPTO')
 * بيرجع التوقعات النشطة (Pending) مرتبة حسب التاريخ
 *
 * Query params:
 *  - limit: default 20
 *  - signal: BUY | SELL | all
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const signal = searchParams.get('signal');

    const recommendations = await predictionsDb.prediction.findMany({
      where: {
        market: 'CRYPTO',
        outcome_date: null,
        ...(signal && signal !== 'all' ? { signal: signal.toUpperCase() } : {}),
      },
      orderBy: { prediction_date: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      count: recommendations.length,
      data: recommendations,
    });
  } catch (e) {
    console.error('[api/crypto/recommendations] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        data: [],
      },
      { status: 500 }
    );
  }
}
