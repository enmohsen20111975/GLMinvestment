import { NextRequest, NextResponse } from 'next/server';
import { analyzeSingleStock } from '@/lib/v2/recommendation-engine';
import { clearCache } from '@/lib/v2/config-service';
import { ensureInitialized, getHeavyDb, isHeavyDbAvailable } from '@/lib/egx-db';

/**
 * GET /api/v2/stock/[symbol]/analysis
 * Deep single-stock analysis using the V2 4-layer engine.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    await ensureInitialized();

    const { symbol } = await params;
    const ticker = symbol.toUpperCase();

    clearCache();

    // Use heavy DB singleton (55MB, cached in memory after first load)
    if (!isHeavyDbAvailable()) {
      return NextResponse.json(
        { error: 'Heavy database not available', detail: 'Analysis features require the heavy database which is not loaded.' },
        { status: 503 }
      );
    }
    const db = getHeavyDb();

    // Get stock data
    const stock = db.prepare(
      'SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE AND is_active = 1 LIMIT 1'
    ).get(ticker) as Record<string, unknown> | undefined;

    if (!stock) {
      return NextResponse.json(
        { error: 'Stock not found', detail: `No active stock found with ticker: ${ticker}` },
        { status: 404 }
      );
    }

    // Get price history
    const history = db.prepare(`
      SELECT date, open_price as open, high_price as high, low_price as low,
             close_price as close, volume
      FROM stock_price_history
      WHERE stock_id = ?
      ORDER BY date DESC
      LIMIT 120
    `).all(stock.id) as Array<Record<string, unknown>>;

    // Reverse to chronological order
    history.reverse();

    // Analyze
    const recommendation = analyzeSingleStock(stock, history, 100000);

    if (!recommendation) {
      return NextResponse.json(
        { error: 'Analysis failed', detail: 'Could not analyze stock - insufficient data' },
        { status: 422 }
      );
    }

    return NextResponse.json(recommendation);
  } catch (error) {
    console.error('[GET /api/v2/stock] Analysis error:', error);
    return NextResponse.json(
      { error: 'Analysis failed', detail: String(error) },
      { status: 500 }
    );
  }
}
