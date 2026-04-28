import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStockByTicker } from '@/lib/egx-db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    await ensureInitialized();
    const { ticker } = await params;
    const stock = getStockByTicker(ticker);

    if (!stock) {
      return NextResponse.json(
        { error: 'Stock not found', detail: `No stock found with ticker: ${ticker}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: stock });
  } catch (error) {
    console.error(`[GET /api/stocks/:ticker] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch stock', detail: String(error) },
      { status: 500 }
    );
  }
}
