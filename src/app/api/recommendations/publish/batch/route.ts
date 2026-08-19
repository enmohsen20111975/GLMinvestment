import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/recommendations/publish/batch
 * Publish multiple recommendations at once
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tickers, recommendations } = body;

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Tickers array is required' },
        { status: 400 }
      );
    }

    // Log batch publish
    console.log('[BATCH PUBLISH] Publishing recommendations:', {
      count: tickers.length,
      tickers,
      publishedAt: new Date().toISOString(),
    });

    // In a real implementation, this would:
    // 1. Batch insert recommendations to database
    // 2. Send batch notifications
    // 3. Update recommendation statuses

    const publishedAt = new Date().toISOString();
    const publishedRecs = recommendations?.map((rec: any) => ({
      ...rec,
      published: true,
      publishedAt,
    })) || tickers.map((ticker: string) => ({
      ticker,
      published: true,
      publishedAt,
    }));

    return NextResponse.json({
      success: true,
      message: `تم نشر ${tickers.length} تحليل`,
      count: tickers.length,
      data: publishedRecs,
    });
  } catch (error) {
    console.error('[BATCH PUBLISH] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to publish recommendations' },
      { status: 500 }
    );
  }
}
