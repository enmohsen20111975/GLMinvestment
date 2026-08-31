import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/egx-db';
// v2/prediction-logger deleted (CLOSED CAMP). Stub:
const getRecentPredictions = () => [];

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 200);
    const offset = Number(searchParams.get('offset') || '0');

    const predictions = getRecentPredictions(limit, offset);

    return NextResponse.json({
      success: true,
      count: predictions.length,
      predictions,
    });
  } catch (err) {
    console.error('[Feedback Predictions API] Error:', err);
    return NextResponse.json(
      { success: false, message: 'حدث خطأ في جلب التنبؤات' },
      { status: 500 }
    );
  }
}
