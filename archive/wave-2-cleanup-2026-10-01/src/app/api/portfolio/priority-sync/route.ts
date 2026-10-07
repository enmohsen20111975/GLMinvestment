import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db as prisma } from '@/lib/db';
import { ensureInitialized, getLightDb, getSharedCustomDb } from '@/lib/egx-db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { isServerAdmin } from '@/lib/admin-identities'; // P0.1 (SEC-01)

/**
 * Priority Sync API for Portfolio and Watchlist
 * 
 * This endpoint provides SPECIAL TREATMENT for portfolio and watchlist stocks:
 * 1. Sequential processing (one by one) to reduce server load
 * 2. Priority updates from VPS
 * 3. Real-time price enrichment
 * 
 * GET /api/portfolio/priority-sync - Sync portfolio and watchlist stocks from VPS
 */

// P0.1 (SEC-01): admin emails sourced from env vars via @/lib/admin-identities.

// Rate limiting - max 1 request per 10 seconds per user
const SYNC_COOLDOWN_MS = 10000;
const lastSyncByUser = new Map<string, number>();

async function getSessionUserId(): Promise<{ userId: string | null; isAdmin: boolean }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin = isServerAdmin(session.user.email);
    const token = session.user as Record<string, unknown>;
    const userId = (session.user.id || token.id) as string | undefined ?? null;
    return { userId, isAdmin };
  } catch {
    return { userId: null, isAdmin: false };
  }
}

/**
 * Fetch a single stock's current price from VPS (sequential, one at a time)
 */
async function fetchStockPriceFromVps(ticker: string): Promise<{ price: number; previous_close: number; change_percent: number } | null> {
  const vpsUrl = process.env.VPS_API_URL || process.env.EGXPY_BRIDGE_URL || process.env.EGXPY_SERVICE_URL;
  if (!vpsUrl) return null;

  try {
    const vpsApiKey = process.env.VPS_API_KEY || process.env.EGXPY_API_KEY;
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (vpsApiKey) headers['X-API-Key'] = vpsApiKey;

    // Use single stock endpoint
    const stockUrl = `${vpsUrl.replace(/\/$/, '')}/api/stock/${ticker}`;
    
    const response = await fetch(stockUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000), // 10 second timeout per stock
    });

    if (!response.ok) return null;

    const data = await response.json();
    const stock = data.stock || data;
    
    const price = Number(stock.current_price || stock.price) || 0;
    const previousClose = Number(stock.previous_close) || price;
    const changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;

    return { price, previous_close: previousClose, change_percent: changePercent };
  } catch (err) {
    console.error(`[PrioritySync] Error fetching ${ticker}:`, err);
    return null;
  }
}

/**
 * Update stock price in local database (stocks.db)
 */
async function updateStockPrice(ticker: string, price: number, previousClose: number): Promise<void> {
  try {
    const db = await getSharedCustomDb();
    db.prepare(`
      UPDATE stocks 
      SET current_price = ?, previous_close = ?, last_update = datetime('now')
      WHERE ticker = ?
    `).run(price, previousClose, ticker);
  } catch (err) {
    console.error(`[PrioritySync] Error updating ${ticker}:`, err);
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { userId } = await getSessionUserId();
    
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limiting
    const lastSync = lastSyncByUser.get(userId) || 0;
    const timeSinceLastSync = Date.now() - lastSync;
    if (timeSinceLastSync < SYNC_COOLDOWN_MS) {
      return NextResponse.json({
        success: true,
        cached: true,
        message: 'Sync recently performed',
        next_sync_in_seconds: Math.ceil((SYNC_COOLDOWN_MS - timeSinceLastSync) / 1000),
      });
    }

    await ensureInitialized();

    // Get portfolio stocks (PRIORITY)
    const portfolioPositions = await prisma.portfolioPosition.findMany({
      where: { user_id: userId, is_active: true },
      select: { stock_symbol: true, shares: true, avg_cost: true },
    });

    // Get watchlist stocks (SECONDARY)
    const db = getLightDb();
    const watchlistRows = db.prepare(`
      SELECT s.ticker
      FROM user_stock_watchlists w
      JOIN stocks s ON w.stock_id = s.id
      WHERE w.user_id = ?
    `).all(userId) as { ticker: string }[];

    // Combine and deduplicate (portfolio first, then watchlist)
    const priorityTickers = new Set<string>();
    const orderedTickers: string[] = [];

    // Add portfolio stocks first (they are more important)
    for (const pos of portfolioPositions) {
      if (!priorityTickers.has(pos.stock_symbol)) {
        priorityTickers.add(pos.stock_symbol);
        orderedTickers.push(pos.stock_symbol);
      }
    }

    // Add watchlist stocks
    for (const row of watchlistRows) {
      if (!priorityTickers.has(row.ticker)) {
        priorityTickers.add(row.ticker);
        orderedTickers.push(row.ticker);
      }
    }

    const results = {
      total_stocks: orderedTickers.length,
      portfolio_stocks: portfolioPositions.length,
      watchlist_stocks: watchlistRows.length - portfolioPositions.length,
      updated: 0,
      failed: 0,
      errors: [] as string[],
    };

    // SEQUENTIAL PROCESSING (one by one) to reduce server load
    // Add small delays between requests
    for (let i = 0; i < orderedTickers.length; i++) {
      const ticker = orderedTickers[i];
      
      // Small delay between requests (100ms) to avoid overload
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const priceData = await fetchStockPriceFromVps(ticker);
      
      if (priceData && priceData.price > 0) {
        await updateStockPrice(ticker, priceData.price, priceData.previous_close);
        results.updated++;
      } else {
        results.failed++;
        results.errors.push(ticker);
      }

      // Limit to max 20 stocks per sync to prevent timeout
      if (i >= 19) {
        console.log('[PrioritySync] Reached 20 stock limit, stopping');
        break;
      }
    }

    // Update rate limit
    lastSyncByUser.set(userId, Date.now());

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      results,
      message: results.updated > 0 
        ? `تم تحديث ${results.updated} سهم بنجاح` 
        : 'لم يتم تحديث أي أسهم',
    });

  } catch (error) {
    console.error('[GET /api/portfolio/priority-sync] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في تحديث البيانات', detail: String(error) },
      { status: 500 }
    );
  }
}
