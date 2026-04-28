import { NextRequest, NextResponse } from 'next/server';
import { generateRecommendations } from '@/lib/v2/recommendation-engine';
import { logBatchPredictions } from '@/lib/v2/prediction-logger';
import { getWeight } from '@/lib/v2/config-service';
import type { RecommendRequest } from '@/lib/v2/types';
import { ensureInitialized } from '@/lib/egx-db';

/**
 * POST /api/v2/recommend
 * Main V2 recommendation engine endpoint.
 * Pure calculations, no AI — 4-layer system.
 * Automatically logs predictions for the self-learning feedback loop.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();

    const body = await request.json().catch(() => ({}));

    const params: RecommendRequest = {
      capital: Number(body.capitor) || Number(body.capital) || undefined,
      timeHorizon: body.timeHorizon || body.time_horizon || undefined,
      incomeStability: body.incomeStability || body.income_stability || undefined,
      age: body.age ? Number(body.age) : undefined,
      sector: body.sector || undefined,
      limit: body.limit ? Number(body.limit) : undefined,
    };

    const result = generateRecommendations(params);

    // Auto-log predictions for feedback loop (non-blocking)
    const autoLog = getWeight('feedback_enabled', 1);
    if (autoLog) {
      try {
        logBatchPredictions(result.stocks, result.market);
      } catch (logErr) {
        console.warn('[V2 Recommend] Prediction logging failed (non-critical):', logErr);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/v2/recommend] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate recommendations', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v2/recommend
 * Quick recommendations with default params.
 */
export async function GET() {
  try {
    await ensureInitialized();

    const result = generateRecommendations({ limit: 500 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[GET /api/v2/recommend] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate recommendations', detail: String(error) },
      { status: 500 }
    );
  }
}
