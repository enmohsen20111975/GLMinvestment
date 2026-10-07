import { NextRequest, NextResponse } from 'next/server';
import { predictionsDb } from '@/lib/db-predictions';
import { Prisma } from '@prisma/predictions-client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/crypto-predictions
 * يقرأ توقعات العملات الرقمية من predictions.db (market='CRYPTO')
 * (مش Python proxy — بيانات حقيقية من قاعدة التوقعات)
 *
 * Query params:
 *  - status: PENDING | CLOSED | all (default all)
 *  - ticker: فلترة برمز عملة محدد
 *  - limit: default 100
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'all';
    const ticker = searchParams.get('ticker');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    // بناء شرط where
    const where: Prisma.PredictionWhereInput = { market: 'CRYPTO' };
    if (status === 'PENDING') {
      where.outcome_date = null;
    } else if (status === 'CLOSED') {
      where.outcome_date = { not: null };
    }
    if (ticker) {
      where.ticker = ticker.toUpperCase();
    }

    const predictions = await predictionsDb.prediction.findMany({
      where,
      orderBy: { prediction_date: 'desc' },
      take: limit,
    });

    // إحصائيات
    const stats = {
      total: predictions.length,
      pending: predictions.filter((p) => !p.outcome_date).length,
      closed: predictions.filter((p) => p.outcome_date).length,
      wins: predictions.filter((p) => p.hit_target === 1).length,
      losses: predictions.filter((p) => p.hit_stop === 1).length,
      avg_return:
        predictions.length > 0
          ? predictions.reduce((s, p) => s + (p.actual_return || 0), 0) /
            predictions.length
          : 0,
    };

    return NextResponse.json({
      success: true,
      count: predictions.length,
      stats,
      data: predictions,
    });
  } catch (e) {
    console.error('[api/crypto-predictions] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
