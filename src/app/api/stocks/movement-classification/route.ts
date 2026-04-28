import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getHeavyDbHealth } from '@/lib/egx-db';
import { classifyStockMovement, type StockMovementInfo } from '@/lib/stock-movement-classifier';

export const maxDuration = 60;

/**
 * GET /api/stocks/movement-classification
 * 
 * Get movement classification for all stocks or a specific stock
 * Query params:
 * - ticker: specific stock ticker (optional)
 * - min_score: minimum movement score filter (optional, 0-100)
 * - type: filter by movement type (alive, slow, dead) (optional)
 */
export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();

    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker');
    const minScore = searchParams.get('min_score');
    const typeFilter = searchParams.get('type');

    // Check if heavy DB is available
    const heavyDbStatus = getHeavyDbHealth();
    if (!heavyDbStatus.loaded) {
      return NextResponse.json({
        error: 'Heavy database not available',
        detail: 'Price history data is required for movement classification',
        heavy_db_status: heavyDbStatus,
      }, { status: 503 });
    }

    // Import heavy DB functions
    const { getHeavyDb } = await import('@/lib/egx-db');
    const db = getHeavyDb();

    // Get stocks to classify
    let stocks: Array<{ id: number; ticker: string; name: string; name_ar: string | null }>;
    
    if (ticker) {
      // Get specific stock
      const rows = db.exec(`
        SELECT id, ticker, name, name_ar FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1
      `, [ticker.toUpperCase()]);
      
      if (!rows.length || !rows[0].values.length) {
        return NextResponse.json({ error: 'Stock not found', ticker }, { status: 404 });
      }
      
      stocks = rows[0].values.map(row => ({
        id: Number(row[0]),
        ticker: String(row[1]),
        name: String(row[2]),
        name_ar: row[3] ? String(row[3]) : null,
      }));
    } else {
      // Get all active stocks
      const rows = db.exec(`
        SELECT id, ticker, name, name_ar FROM stocks WHERE is_active = 1 ORDER BY ticker
      `);
      
      if (!rows.length) {
        return NextResponse.json({ stocks: [], total: 0 });
      }
      
      stocks = rows[0].values.map(row => ({
        id: Number(row[0]),
        ticker: String(row[1]),
        name: String(row[2]),
        name_ar: row[3] ? String(row[3]) : null,
      }));
    }

    // Classify each stock
    const results: Array<StockMovementInfo & { name: string; name_ar: string | null }> = [];

    for (const stock of stocks) {
      // Get price history for the last year (252 trading days)
      const historyRows = db.exec(`
        SELECT date, close_price, volume 
        FROM stock_price_history 
        WHERE stock_id = ? 
        ORDER BY date DESC 
        LIMIT 252
      `, [stock.id]);

      if (!historyRows.length || !historyRows[0].values.length) {
        continue;
      }

      const history = historyRows[0].values.map(row => ({
        date: String(row[0]),
        close: Number(row[1]) || 0,
        volume: Number(row[2]) || 0,
      }));

      const classification = classifyStockMovement(history, stock.ticker);

      // Apply filters
      if (minScore && classification.movement_score < Number(minScore)) {
        continue;
      }
      
      if (typeFilter && classification.movement_type !== typeFilter) {
        continue;
      }

      results.push({
        ...classification,
        name: stock.name,
        name_ar: stock.name_ar,
      });
    }

    // Sort by movement score descending
    results.sort((a, b) => b.movement_score - a.movement_score);

    // Summary statistics
    const summary = {
      total_classified: results.length,
      alive_count: results.filter(r => r.movement_type === 'alive').length,
      slow_count: results.filter(r => r.movement_type === 'slow').length,
      dead_count: results.filter(r => r.movement_type === 'dead').length,
      unknown_count: results.filter(r => r.movement_type === 'unknown').length,
    };

    return NextResponse.json({
      stocks: results,
      summary,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/stocks/movement-classification] Error:', error);
    return NextResponse.json(
      { error: 'Failed to classify stocks', detail: String(error) },
      { status: 500 }
    );
  }
}
